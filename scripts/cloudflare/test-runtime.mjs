#!/usr/bin/env node
/**
 * Cloudflare Workers runtime tests — local workerd, no Cloudflare account.
 *
 *   npm run test:cloudflare
 *
 * 1. Compatibility probe: bundles scripts/cloudflare/compat/worker.ts with
 *    Wrangler and runs it in workerd (production compatibility date/flags)
 *    against fixtures produced by Node.js — encrypted integration tokens,
 *    OAuth state, bcrypt hashes, partner key hashes, AsyncLocalStorage,
 *    the OKX x402 HMAC signer and the MCP Web Standard transport.
 *
 * 2. Full application (optional): when TEST_DATABASE_URL points at a
 *    throwaway Postgres that has the Prisma schema applied, and
 *    `npm run build:cloudflare` was run with
 *    CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE set, starts the
 *    real Worker with `opennextjs-cloudflare preview` (Hyperdrive in local
 *    mode, Workflows and cron emulated) and runs smoke-test.mjs --write plus
 *    the IndexNow cron trigger. NEVER point TEST_DATABASE_URL at production.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
let failures = 0;

function log(ok, name, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

function startWrangler(args, env = {}) {
  const child = spawn("npx", args, {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  let output = "";
  child.stdout.on("data", (d) => (output += d));
  child.stderr.on("data", (d) => (output += d));
  return {
    output: () => output,
    stop: () => {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {}
    },
  };
}

async function waitFor(url, timeoutMs, proc) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      await res.body?.cancel();
      return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  console.error(proc.output().slice(-3000));
  return false;
}

// ------------------------------------------------------------ 1. probe
{
  const fixtures = spawnSync("npx", ["tsx", "scripts/cloudflare/compat/fixtures.ts"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  if (fixtures.status !== 0) {
    console.error(fixtures.stderr);
    process.exit(1);
  }

  const port = 8899;
  const probe = startWrangler([
    "wrangler", "dev",
    "--config", "scripts/cloudflare/compat/wrangler.jsonc",
    "--port", String(port), "--ip", "127.0.0.1",
  ]);
  try {
    const up = await waitFor(`http://127.0.0.1:${port}/`, 90_000, probe);
    log(up, "workerd probe started");
    if (up) {
      const res = await fetch(`http://127.0.0.1:${port}/`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: fixtures.stdout.trim(),
      });
      const results = await res.json();
      for (const [name, value] of Object.entries(results)) {
        log(value === true, `workerd: ${name}`, value === true ? "" : String(value));
      }
    }
  } finally {
    probe.stop();
  }
}

// ------------------------------------------------------------ 2. full app
const dbUrl = process.env.TEST_DATABASE_URL;
const deployConfig = path.join(ROOT, "wrangler.deploy.jsonc");
const hasBuild = existsSync(path.join(ROOT, ".open-next", "worker.js")) && existsSync(deployConfig);
const hasHyperdrive = hasBuild && readFileSync(deployConfig, "utf8").includes('"HYPERDRIVE"');

if (!dbUrl || !hasHyperdrive) {
  console.log(
    "SKIP  full-application tests — set TEST_DATABASE_URL (throwaway Postgres with the " +
      "Prisma schema) and run `npm run build:cloudflare` with " +
      "CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE first."
  );
} else if (/supabase\.(co|com)|pooler\.supabase/i.test(dbUrl)) {
  console.error("Refusing to run write tests against a Supabase host. Use a throwaway database.");
  process.exit(1);
} else {
  const port = 8898;
  const vars = {
    AUTH_SECRET: "runtime-test-auth-secret-0123456789",
    INTEGRATIONS_ENCRYPTION_KEY: "runtime-test-integrations-key",
    GOOGLE_CLIENT_ID: "runtime-test.apps.googleusercontent.com",
    GOOGLE_CLIENT_SECRET: "runtime-test-google-secret",
    CRON_SECRET: "runtime-test-cron-secret",
    MCP_API_KEY: "runtime-test-mcp-key",
    INDEXNOW_DISABLED: "true",
  };
  const app = startWrangler(
    [
      "opennextjs-cloudflare", "preview",
      "--config", "wrangler.deploy.jsonc",
      "--port", String(port), "--ip", "127.0.0.1",
      ...Object.entries(vars).flatMap(([k, v]) => ["--var", `${k}:${v}`]),
    ],
    { CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE: dbUrl }
  );
  try {
    const base = `http://127.0.0.1:${port}`;
    const up = await waitFor(`${base}/api/health`, 180_000, app);
    log(up, "application Worker started (workerd + Hyperdrive local mode)");
    if (up) {
      const smoke = spawnSync("node", ["scripts/cloudflare/smoke-test.mjs", base, "--write"], {
        cwd: ROOT,
        encoding: "utf8",
        env: { ...process.env, SMOKE_MCP_API_KEY: vars.MCP_API_KEY },
        timeout: 15 * 60_000,
      });
      process.stdout.write(smoke.stdout);
      log(smoke.status === 0, "smoke-test.mjs --write against the local Worker");

      const cron = await fetch(
        `${base}/cdn-cgi/local/explorer/api/local/scheduled?worker=revel`,
        { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ cron: "0 6 * * *" }) }
      );
      const cronBody = await cron.json().catch(() => ({}));
      log(cron.ok && cronBody?.result?.outcome === "ok", "cron trigger 0 6 * * * runs", JSON.stringify(cronBody?.result ?? cronBody));
    }
  } finally {
    app.stop();
  }
}

console.log(failures === 0 ? "\nCloudflare runtime tests: all passed" : `\nCloudflare runtime tests: ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
