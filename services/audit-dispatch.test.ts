import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * Background audit orchestration, end to end in Node with the Workers
 * runtime simulated: dispatch → Workflow binding, duplicate protection,
 * the internal run endpoint, stale-run reconciliation, and the rule that
 * production never falls back to the local JSON store.
 *
 * Storage is the dev file store inside a throwaway directory; no network
 * (websites use the reserved .invalid TLD so fetches fail immediately).
 */

const CONTEXT = Symbol.for("__cloudflare-context__");
const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");

function enterWorkers(env: Record<string, unknown>) {
  Object.defineProperty(globalThis, "navigator", {
    value: { userAgent: "Cloudflare-Workers" },
    configurable: true,
  });
  (globalThis as Record<symbol, unknown>)[CONTEXT] = {
    env,
    ctx: { waitUntil: () => {} },
    cf: {},
  };
}

function leaveWorkers() {
  if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator);
  delete (globalThis as Record<symbol, unknown>)[CONTEXT];
}

const workdir = mkdtempSync(path.join(tmpdir(), "revel-dispatch-test-"));
const originalCwd = process.cwd();

for (const name of [
  "DATABASE_URL",
  "DIRECT_URL",
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "GROQ_API_KEY",
  "GEMINI_API_KEY",
  "OPENROUTER_API_KEY",
  "NVIDIA_API_KEY",
]) {
  delete process.env[name];
}
process.env.AUTH_SECRET = "dispatch-test-secret";
(process.env as Record<string, string>).NODE_ENV = "test";

