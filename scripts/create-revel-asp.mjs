/**
 * Submit (or re-submit) Revel's OKX.AI ASP listing.
 *
 * Reads the committed submission materials in `okx/` so the payload is
 * reviewable in version control — the previous version read an untracked
 * `.tmp-revel-service.json`, which is why the rejected submission could not be
 * inspected afterwards.
 *
 * THIS CALLS THE NETWORK AND CREATES A LISTING. It refuses to run unless
 * the listing passes local validation AND --confirm is passed:
 *
 *   node scripts/validate-revel-listing.mjs      # safe, local, no network
 *   node scripts/create-revel-asp.mjs --confirm  # submits
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const onchainos =
  process.env.ONCHAINOS_BIN ||
  path.join(os.homedir(), ".local", "bin", "onchainos.exe");

const root = new URL("..", import.meta.url);
const listing = JSON.parse(
  readFileSync(new URL("okx/revel-asp-listing.json", root), "utf8")
);
const service = JSON.parse(
  readFileSync(new URL("okx/revel-asp-service.json", root), "utf8")
);

const serviceJson = JSON.stringify(service);

// --- Gate 1: must pass local marketplace validation ---
const validateArgs = [
  "agent",
  "validate-listing",
  "--role",
  "asp",
  "--name",
  listing.name,
  "--description",
  listing.description,
  "--service",
  serviceJson,
];

let validateOut;
try {
  validateOut = execFileSync(onchainos, validateArgs, { encoding: "utf8" });
} catch (error) {
  validateOut = `${error.stdout ?? ""}${error.stderr ?? ""}`;
}

let report;
try {
  report = JSON.parse(validateOut);
} catch {
  console.error("Could not parse validator output:\n" + validateOut);
  process.exit(1);
}

if (report.pass !== true) {
  console.error("Listing does not pass local validation. Not submitting.\n");
  console.error(validateOut);
  process.exit(1);
}

console.log("Local validation: PASS");

// --- Gate 2: explicit confirmation ---
if (!process.argv.includes("--confirm")) {
  console.log(
    [
      "",
      "Dry run only — nothing was submitted.",
      "",
      `  name:     ${listing.name}`,
      `  role:     ${listing.role}`,
      `  services: ${service.length}`,
      `  endpoint: ${service[0]?.endpoint}`,
      `  fee:      ${service[0]?.fee}`,
      "",
      "Re-run with --confirm to create the listing.",
    ].join("\n")
  );
  process.exit(0);
}

const createArgs = [
  "agent",
  "create",
  "--role",
  listing.role,
  "--name",
  listing.name,
  "--description",
  listing.description,
  "--picture",
  listing.picture,
  "--service",
  serviceJson,
];

const out = execFileSync(onchainos, createArgs, { encoding: "utf8" });
process.stdout.write(out);
