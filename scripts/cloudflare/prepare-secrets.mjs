#!/usr/bin/env node
/**
 * Turn a dotenv file of PRODUCTION values (e.g. from
 * `npx vercel env pull .env.production.local --environment=production`)
 * into a JSON file for `wrangler secret bulk`, keeping only the runtime
 * values the Cloudflare Worker uses.
 *
 *   node scripts/cloudflare/prepare-secrets.mjs .env.production.local
 *   npx wrangler secret bulk cloudflare-secrets.json --name revel
 *   (then delete cloudflare-secrets.json)
 *
 * - Drops DATABASE_URL / DIRECT_URL / SUPABASE_* / VERCEL_* / NEXT_PUBLIC_*
 *   (database goes through Hyperdrive; NEXT_PUBLIC_* are build variables).
 * - Pins AUTH_URL / NEXTAUTH_URL to https://auth.tryrevel.xyz.
 * - Refuses localhost values so dev settings never reach production.
 * - Prints variable NAMES only, never values.
 */
import { readFileSync, writeFileSync } from "node:fs";

const RUNTIME_NAMES = [
  // auth
  "AUTH_SECRET", "NEXTAUTH_SECRET", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET",
  "INTEGRATIONS_ENCRYPTION_KEY", "AUTH_DEBUG",
  // AI providers
  "NVIDIA_API_KEY", "NVIDIA_BASE_URL", "NVIDIA_MODEL", "NVIDIA_MODEL_FALLBACK",
  "NVIDIA_REASONING", "NVIDIA_MAX_OUTPUT_TOKENS", "NVIDIA_PRIMARY",
  "GROQ_API_KEY", "GROQ_MODEL", "GROQ_MODEL_FALLBACK",
  "OPENROUTER_API_KEY", "OPENROUTER_MODEL", "OPENROUTER_MODEL_FALLBACK",
  "GEMINI_API_KEY", "GEMINI_MODEL", "GEMINI_MODEL_FALLBACK",
  "ANALYSIS_PROVIDER", "ANALYSIS_MODE", "AGENT_MAX_STEPS",
  "AUDIT_MIN_PAGES", "AUDIT_MAX_PAGES", "AUDIT_BUDGET_MS",
  "PROVIDER_REQUEST_TIMEOUT_MS", "PROVIDER_MAX_RETRIES",
  // integrations
  "LINEAR_CLIENT_ID", "LINEAR_CLIENT_SECRET", "NOTION_CLIENT_ID",
  "NOTION_CLIENT_SECRET", "NOTION_TITLE_PROPERTY", "GITHUB_CLIENT_ID",
  "GITHUB_CLIENT_SECRET", "GITHUB_TOKEN", "LINEAR_API_KEY", "LINEAR_TEAM_ID",
  "NOTION_API_KEY", "NOTION_DATABASE_ID",
  // MCP + billing
  "MCP_API_KEY", "OKX_API_KEY", "OKX_SECRET_KEY", "OKX_PASSPHRASE",
  "OKX_PAY_TO", "OKX_PAY_NETWORK", "OKX_PAY_ASSET", "OKX_PAY_ASSET_SYMBOL",
  "OKX_PAY_ASSET_DECIMALS", "OKX_AUDIT_PRICE_USD",
  // email, admin, usage
  "RESEND_API_KEY", "RESEND_FROM_EMAIL", "REVEL_ADMIN_EMAILS",
  "REVEL_ADMIN_NOTIFY_EMAIL", "WEEKLY_AUDIT_LIMIT", "DAILY_AUDIT_LIMIT",
  // SEO + jobs
  "CRON_SECRET", "INDEXNOW_KEY", "INDEXNOW_SECRET", "INDEXNOW_DISABLED",
  "GOOGLE_SITE_VERIFICATION", "BING_SITE_VERIFICATION", "YANDEX_SITE_VERIFICATION",
];

const MUST_HAVE = ["AUTH_SECRET", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "CRON_SECRET"];

const PINNED = {
  AUTH_URL: "https://auth.tryrevel.xyz",
  NEXTAUTH_URL: "https://auth.tryrevel.xyz",
};

const input = process.argv[2];
const output = process.argv[3] ?? "cloudflare-secrets.json";
if (!input) {
  console.error("Usage: node scripts/cloudflare/prepare-secrets.mjs <production.env> [out.json]");
  process.exit(2);
}

function parseDotenv(text) {
  const vars = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let value = m[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
      if (m[2].startsWith('"')) value = value.replace(/\\n/g, "\n");
    } else {
      value = value.replace(/\s+#.*$/, "");
    }
    vars[m[1]] = value;
  }
  return vars;
}

const source = parseDotenv(readFileSync(input, "utf8"));
const secrets = { ...PINNED };
const empty = [];
const refused = [];

for (const name of RUNTIME_NAMES) {
  if (!(name in source)) continue;
  const value = source[name];
  if (value === "") {
    empty.push(name);
    continue;
  }
  if (/localhost|127\.0\.0\.1/i.test(value)) {
    refused.push(name);
    continue;
  }
  secrets[name] = value;
}

// NEXTAUTH_SECRET mirrors AUTH_SECRET when only one is set.
if (!secrets.NEXTAUTH_SECRET && secrets.AUTH_SECRET) secrets.NEXTAUTH_SECRET = secrets.AUTH_SECRET;
if (!secrets.AUTH_SECRET && secrets.NEXTAUTH_SECRET) secrets.AUTH_SECRET = secrets.NEXTAUTH_SECRET;

writeFileSync(output, JSON.stringify(secrets, null, 2) + "\n", { mode: 0o600 });

const ignored = Object.keys(source).filter((k) => !RUNTIME_NAMES.includes(k) && !(k in PINNED));
console.log(`Wrote ${output} with ${Object.keys(secrets).length} values:`);
console.log(`  ${Object.keys(secrets).sort().join(", ")}`);
if (empty.length) {
  console.log(`\nEmpty in ${input} (Vercel "Sensitive" values can't be pulled) — set each by hand:`);
  for (const n of empty) console.log(`  npx wrangler secret put ${n} --name revel`);
}
if (refused.length) console.log(`\nSkipped (localhost value, not production): ${refused.join(", ")}`);
if (ignored.length) console.log(`\nNot sent (build-only or unused on Workers): ${ignored.join(", ")}`);
const missing = MUST_HAVE.filter((n) => !secrets[n]);
if (missing.length) console.log(`\nSTILL MISSING (required): ${missing.join(", ")}`);
console.log("\nNext: npx wrangler secret bulk " + output + " --name revel   — then delete " + output);
