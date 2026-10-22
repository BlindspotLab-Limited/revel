#!/usr/bin/env node
/**
 * Upload Revel's runtime secrets to the Cloudflare Worker from a local
 * dotenv file (default `.env.local`).
 *
 *   node scripts/cloudflare/upload-secrets.mjs --dry-run      # names only, uploads nothing
 *   node scripts/cloudflare/upload-secrets.mjs                # upload
 *   node scripts/cloudflare/upload-secrets.mjs .env.production
 *   node scripts/cloudflare/upload-secrets.mjs --compare .env.production.local
 *
 * The payload goes to `wrangler secret bulk` over stdin, so no file of
 * secrets is ever written to disk. Values are never printed — only names.
 *
 * What it will NOT send:
 *  - any name declared in wrangler.jsonc `vars` (a plain-text var and a
 *    secret of the same name could overwrite each other), which is also why
 *    the local `NEXT_PUBLIC_APP_URL=http://localhost:3000` can never reach
 *    production;
 *  - `DATABASE_URL`, `DIRECT_URL`, `SUPABASE_*` (the Worker reaches Postgres
 *    only through Hyperdrive), `VERCEL*`, or anything not used at runtime;
 *  - empty values, or values pointing at localhost.
 *
 * `--compare <other.env>` reports, for each shared name, only whether the
 * two files agree — no values, no hashes. Use it against a production pull
 * (`npx vercel env pull .env.production.local --environment=production`) to
 * confirm `AUTH_SECRET` and `INTEGRATIONS_ENCRYPTION_KEY` match the values
 * production is using today. If they differ, every signed-in session is
 * ended and stored Linear/Notion/GitHub tokens become undecryptable.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { ROOT, readConfigVars } from "./wrangler-config.mjs";

const WORKER_NAME = "revel";

/** Runtime values the Worker actually reads (lib/, services/, app/). */
const RUNTIME_NAMES = [
  // auth
  "AUTH_SECRET", "NEXTAUTH_SECRET", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET",
  "INTEGRATIONS_ENCRYPTION_KEY", "AUTH_DEBUG",
  // AI providers + analysis policy
  "NVIDIA_API_KEY", "NVIDIA_BASE_URL", "NVIDIA_MODEL", "NVIDIA_MODEL_FALLBACK",
  "NVIDIA_REASONING", "NVIDIA_MAX_OUTPUT_TOKENS", "NVIDIA_PRIMARY",
  "GROQ_API_KEY", "GROQ_MODEL", "GROQ_MODEL_FALLBACK",
  "OPENROUTER_API_KEY", "OPENROUTER_MODEL", "OPENROUTER_MODEL_FALLBACK",
  "GEMINI_API_KEY", "GEMINI_MODEL", "GEMINI_MODEL_FALLBACK",
  "ANALYSIS_PROVIDER", "ANALYSIS_MODE", "AGENT_MAX_STEPS",
  "AUDIT_MIN_PAGES", "AUDIT_MAX_PAGES", "AUDIT_BUDGET_MS",
  "PROVIDER_REQUEST_TIMEOUT_MS", "PROVIDER_MAX_RETRIES",
  // per-user export OAuth (+ legacy shared keys)
  "LINEAR_CLIENT_ID", "LINEAR_CLIENT_SECRET", "NOTION_CLIENT_ID",
  "NOTION_CLIENT_SECRET", "NOTION_TITLE_PROPERTY", "GITHUB_CLIENT_ID",
  "GITHUB_CLIENT_SECRET", "GITHUB_TOKEN", "LINEAR_API_KEY", "LINEAR_TEAM_ID",
  "NOTION_API_KEY", "NOTION_DATABASE_ID",
  // MCP + OKX x402 billing and payout
  "MCP_API_KEY", "OKX_API_KEY", "OKX_SECRET_KEY", "OKX_PASSPHRASE",
  "OKX_PAY_TO", "OKX_PAY_NETWORK", "OKX_PAY_ASSET", "OKX_PAY_ASSET_SYMBOL",
  "OKX_PAY_ASSET_DECIMALS", "OKX_AUDIT_PRICE_USD",
  // email, admin, usage limits
  "RESEND_API_KEY", "RESEND_FROM_EMAIL", "REVEL_ADMIN_EMAILS",
  "REVEL_ADMIN_NOTIFY_EMAIL", "WEEKLY_AUDIT_LIMIT", "DAILY_AUDIT_LIMIT",
  // SEO + the daily IndexNow cron
  "CRON_SECRET", "INDEXNOW_KEY", "INDEXNOW_SECRET", "INDEXNOW_DISABLED",
  "GOOGLE_SITE_VERIFICATION", "BING_SITE_VERIFICATION", "YANDEX_SITE_VERIFICATION",
];

