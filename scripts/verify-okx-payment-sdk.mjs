import fs from "node:fs";
import path from "node:path";

const pkgPath = path.join(process.cwd(), "package.json");
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));

const requiredDeps = [
  "@okxweb3/app-x402-next",
  "@okxweb3/app-x402-core",
  "@okxweb3/app-x402-evm",
];

const allDeps = {
  ...(pkg.dependencies ?? {}),
  ...(pkg.devDependencies ?? {}),
};

const missing = requiredDeps.filter((dep) => !allDeps[dep]);

if (missing.length > 0) {
  console.error(
    `Missing official OKX payment SDK packages: ${missing.join(", ")}`
  );
  process.exit(1);
}

console.log(
  `Official OKX payment SDK packages present: ${requiredDeps.join(", ")}`
);
