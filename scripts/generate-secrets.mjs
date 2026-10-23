/**
 * Generate CRON_SECRET and INDEXNOW_SECRET if empty in .env.local.
 * Prints only newly generated values (for pasting into Cloudflare Worker secrets).
 */
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const localPath = join(process.cwd(), ".env.local");

function generateSecret() {
  return randomBytes(32).toString("base64url");
}

function getValue(lines, key) {
  const line = lines.find((l) => l.trim().startsWith(`${key}=`));
  if (!line) return undefined;
  const value = line.slice(line.indexOf("=") + 1).trim();
  return value || undefined;
}

function setValue(lines, key, value) {
  let found = false;
  const updated = lines.map((line) => {
    if (line.trim().startsWith(`${key}=`)) {
      found = true;
      return `${key}=${value}`;
    }
    return line;
  });
  if (!found) {
    updated.push(`${key}=${value}`);
  }
  return updated;
}

if (!existsSync(localPath)) {
  console.error("Missing .env.local — copy .env.example first.");
  process.exit(1);
}

const lines = readFileSync(localPath, "utf8").split("\n");
const generated = {};

for (const key of ["CRON_SECRET", "INDEXNOW_SECRET"]) {
  const current = getValue(lines, key);
  if (!current) {
    generated[key] = generateSecret();
  }
}

if (Object.keys(generated).length === 0) {
  console.log("[secrets] CRON_SECRET and INDEXNOW_SECRET already set — left unchanged.");
  console.log("[secrets] Run with --force to regenerate.");
  if (process.argv.includes("--force")) {
    generated.CRON_SECRET = generateSecret();
    generated.INDEXNOW_SECRET = generateSecret();
  } else {
    process.exit(0);
  }
}

let updated = lines;
for (const [key, value] of Object.entries(generated)) {
  updated = setValue(updated, key, value);
}

writeFileSync(localPath, updated.join("\n"), "utf8");

console.log("[secrets] Written to .env.local\n");
for (const [key, value] of Object.entries(generated)) {
  console.log(`${key}=${value}`);
}
console.log("\n[secrets] Add the two values above as Secrets in Cloudflare → Workers & Pages → revel → Settings → Variables and Secrets.");