/** Without these the deployment is broken in a way that is easy to miss. */
const REQUIRED = ["AUTH_SECRET", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "CRON_SECRET"];

/** Must match production exactly or existing data becomes unreadable. */
const MUST_MATCH_PRODUCTION = ["AUTH_SECRET", "NEXTAUTH_SECRET", "INTEGRATIONS_ENCRYPTION_KEY"];

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const compareIndex = args.indexOf("--compare");
const compareWith = compareIndex === -1 ? null : args[compareIndex + 1];
const compareValueIndex = compareIndex === -1 ? -1 : compareIndex + 1;
const positional = args.filter(
  (a, i) => !a.startsWith("--") && i !== compareValueIndex
);
const sourceFile = positional[0] ?? ".env.local";

function fail(message) {
  console.error(message);
  process.exit(2);
}

function parseDotenv(text) {
  const vars = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    let value = match[2];
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.endsWith(quote) && value.length > 1) {
      value = value.slice(1, -1);
      if (quote === '"') value = value.replace(/\\n/g, "\n");
    } else {
      // Strip a trailing ` # comment`, but keep `#` inside a value.
      value = value.replace(/\s+#.*$/, "");
    }
    vars[match[1]] = value.trim();
  }
  return vars;
}

function load(file) {
  const resolved = path.resolve(ROOT, file);
  if (!existsSync(resolved)) {
    fail(
      `Not found: ${resolved}\n` +
        "Pass the path to your production dotenv file, e.g.\n" +
        "  node scripts/cloudflare/upload-secrets.mjs .env.local"
    );
  }
  return parseDotenv(readFileSync(resolved, "utf8"));
}

// --------------------------------------------------------------- compare mode
if (compareWith) {
  if (!compareWith || compareWith.startsWith("--")) {
    fail("--compare needs a file path, e.g. --compare .env.production.local");
  }
  const a = load(sourceFile);
  const b = load(compareWith);
  const digest = (value) => createHash("sha256").update(value).digest("hex");
  const shared = RUNTIME_NAMES.filter((n) => a[n] !== undefined && b[n] !== undefined);
  const differ = [];

  console.log(`Comparing ${sourceFile} with ${compareWith} (values are never shown)\n`);
  for (const name of shared) {
    const same = digest(a[name]) === digest(b[name]);
    if (!same) differ.push(name);
    console.log(`  ${same ? "same     " : "DIFFERENT"}  ${name}`);
  }
  const onlyA = RUNTIME_NAMES.filter((n) => a[n] && !b[n]);
  const onlyB = RUNTIME_NAMES.filter((n) => b[n] && !a[n]);
  if (onlyA.length) console.log(`\nOnly in ${sourceFile}: ${onlyA.join(", ")}`);
  if (onlyB.length) console.log(`\nOnly in ${compareWith}: ${onlyB.join(", ")}`);

  const criticalDiff = differ.filter((n) => MUST_MATCH_PRODUCTION.includes(n));
  if (criticalDiff.length) {
    console.log(
      `\nSTOP: ${criticalDiff.join(", ")} differ between the two files.\n` +
        "Uploading the wrong value here signs out every user, and a wrong\n" +
        "INTEGRATIONS_ENCRYPTION_KEY (or AUTH_SECRET, which it falls back to)\n" +
        "makes stored Linear/Notion/GitHub tokens undecryptable.\n" +
        "Upload the values production is using today."
    );
    process.exit(1);
  }
  console.log(
    differ.length
      ? `\n${differ.length} non-critical value(s) differ: ${differ.join(", ")}`
      : "\nEvery shared value matches."
  );
  process.exit(0);
}

// ---------------------------------------------------------------- upload mode
const source = load(sourceFile);
const configVars = readConfigVars();