let n = 0;
function newId(): string {
  n += 1;
  return `6f1c2d0e-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

async function main() {
  // file-store resolves ./data from the cwd at import time.
  process.chdir(workdir);

  const { saveAnalysis, getAnalysis, STALE_PROCESSING_ERROR } = await import(
    "@/services/store"
  );
  const { dispatchAnalysis } = await import("@/services/audit-dispatch");
  const { runWithActivityContext } = await import("@/lib/activity-context");
  const { signAuditRunToken } = await import("@/lib/audit/internal-token");
  const { POST: auditRun } = await import("@/app/api/internal/audit-run/route");

  async function processing(id: string, website = "https://revel-test.invalid/") {
    await saveAnalysis({
      id,
      website,
      status: "processing",
      createdAt: new Date().toISOString(),
    });
  }

  // 1. Workers: dispatch creates exactly one Workflow instance whose id is
  //    the analysis id and whose params carry the activity context.
  const created: { id?: string; params?: unknown }[] = [];
  enterWorkers({
    AUDIT_WORKFLOW: {
      create: async (opts: { id?: string; params?: unknown }) => {
        created.push(opts);
        return { id: opts.id };
      },
      get: async (id: string) => ({ id }),
    },
  });
  const id1 = newId();
  await processing(id1);
  await runWithActivityContext({ source: "api_audit", paid: true }, () =>
    dispatchAnalysis({ analysisId: id1, website: "https://revel-test.invalid/" })
  );
  assert.equal(created.length, 1);
  assert.equal(created[0].id, id1);
  assert.deepEqual(created[0].params, {
    analysisId: id1,
    website: "https://revel-test.invalid/",
    activity: { source: "api_audit", userId: undefined, paid: true },
  });
  assert.equal((await getAnalysis(id1))?.status, "processing");

  // 2. Duplicate dispatch (instance id already exists) is a no-op success.
  enterWorkers({
    AUDIT_WORKFLOW: {
      create: async () => {
        throw new Error("instance.already_exists");
      },
      get: async (id: string) => ({ id }),
    },
  });
  await dispatchAnalysis({ analysisId: id1, website: "https://revel-test.invalid/" });
  assert.equal((await getAnalysis(id1))?.status, "processing", "not failed by a duplicate");

  // 3. Workflow create genuinely failing → terminal failed + error surfaced.
  enterWorkers({
    AUDIT_WORKFLOW: {
      create: async () => {
        throw new Error("workflows unavailable");
      },
      get: async () => {
        throw new Error("not found");
      },
    },
  });
  const id3 = newId();
  await processing(id3);
  await assert.rejects(
    dispatchAnalysis({ analysisId: id3, website: "https://revel-test.invalid/" })
  );
  assert.equal((await getAnalysis(id3))?.status, "failed");

  // 4. Missing binding on Workers → refuse (never run inline and get cut off).
  enterWorkers({});
  const id4 = newId();
  await processing(id4);
  await assert.rejects(
    dispatchAnalysis({ analysisId: id4, website: "https://revel-test.invalid/" }),
    /AUDIT_WORKFLOW/
  );
  assert.equal((await getAnalysis(id4))?.status, "failed");
  leaveWorkers();

  // 5. Internal run endpoint: auth, execution to a terminal state, idempotency.
  const id5 = newId();
  await processing(id5);
  const body = JSON.stringify({ analysisId: id5, website: "https://revel-test.invalid/" });
  const call = (op: string, token?: string) =>
    auditRun(
      new Request(`https://revel-audit.internal/api/internal/audit-run?op=${op}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(token ? { "x-revel-audit-token": token } : {}),
        },
        body,
      })
    );

  assert.equal((await call("run")).status, 404, "no token → 404");
  assert.equal(
    (await call("run", await signAuditRunToken("wrong", id5, "run"))).status,
    404,
    "wrong secret → 404"
  );
  assert.equal((await call("delete", "x")).status, 404, "unknown op → 404");

  const token = await signAuditRunToken("dispatch-test-secret", id5, "run");
  const first = await call("run", token);
  assert.equal(first.status, 200);
  assert.equal((await first.json()).status, "failed", "unreachable site → terminal failed");
  const stored = await getAnalysis(id5);
  assert.equal(stored?.status, "failed");
  assert.ok(stored?.completedAt, "terminal runs record completedAt");

  const again = await call("run", token);
  assert.equal(again.status, 200);
  assert.deepEqual(await again.json(), { analysisId: id5, status: "failed", skipped: true });

  // op=fail closes out a still-processing analysis (Workflow's last resort).
  const id6 = newId();
  await processing(id6);
  const failRes = await auditRun(
    new Request("https://revel-audit.internal/api/internal/audit-run?op=fail", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-revel-audit-token": await signAuditRunToken("dispatch-test-secret", id6, "fail"),
      },
      body: JSON.stringify({ analysisId: id6, website: "https://revel-test.invalid/" }),
    })
  );
  assert.equal(failRes.status, 200);
  assert.equal((await getAnalysis(id6))?.status, "failed");

  // 6. Node (`next dev` / stdio MCP): dispatch runs in-process.
  const id7 = newId();
  await processing(id7);
  await dispatchAnalysis({ analysisId: id7, website: "https://revel-test.invalid/" });
  for (let i = 0; i < 50 && (await getAnalysis(id7))?.status === "processing"; i++) {
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.equal((await getAnalysis(id7))?.status, "failed");

  // 7. A run that lost its runner is closed out instead of polling forever.
  const id8 = newId();
  await saveAnalysis({
    id: id8,
    website: "https://revel-test.invalid/",
    status: "processing",
    createdAt: new Date(Date.now() - 31 * 60_000).toISOString(),
  });
  const stale = await getAnalysis(id8);
  assert.equal(stale?.status, "failed");
  assert.equal(stale?.error, STALE_PROCESSING_ERROR);
  const recent = newId();
  await processing(recent);
  assert.equal((await getAnalysis(recent))?.status, "processing");

  // 8. Production never silently falls back to the local JSON store.
  (process.env as Record<string, string>).NODE_ENV = "production";
  await assert.rejects(processing(newId()), /No analysis storage is configured/);
  (process.env as Record<string, string>).NODE_ENV = "test";

  console.log("audit orchestration: ok");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    leaveWorkers();
    process.chdir(originalCwd);
    rmSync(workdir, { recursive: true, force: true });
  });
