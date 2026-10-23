/**
 * Manually ping IndexNow for the public pages: `npm run indexnow:ping`.
 *
 * Production re-indexing runs from the Cloudflare cron trigger (daily
 * 06:00 UTC → /api/indexnow, see cloudflare/worker.ts). This script no
 * longer runs as a build hook, so ordinary CI builds never submit URLs.
 *
 * Uses NEXT_PUBLIC_APP_URL (default https://tryrevel.xyz).
 * Set INDEXNOW_DISABLED=true to skip.
 */

const INDEXNOW_ENDPOINTS = [
  "https://api.indexnow.org/indexnow",
  "https://www.bing.com/indexnow",
];

const PUBLIC_PATHS = [
  "/",
  "/features",
  "/pricing",
  "/about",
  "/contact",
  "/partners",
  "/docs",
  "/docs/getting-started",
  "/docs/how-it-works",
  "/docs/api",
  "/docs/partners",
  "/docs/integrations",
  "/docs/mcp",
  "/docs/ecosystem",
  "/docs/faq",
  "/docs/sample-reports",
  "/privacy",
  "/terms",
  "/llms.txt",
  "/llms-full.txt",
  "/ai.txt",
];

const force = process.argv.includes("--force");

function shouldRun() {
  if (process.env.INDEXNOW_DISABLED === "true") {
    return false;
  }

  // Explicit opt-in only: never submit as a side effect of a build.
  return force;
}

function siteUrl() {
  const raw = (process.env.NEXT_PUBLIC_APP_URL ?? "https://tryrevel.xyz")
    .trim()
    .replace(/\/$/, "");
  if (/^https?:\/\//i.test(raw)) {
    return raw;
  }
  return `https://${raw}`;
}

async function submitToIndexNow() {
  const base = siteUrl();
  const host = new URL(base).host;
  const key = process.env.INDEXNOW_KEY ?? "revel-tryrevel-indexnow";
  const keyLocation = `${base}/${key}.txt`;
  const urlList = PUBLIC_PATHS.map((path) => `${base}${path}`);

  const body = { host, key, keyLocation, urlList };

  const results = await Promise.all(
    INDEXNOW_ENDPOINTS.map(async (endpoint) => {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify(body),
      });
      return { endpoint, status: response.status };
    })
  );

  return { urlList, results };
}

async function main() {
  if (!shouldRun()) {
    console.log("[indexnow] Skipped (run with --force: npm run indexnow:ping).");
    return;
  }

  try {
    const { urlList, results } = await submitToIndexNow();
    const sha = process.env.WORKERS_CI_COMMIT_SHA?.slice(0, 7) ?? "manual";

    console.log(
      `[indexnow] Submitted ${urlList.length} URLs after deploy ${sha}.`
    );
    for (const { endpoint, status } of results) {
      console.log(`[indexnow] ${endpoint} → ${status}`);
    }
  } catch (error) {
    // Never fail the build — indexing is best-effort
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[indexnow] Ping failed (non-fatal): ${message}`);
  }
}

main();