const payload = {};
const skippedLocalhost = [];
const skippedEmpty = [];

// Anything wrangler.jsonc already declares as a public var is never uploaded
// as a secret, whatever the local file says. This is what keeps a local
// NEXT_PUBLIC_APP_URL=http://localhost:3000 out of production.
const skippedInConfig = Object.keys(source)
  .filter((name) => name in configVars)
  .sort();

for (const name of RUNTIME_NAMES) {
  if (!(name in source)) continue;
  if (name in configVars) continue;
  const value = source[name];
  if (value === "") {
    skippedEmpty.push(name);
    continue;
  }
  if (/\blocalhost\b|127\.0\.0\.1/i.test(value)) {
    skippedLocalhost.push(name);
    continue;
  }
  payload[name] = value;
}

// Auth.js reads either name; keep both set so neither path falls back.
if (payload.AUTH_SECRET && !payload.NEXTAUTH_SECRET && !("NEXTAUTH_SECRET" in configVars)) {
  payload.NEXTAUTH_SECRET = payload.AUTH_SECRET;
}
if (payload.NEXTAUTH_SECRET && !payload.AUTH_SECRET && !("AUTH_SECRET" in configVars)) {
  payload.AUTH_SECRET = payload.NEXTAUTH_SECRET;
}

const names = Object.keys(payload).sort();
if (names.length === 0) {
  fail(`No uploadable runtime values found in ${sourceFile}.`);
}
if (names.length > 100) {
  fail(`${names.length} secrets exceeds the 100-per-request limit of wrangler secret bulk.`);
}

const notSent = Object.keys(source)
  .filter((n) => !RUNTIME_NAMES.includes(n) && !(n in configVars))
  .sort();

console.log(`Source: ${sourceFile}`);
console.log(`\nWill upload ${names.length} secret(s) to Worker "${WORKER_NAME}":`);
console.log(`  ${names.join(", ")}`);
if (skippedInConfig.length) {
  console.log(
    "\nNot uploaded — set as public values in wrangler.jsonc vars instead\n" +
      "(the committed production URLs are used, not the ones in this file):\n" +
      `  ${skippedInConfig.join(", ")}`
  );
}
if (skippedLocalhost.length) {
  console.log(`\nSkipped — local/dev value, not production:\n  ${skippedLocalhost.join(", ")}`);
}
if (skippedEmpty.length) {
  console.log(`\nSkipped — empty in ${sourceFile}:\n  ${skippedEmpty.join(", ")}`);
}
if (notSent.length) {
  console.log(`\nNot sent — unused on Workers (database goes through Hyperdrive):\n  ${notSent.join(", ")}`);
}

const missing = REQUIRED.filter((n) => !payload[n]);
if (missing.length) {
  console.log(
    `\nWARNING: required value(s) missing: ${missing.join(", ")}.\n` +
      "Set each one with:  npx wrangler secret put <NAME> --name revel"
  );
}
console.log(
  `\nReminder: ${MUST_MATCH_PRODUCTION.join(" / ")} must be the values production uses today.\n` +
    "Verify with:  node scripts/cloudflare/upload-secrets.mjs --compare <production.env>"
);

if (dryRun) {
  console.log("\n--dry-run: nothing was uploaded.");
  process.exit(0);
}

const npx = process.platform === "win32" ? "npx.cmd" : "npx";
const result = spawnSync(
  npx,
  ["wrangler", "secret", "bulk", "--name", WORKER_NAME],
  {
    cwd: ROOT,
    input: JSON.stringify(payload),
    stdio: ["pipe", "inherit", "inherit"],
    shell: process.platform === "win32",
  }
);

if (result.status !== 0) {
  console.error(
    "\nUpload failed. Common causes:\n" +
      "  - not logged in:            npx wrangler login\n" +
      `  - Worker "${WORKER_NAME}" does not exist yet: create it by connecting the\n` +
      "    repository in the Cloudflare dashboard, or run\n" +
      `    npx wrangler secret put AUTH_SECRET --name ${WORKER_NAME}  and accept the prompt\n` +
      "  - wrong account:            npx wrangler whoami"
  );
  process.exit(result.status ?? 1);
}

console.log(
  `\nUploaded. Confirm with:  npx wrangler secret list --name ${WORKER_NAME}  (names only)`
);
