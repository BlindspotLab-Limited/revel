#!/usr/bin/env node
/**
 * Cloudflare Workers deploy (Workers Builds "Deploy command").
 *
 *   npm run deploy:cloudflare             → new production version
 *   npm run upload:cloudflare             → upload a version without promoting it
 *   node scripts/cloudflare/deploy.mjs deploy --dry-run   → bundle only, no upload
 *
 * Uses the wrangler.deploy.jsonc written by scripts/cloudflare/build.mjs so
 * the deployed Worker gets exactly the bindings it was built with.
 * Never runs database migrations.
 */
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { DEPLOY_CONFIG, ROOT } from "./wrangler-config.mjs";

const [modeArg, ...passthrough] = process.argv.slice(2);
const mode = modeArg === "upload" ? "upload" : "deploy";
const extraArgs = modeArg === "upload" || modeArg === "deploy" ? passthrough : process.argv.slice(2);

if (!existsSync(DEPLOY_CONFIG)) {
  console.error(
    "[cloudflare-deploy] wrangler.deploy.jsonc is missing. The build command must be " +
      "`npm run build:cloudflare` (see docs/cloudflare-deployment.md)."
  );
  process.exit(1);
}

const env = { ...process.env };
// `opennextjs-cloudflare deploy` reads bindings through Wrangler's local
// platform proxy before uploading, and that proxy refuses a Hyperdrive
// binding without a *local* connection string. Nothing connects to it; the
// deployed Worker uses the real Hyperdrive configuration by id.
env.CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE ||=
  "postgresql://unused:unused@127.0.0.1:5432/unused";

const result = spawnSync(
  "npx",
  ["opennextjs-cloudflare", mode, "--config", DEPLOY_CONFIG, ...extraArgs],
  { cwd: ROOT, stdio: "inherit", env }
);
process.exit(result.status ?? 1);
