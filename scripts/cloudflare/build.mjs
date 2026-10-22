#!/usr/bin/env node
/**
 * Cloudflare Workers production build (Workers Builds "Build command").
 *
 *   npm run build:cloudflare
 *
 * 1. Writes wrangler.deploy.jsonc (adds the Hyperdrive id from the
 *    CLOUDFLARE_HYPERDRIVE_ID build variable).
 * 2. Generates both Prisma clients (Node.js + workerd runtime).
 * 3. Runs `opennextjs-cloudflare build` (which runs `next build`) with
 *    REVEL_BUILD_TARGET=cloudflare so the workerd Prisma client is bundled.
 *
 * Never contacts the database and never runs migrations.
 */
import { spawnSync } from "node:child_process";
import { DEPLOY_CONFIG, ROOT, isWorkersCi, writeDeployConfig } from "./wrangler-config.mjs";

function run(command, args, extraEnv = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    stdio: "inherit",
    env: { ...process.env, ...extraEnv },
  });
  if (result.status !== 0) {
    console.error(`\n[cloudflare-build] "${command} ${args.join(" ")}" failed.`);
    process.exit(result.status ?? 1);
  }
}

function warnMissingBuildVariables() {
  // NEXT_PUBLIC_* values are inlined into the bundle by `next build`, so
  // they must be Workers Builds *build* variables, not only runtime vars.
  const expected = ["NEXT_PUBLIC_APP_URL", "NEXT_PUBLIC_ENABLE_SUBDOMAIN_REDIRECTS"];
  const missing = expected.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    const message =
      `[cloudflare-build] Build variable(s) not set: ${missing.join(", ")}. ` +
      "Production URLs and subdomain routing are baked in at build time.";
    if (isWorkersCi()) {
      console.error(`${message} Set them under Settings → Build → Variables and secrets.`);
      process.exit(1);
    }
    console.warn(`${message} (local build: continuing with defaults)`);
  }
}

warnMissingBuildVariables();

let hyperdriveId;
try {
  ({ hyperdriveId } = writeDeployConfig());
} catch (error) {
  console.error(`\n[cloudflare-build] ${error instanceof Error ? error.message : error}\n`);
  process.exit(1);
}
console.log(
  `[cloudflare-build] Wrote ${DEPLOY_CONFIG} (Hyperdrive binding: ${
    hyperdriveId ? "HYPERDRIVE configured" : "not configured — local build only"
  })`
);

run("npx", ["prisma", "generate"]);
run("npx", ["opennextjs-cloudflare", "build", "--config", DEPLOY_CONFIG], {
  REVEL_BUILD_TARGET: "cloudflare",
});
