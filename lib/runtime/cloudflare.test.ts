import assert from "node:assert/strict";
import { getDatabaseConnectionKind, getPrisma, isPrismaEnabled } from "@/lib/prisma";
import { enforceRateLimit, getClientIp, getRateLimitKey } from "@/lib/rate-limit";
import {
  getCloudflareEnv,
  isCloudflareWorkersRuntime,
  runInBackground,
} from "@/lib/runtime/cloudflare";

/**
 * Simulates the Workers runtime in Node: the `navigator.userAgent` signal
 * plus the per-request context OpenNext publishes on globalThis.
 */
const CONTEXT = Symbol.for("__cloudflare-context__");
const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");

function enterWorkers(env: Record<string, unknown>) {
  const waited: Promise<unknown>[] = [];
  const ctx = { waitUntil: (p: Promise<unknown>) => void waited.push(p) };
  Object.defineProperty(globalThis, "navigator", {
    value: { userAgent: "Cloudflare-Workers" },
    configurable: true,
  });
  (globalThis as Record<symbol, unknown>)[CONTEXT] = { env, ctx, cf: {} };
  return { ctx, waited };
}

function leaveWorkers() {
  if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator);
  delete (globalThis as Record<symbol, unknown>)[CONTEXT];
}

const HYPERDRIVE = { connectionString: "postgresql://user:pw@hyperdrive.local:5432/postgres" };

async function main() {
  // --- Node.js (local dev / scripts) ------------------------------------
  delete process.env.DATABASE_URL;
  delete process.env.DIRECT_URL;
  assert.equal(isCloudflareWorkersRuntime(), false);
  assert.equal(getCloudflareEnv(), null);
  assert.equal(isPrismaEnabled(), false);
  assert.equal(getPrisma(), null);

  process.env.DATABASE_URL = "postgresql://u:p@db.example.com:6543/postgres";
  assert.equal(isPrismaEnabled(), false, "Node keeps requiring DIRECT_URL too");
  process.env.DIRECT_URL = "postgresql://u:p@db.example.com:5432/postgres";
  assert.equal(isPrismaEnabled(), true);
  assert.equal(getDatabaseConnectionKind(), "url");
  assert.equal(getPrisma(), getPrisma(), "one process-wide client on Node");

  // --- Workers with Hyperdrive ------------------------------------------
  delete process.env.DATABASE_URL;
  delete process.env.DIRECT_URL;
  const first = enterWorkers({ HYPERDRIVE });
  assert.equal(isCloudflareWorkersRuntime(), true);
  assert.equal(isPrismaEnabled(), true, "Hyperdrive alone is enough on Workers");
  assert.equal(getDatabaseConnectionKind(), "hyperdrive");
  const a = getPrisma();
  assert.ok(a);
  assert.equal(getPrisma(), a, "same client for the rest of one request");
  enterWorkers({ HYPERDRIVE });
  const b = getPrisma();
  assert.ok(b);
  assert.notEqual(b, a, "never reuse a client (and its sockets) across requests");
  void first;

  // --- Workers without Hyperdrive: no silent fallback --------------------
  process.env.DATABASE_URL = "postgresql://u:p@db.example.com:6543/postgres";
  process.env.DIRECT_URL = "postgresql://u:p@db.example.com:5432/postgres";
  enterWorkers({});
  assert.equal(isPrismaEnabled(), false, "raw DATABASE_URL is not used on Workers");
  assert.equal(getPrisma(), null);
  delete process.env.DATABASE_URL;
  delete process.env.DIRECT_URL;

  // --- runInBackground registers with waitUntil on Workers ---------------
  const bg = enterWorkers({});
  let ran = false;
  runInBackground(Promise.resolve().then(() => (ran = true)));
  runInBackground(Promise.reject(new Error("swallowed")));
  assert.equal(bg.waited.length, 2);
  await Promise.all(bg.waited);
  assert.equal(ran, true);

  // --- Client IP: CF-Connecting-IP wins on Workers, XFF is spoofable -----
  const spoofed = new Request("https://tryrevel.xyz/api/analyze", {
    headers: {
      "x-forwarded-for": "1.2.3.4, 198.51.100.7",
      "cf-connecting-ip": "198.51.100.7",
    },
  });
  assert.equal(getClientIp(spoofed), "198.51.100.7");
  assert.equal(getRateLimitKey(spoofed), "ip:198.51.100.7");
  assert.equal(getRateLimitKey(spoofed, "user-1"), "user:user-1");

  // --- Shared rate limiter binding is consulted after the local window ---
  const calls: string[] = [];
  enterWorkers({
    AUDIT_RATE_LIMITER: {
      limit: async ({ key }: { key: string }) => {
        calls.push(key);
        return { success: calls.length <= 1 };
      },
    },
  });
  const opts = { limit: 100, windowMs: 60_000, binding: "AUDIT_RATE_LIMITER" as const };
  assert.equal((await enforceRateLimit("k1", opts)).success, true);
  assert.equal((await enforceRateLimit("k1", opts)).success, false, "binding says no");
  assert.deepEqual(calls, ["k1", "k1"]);

  // Binding failure fails open (local window still applies).
  enterWorkers({
    AUDIT_RATE_LIMITER: { limit: async () => { throw new Error("down"); } },
  });
  assert.equal((await enforceRateLimit("k2", opts)).success, true);
  // Local window still enforced without any binding.
  leaveWorkers();
  const tight = { limit: 1, windowMs: 60_000, binding: "AUDIT_RATE_LIMITER" as const };
  assert.equal((await enforceRateLimit("k3", tight)).success, true);
  assert.equal((await enforceRateLimit("k3", tight)).success, false);

  // Node: XFF is the platform-set client IP; CF header is not trusted.
  assert.equal(getClientIp(spoofed), "1.2.3.4");

  console.log("cloudflare runtime helpers: ok");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(leaveWorkers);
