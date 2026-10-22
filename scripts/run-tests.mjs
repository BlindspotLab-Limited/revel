// Minimal test runner: executes every *.test.ts via tsx and reports a summary.
// The project has no test framework; each test file is a plain node:assert
// script that throws on failure.
import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = process.cwd();
const SKIP = new Set([
  "node_modules",
  ".next",
  ".open-next",
  ".wrangler",
  ".git",
  "generated",
]);

function findTests(dir, found = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) findTests(full, found);
    else if (entry.endsWith(".test.ts")) {
      found.push(relative(ROOT, full).split(sep).join("/"));
    }
  }
  return found;
}

const tests = findTests(ROOT).sort();
if (tests.length === 0) {
  console.error("No *.test.ts files found");
  process.exit(1);
}

let failed = 0;
for (const test of tests) {
  const result = spawnSync("npx", ["tsx", test], {
    encoding: "utf8",
    shell: true,
  });
  const ok = result.status === 0;
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${test}`);
  if (!ok) {
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`
      .split("\n")
      .filter((line) => !line.startsWith("npm notice"))
      .slice(0, 25)
      .join("\n");
    console.log(output);
  }
}

console.log(`\n${tests.length - failed}/${tests.length} test files passed`);
process.exit(failed > 0 ? 1 : 0);
