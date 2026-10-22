/**
 * Verifies the dev machine can reach Google OAuth endpoints (server-side).
 * Run: node scripts/test-google-oauth-connectivity.mjs
 */
const ENDPOINTS = [
  "https://oauth2.googleapis.com/token",
  "https://openidconnect.googleapis.com/v1/userinfo",
  "https://accounts.google.com/.well-known/openid-configuration",
];

const TIMEOUT_MS = 20_000;

async function probe(url) {
  const started = Date.now();
  try {
    const response = await fetch(url, {
      method: url.includes("/token") ? "POST" : "GET",
      headers: url.includes("/token")
        ? { "Content-Type": "application/x-www-form-urlencoded" }
        : undefined,
      body: url.includes("/token") ? "grant_type=client_credentials" : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    console.log(`OK   ${url} -> HTTP ${response.status} (${Date.now() - started}ms)`);
    return true;
  } catch (error) {
    const code = error?.cause?.code ?? error?.code ?? error?.message;
    console.error(`FAIL ${url} -> ${code} (${Date.now() - started}ms)`);
    return false;
  }
}

console.log("Testing outbound connectivity to Google OAuth endpoints...\n");

let ok = 0;
for (const endpoint of ENDPOINTS) {
  if (await probe(endpoint)) ok++;
}

console.log(`\n${ok}/${ENDPOINTS.length} endpoints reachable.`);

if (ok < ENDPOINTS.length) {
  console.log(`
If Google sign-in fails locally with ConnectTimeoutError:
  1. Allow node.exe through Windows Firewall (outbound HTTPS)
  2. Disable VPN or enable split-tunnel for googleapis.com
  3. Add to .env.local: NODE_OPTIONS=--dns-result-order=ipv4first
  4. Use email/password locally; Google OAuth should work in production (Cloudflare Workers)
`);
  process.exitCode = 1;
}