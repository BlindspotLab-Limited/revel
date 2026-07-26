import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const onchainos = path.join(os.homedir(), ".local", "bin", "onchainos.exe");
const service = readFileSync(
  new URL("../.tmp-revel-service.json", import.meta.url),
  "utf8"
).trim();

const out = execFileSync(
  onchainos,
  [
    "agent",
    "validate-listing",
    "--role",
    "asp",
    "--name",
    "Revel",
    "--description",
    "Audits websites and product experiences, then returns a Reveal Index, Blindspot Map, Blueprint, and prioritized Action Queue for growth teams.",
    "--service",
    service,
  ],
  { encoding: "utf8" }
);

process.stdout.write(out);