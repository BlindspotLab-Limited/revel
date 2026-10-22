import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  BASE_CONFIG,
  LOCAL_HYPERDRIVE_ID,
  applyConfigVars,
  buildDeployConfig,
  parseJsonc,
  readConfigVars,
  resolveHyperdriveId,
} from "./wrangler-config.mjs";

/**
 * Guards the Cloudflare deployment contract: the committed wrangler.jsonc
 * stays account-agnostic, the Hyperdrive id is injected safely, and the
 * bindings the code relies on are all declared.
 */

/** Test env literal (NodeJS.ProcessEnv requires NODE_ENV in its type). */
const env = (vars: Record<string, string>) => vars as unknown as NodeJS.ProcessEnv;

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const ID = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
const base = readFileSync(BASE_CONFIG, "utf8");
const config = parseJsonc(base);

// --- committed config -------------------------------------------------------
assert.equal(config.name, "revel");
assert.equal(config.main, "cloudflare/worker.ts");
assert.ok(config.compatibility_flags.includes("nodejs_compat"));
assert.ok(config.compatibility_flags.includes("global_fetch_strictly_public"));
assert.ok(config.compatibility_date >= "2025-04-01", "process.env population needs ≥ 2025-04-01");
assert.equal(config.hyperdrive, undefined, "no account-specific Hyperdrive id in git");
assert.deepEqual(config.services, [
  { binding: "WORKER_SELF_REFERENCE", service: config.name },
]);
assert.deepEqual(config.workflows, [
  { name: "revel-audit", binding: "AUDIT_WORKFLOW", class_name: "AuditWorkflow" },
]);
assert.deepEqual(config.triggers.crons, ["0 6 * * *"]);
assert.deepEqual(
  config.ratelimits.map((r: { name: string }) => r.name).sort(),
  ["AUDIT_RATE_LIMITER", "PARTNER_RATE_LIMITER"]
);
assert.equal(config.assets.directory, ".open-next/assets");
assert.equal(config.keep_vars, true, "dashboard variables must survive GitHub deploys");
assert.doesNotMatch(base, /[0-9a-f]{32}/i, "no 32-hex resource ids committed");

// Entry exports what the config binds.
const worker = readFileSync(path.join(ROOT, "cloudflare/worker.ts"), "utf8");
assert.match(worker, /export \{ AuditWorkflow \} from "\.\/audit-workflow"/);
assert.match(worker, /async scheduled\(/);
assert.match(worker, /"0 6 \* \* \*"/);

// --- public vars ------------------------------------------------------------
// These are committed, so they must be public, non-account-specific values.
const vars = readConfigVars();
for (const name of [
  "NEXT_PUBLIC_APP_URL",
  "NEXT_PUBLIC_MARKETING_URL",
  "NEXT_PUBLIC_DOCS_URL",
  "NEXT_PUBLIC_LEGAL_URL",
  "NEXT_PUBLIC_AUTH_URL",
  "NEXT_PUBLIC_ENABLE_SUBDOMAIN_REDIRECTS",
  "AUTH_URL",
  "NEXTAUTH_URL",
]) {
  assert.ok(vars[name], `wrangler.jsonc vars must declare ${name}`);
}
assert.equal(vars.AUTH_URL, "https://auth.tryrevel.xyz", "Google OAuth callback host");
assert.equal(vars.NEXTAUTH_URL, vars.AUTH_URL);
assert.equal(vars.NEXT_PUBLIC_AUTH_URL, vars.AUTH_URL);
assert.equal(vars.NEXT_PUBLIC_ENABLE_SUBDOMAIN_REDIRECTS, "true");
for (const [name, value] of Object.entries(vars)) {
  assert.doesNotMatch(
    name,
    /SECRET|API_KEY|TOKEN|PASSWORD|PASSPHRASE|CREDENTIAL/i,
    `${name} looks like a credential and must not be a committed var`
  );
  assert.doesNotMatch(value, /localhost|127\.0\.0\.1/, `${name} must not be a local value`);
}

// A real build variable always wins over the committed default.
const withOverride = env({ NEXT_PUBLIC_APP_URL: "https://staging.tryrevel.xyz" });
applyConfigVars(withOverride);
assert.equal(withOverride.NEXT_PUBLIC_APP_URL, "https://staging.tryrevel.xyz");
assert.equal(withOverride.AUTH_URL, vars.AUTH_URL, "other vars are still filled in");

// An empty build variable is treated as unset, not as an override.
const withEmpty = env({ NEXT_PUBLIC_APP_URL: "" });
applyConfigVars(withEmpty);
assert.equal(withEmpty.NEXT_PUBLIC_APP_URL, vars.NEXT_PUBLIC_APP_URL);

// --- Hyperdrive id injection ------------------------------------------------
assert.equal(resolveHyperdriveId(env({ CLOUDFLARE_HYPERDRIVE_ID: ID })), ID);
assert.equal(
  resolveHyperdriveId(env({ CLOUDFLARE_HYPERDRIVE_ID: ` ${ID.toUpperCase()} ` })),
  ID
);
assert.throws(
  () => resolveHyperdriveId(env({ CLOUDFLARE_HYPERDRIVE_ID: "postgres://user:pw@host/db" })),
  /32-character/,
  "a pasted connection string is rejected (and never echoed)"
);
assert.throws(() => resolveHyperdriveId(env({ WORKERS_CI: "1" })), /CLOUDFLARE_HYPERDRIVE_ID is not set/);
assert.equal(resolveHyperdriveId(env({})), null, "local build without DB: binding omitted");
assert.equal(
  resolveHyperdriveId(env({
    CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE: "postgres://u:p@127.0.0.1/db",
  })),
  LOCAL_HYPERDRIVE_ID
);

const deploy = buildDeployConfig(base, ID);
assert.deepEqual(deploy.hyperdrive, [{ binding: "HYPERDRIVE", id: ID }]);
assert.equal(buildDeployConfig(base, null).hyperdrive, undefined);
assert.throws(
  () => buildDeployConfig('{ "hyperdrive": [] }', ID),
  /must not declare `hyperdrive`/
);

// JSONC parser keeps "//" inside strings.
assert.deepEqual(parseJsonc('{ "u": "https://x.y", // c\n "a": [1, 2,], /* b */ }'), {
  u: "https://x.y",
  a: [1, 2],
});

console.log("wrangler config: ok");
