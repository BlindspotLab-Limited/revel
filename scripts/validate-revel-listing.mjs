/**
 * Validate Revel's OKX.AI ASP listing against marketplace rules.
 *
 * Pure-local check (`onchainos agent validate-listing` makes no network call).
 * Reads the committed submission materials in `okx/` so what is validated is
 * exactly what gets submitted — the previous version read an untracked
 * `.tmp-revel-service.json`, so the submitted payload was never reviewable.
 *
 * Uses execFileSync (no shell): on Windows, passing JSON through a shell
 * mangles the quoting and the CLI reports a spurious PARSE error.
 *
 *   node scripts/validate-revel-listing.mjs
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const onchainos =
  process.env.ONCHAINOS_BIN ||
  path.join(os.homedir(), ".local", "bin", "onchainos.exe");

const root = new URL("..", import.meta.url);
const service = readFileSync(new URL("okx/revel-asp-service.json", root), "utf8");
const listing = JSON.parse(
  readFileSync(new URL("okx/revel-asp-listing.json", root), "utf8")
);

// Fail fast on shape before shelling out, so errors point at our file.
const parsed = JSON.parse(service);
if (!Array.isArray(parsed) || parsed.length === 0) {
  throw new Error("okx/revel-asp-service.json must be a non-empty JSON array");
}

const args = [
  "agent",
  "validate-listing",
  "--role",
  "asp",
  "--name",
  listing.name,
  "--description",
  listing.description,
  "--service",
  JSON.stringify(parsed),
];

let out;
let failed = false;
try {
  out = execFileSync(onchainos, args, { encoding: "utf8" });
} catch (error) {
  // The CLI exits non-zero when the listing does not pass; its JSON report is
  // still the useful output.
  out = `${error.stdout ?? ""}${error.stderr ?? ""}` || String(error);
  failed = true;
}

process.stdout.write(out);

let report;
try {
  report = JSON.parse(out);
} catch {
  process.exit(failed ? 1 : 0);
}

if (report?.pass === true) {
  console.log("\nListing PASSES local marketplace validation.");
  process.exit(0);
}

const blocking = (report?.findings ?? []).filter((f) => f.severity === "block");
console.log(
  `\nListing does NOT pass: ${blocking.length} blocking finding(s).`
);
process.exit(1);
