#!/usr/bin/env node
/**
 * Revel deployment smoke test.
 *
 *   node scripts/cloudflare/smoke-test.mjs <base-url> [--subdomains] [--write]
 *
 * Read-only by default and safe against staging or production:
 * - never sends a payment header, never signs or settles x402 payments,
 * - never starts an audit, never writes to the database,
 * - only GETs public pages plus unauthenticated API calls whose expected
 *   answer is a refusal (401 / 402 / 404).
 *
 * --subdomains  also checks docs./auth./legal. routing of the base apex.
 * --write       LOCAL/STAGING ONLY: signs up a throwaway user, signs in
 *               with email/password and starts one audit, then polls it to
 *               a terminal state. Refuses to run against tryrevel.xyz.
 *
 * Optional env SMOKE_MCP_API_KEY: sent as the MCP bearer token so the MCP
 * checks also run on deployments without OKX billing (e.g. local preview).
 *
 * Exit code 0 only when every check passes. Prints no secrets.
 */

const args = process.argv.slice(2);
const base = (args.find((a) => !a.startsWith("--")) ?? "").replace(/\/$/, "");
const withSubdomains = args.includes("--subdomains");
const withWrites = args.includes("--write");

if (!/^https?:\/\//.test(base)) {
  console.error("Usage: node scripts/cloudflare/smoke-test.mjs https://<host> [--subdomains] [--write]");
  process.exit(2);
}

const baseUrl = new URL(base);
if (withWrites && /(^|\.)tryrevel\.xyz$/i.test(baseUrl.hostname)) {
  console.error("--write is refused against production hostnames (tryrevel.xyz).");
  process.exit(2);
}

const results = [];
function record(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

async function check(name, fn) {
  try {
    const detail = await fn();
    record(name, true, typeof detail === "string" ? detail : "");
  } catch (error) {
    record(name, false, error instanceof Error ? error.message : String(error));
  }
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

async function get(path, init = {}) {
  return fetch(new URL(path, base), { redirect: "manual", ...init });
}

const SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "strict-origin-when-cross-origin",
};

function expectSecurityHeaders(res) {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    expect(res.headers.get(name) === value, `${name} is ${res.headers.get(name)}`);
  }
}

async function json(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`HTTP ${res.status}, not JSON: ${text.slice(0, 120)}`);
  }
}

// ---------------------------------------------------------------- health
await check("GET /api/health", async () => {
  const res = await get("/api/health");
  expect(res.status === 200, `HTTP ${res.status}`);
  const body = await json(res);
  expect(body.service === "revel" && body.status === "ok", "unexpected body");
  return `okxBilling=${body.okxBilling?.status}`;
});

await check("GET /api/mission-control/health (database + workflow)", async () => {
  const res = await get("/api/mission-control/health");
  expect(res.status === 200, `HTTP ${res.status}`);
  const body = await json(res);
  expect(body.ok === true, "ok=false: database, schema or AUDIT_WORKFLOW binding is not ready");
});

// ---------------------------------------------------------------- pages / SEO
let homepageHtml = "";
for (const path of ["/", "/features", "/pricing", "/about", "/partners", "/docs", "/docs/mcp", "/docs/api", "/privacy", "/terms", "/log-in", "/sign-up"]) {
  await check(`GET ${path}`, async () => {
    const res = await get(path);
    // With subdomain routing on, apex /docs, /privacy, /log-in… redirect to
    // their subdomain: that is correct behaviour, not a failure.
    if (res.status >= 300 && res.status < 400) {
      return `redirect → ${res.headers.get("location")}`;
    }
    expect(res.status === 200, `HTTP ${res.status}`);
    expect((res.headers.get("content-type") ?? "").includes("text/html"), "not HTML");
    expectSecurityHeaders(res);
    const html = await res.text();
    expect(/<title>[^<]+<\/title>/.test(html), "missing <title>");
    expect(html.includes('rel="canonical"'), "missing canonical link");
    if (path === "/") homepageHtml = html;
  });
}

await check("homepage structured data (JSON-LD)", async () => {
  expect(homepageHtml.includes("application/ld+json"), "no JSON-LD script");
});

for (const [path, type] of [
  ["/robots.txt", "text/plain"],
  ["/sitemap.xml", "xml"],
  ["/llms.txt", "text/plain"],
  ["/ai.txt", "text/plain"],
  ["/revel-tryrevel-indexnow.txt", "text/plain"],
  ["/site.webmanifest", ""],
]) {
  await check(`GET ${path}`, async () => {
    const res = await get(path);
    expect(res.status === 200, `HTTP ${res.status}`);
    if (type) expect((res.headers.get("content-type") ?? "").includes(type), res.headers.get("content-type"));
  });
}

await check("static asset caching + headers", async () => {
  const match = homepageHtml.match(/\/_next\/static\/[^"']+\.(?:js|css)/);
  expect(match, "no /_next/static asset referenced by the homepage");
  const res = await get(match[0]);
  expect(res.status === 200, `HTTP ${res.status}`);
  expect((res.headers.get("cache-control") ?? "").includes("immutable"), `cache-control: ${res.headers.get("cache-control")}`);
  expect(res.headers.get("x-content-type-options") === "nosniff", "nosniff missing");
});

await check("scanner probe blocked (/.env → 403)", async () => {
  const res = await get("/.env");
  expect(res.status === 403, `HTTP ${res.status}`);
});

// ---------------------------------------------------------------- auth
await check("GET /api/auth/providers", async () => {
  const res = await get("/api/auth/providers");
  expect(res.status === 200, `HTTP ${res.status}`);
  const body = await json(res);
  expect(body.credentials, "email/password provider missing");
  if (body.google) {
    expect(/\/api\/auth\/callback\/google$/.test(body.google.callbackUrl), "odd google callback");
    return `google callback: ${body.google.callbackUrl}`;
  }
  return "google provider not configured";
});

await check("GET /api/auth/csrf + /api/auth/session", async () => {
  const csrf = await get("/api/auth/csrf");
  expect(csrf.status === 200, `csrf HTTP ${csrf.status}`);
  expect((await json(csrf)).csrfToken, "no csrfToken");
  const session = await get("/api/auth/session");
  expect(session.status === 200, `session HTTP ${session.status}`);
});

await check("unauthenticated /mission-control → sign-in redirect", async () => {
  const res = await get("/mission-control");
  expect(res.status === 307 || res.status === 302, `HTTP ${res.status}`);
  const location = res.headers.get("location") ?? "";
  expect(/\/(log-in|sign-in)/.test(location), `location: ${location}`);
});

// ---------------------------------------------------------------- MCP
const MCP_HEADERS = {
  "content-type": "application/json",
  accept: "application/json, text/event-stream",
  ...(process.env.SMOKE_MCP_API_KEY
    ? { authorization: `Bearer ${process.env.SMOKE_MCP_API_KEY}` }
    : {}),
};

await check("OPTIONS /api/mcp (CORS)", async () => {
  const res = await get("/api/mcp", { method: "OPTIONS" });
  expect(res.status === 204, `HTTP ${res.status}`);
  expect(res.headers.get("access-control-allow-origin") === "*", "allow-origin");
  expect((res.headers.get("access-control-expose-headers") ?? "").includes("PAYMENT-REQUIRED"), "expose headers");
});

await check("GET /api/mcp + /api/mcp/manifest", async () => {
  const res = await get("/api/mcp");
  expect(res.status === 200 || res.status === 503, `HTTP ${res.status}`);
  const manifest = await get("/api/mcp/manifest");
  expect(manifest.status === 200, `manifest HTTP ${manifest.status}`);
  return res.status === 503 ? "MCP HTTP disabled (no MCP_API_KEY / billing)" : "";
});

await check("MCP initialize + tools/list (free methods)", async () => {
  const init = await get("/api/mcp", {
    method: "POST",
    headers: MCP_HEADERS,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "revel-smoke", version: "1" } },
    }),
  });
  if (init.status === 401 || init.status === 503) {
    return `HTTP ${init.status} — MCP needs MCP_API_KEY or OKX billing on this deployment`;
  }
  expect(init.status === 200, `initialize HTTP ${init.status}`);
  expect((await json(init)).result?.serverInfo?.name === "revel-mcp", "serverInfo");
  const list = await get("/api/mcp", {
    method: "POST",
    headers: MCP_HEADERS,
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
  });
  expect(list.status === 200, `tools/list HTTP ${list.status}`);
  const tools = (await json(list)).result.tools.map((t) => t.name);
  expect(tools.includes("revel_analyze_website"), "revel_analyze_website missing");
  return `${tools.length} tools`;
});

// ---------------------------------------------------------------- billing (no payment sent)
await check("POST /api/audit without payment → 402 challenge or 503 fail-closed", async () => {
  const res = await get("/api/audit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: "https://example.com" }),
  });
  expect(res.status === 402 || res.status === 503, `HTTP ${res.status} (must never be 2xx without payment, never 500)`);
  if (res.status === 402) {
    const header = res.headers.get("payment-required");
    expect(header, "402 without PAYMENT-REQUIRED header");
    const challenge = JSON.parse(Buffer.from(header, "base64").toString("utf8"));
    expect(challenge.x402Version === 2, "x402Version");
    return `402 · ${challenge.accepts?.[0]?.network} · payTo ${challenge.accepts?.[0]?.payTo}`;
  }
  return `503 · ${(await json(res)).error}`;
});

await check("GET /api/audit manifest", async () => {
  const res = await get("/api/audit");
  expect(res.status === 200, `HTTP ${res.status}`);
  expect((await json(res)).service === "revel-audit", "service");
});

// ---------------------------------------------------------------- partner + internal
await check("partner API refuses missing key (401)", async () => {
  const res = await get("/api/partner/v1/analyze", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: "https://example.com" }),
  });
  expect(res.status === 401, `HTTP ${res.status}`);
  const health = await get("/api/partner/v1/health");
  expect(health.status === 200, `partner health HTTP ${health.status}`);
});

await check("internal audit endpoint hidden without token (404)", async () => {
  const res = await get("/api/internal/audit-run?op=run", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ analysisId: "6f1c2d0e-1111-4111-8111-111111111111", website: "https://example.com" }),
  });
  expect(res.status === 404, `HTTP ${res.status}`);
});

await check("unknown report → 404", async () => {
  const res = await get("/api/report/6f1c2d0e-1111-4111-8111-111111111111");
  expect(res.status === 404, `HTTP ${res.status}`);
});

// ---------------------------------------------------------------- subdomains
if (withSubdomains) {
  const apex = baseUrl.hostname.replace(/^www\./, "");
  const sub = (label, path = "/") => fetch(`https://${label}.${apex}${path}`, { redirect: "manual" });

  await check(`docs.${apex}/ serves documentation`, async () => {
    const res = await sub("docs");
    expect(res.status === 200, `HTTP ${res.status}`);
  });
  await check(`auth.${apex}/ → /log-in`, async () => {
    const res = await sub("auth");
    expect(res.status >= 300 && res.status < 400 && /\/log-in/.test(res.headers.get("location") ?? ""), `HTTP ${res.status} ${res.headers.get("location")}`);
  });
  await check(`auth.${apex} Google callback route exists`, async () => {
    const res = await sub("auth", "/api/auth/providers");
    expect(res.status === 200, `HTTP ${res.status}`);
    const body = await json(res);
    if (body.google) {
      expect(body.google.callbackUrl === `https://auth.${apex}/api/auth/callback/google`, body.google.callbackUrl);
    }
  });
  await check(`legal.${apex}/ → /privacy`, async () => {
    const res = await sub("legal");
    expect(res.status >= 300 && res.status < 400 && /\/privacy/.test(res.headers.get("location") ?? ""), `HTTP ${res.status} ${res.headers.get("location")}`);
  });
  await check(`${apex}/docs → docs.${apex}`, async () => {
    const res = await fetch(`https://${apex}/docs`, { redirect: "manual" });
    expect(res.status >= 300 && res.status < 400 && (res.headers.get("location") ?? "").includes(`docs.${apex}`), `HTTP ${res.status}`);
  });
}

// ---------------------------------------------------------------- writes (local / staging only)
if (withWrites) {
  const jar = new Map();
  const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
  const store = (res) => {
    for (const line of res.headers.getSetCookie?.() ?? []) {
      const [pair] = line.split(";");
      const i = pair.indexOf("=");
      jar.set(pair.slice(0, i), pair.slice(i + 1));
    }
  };
  const email = `smoke-${Date.now()}@example.com`;
  const password = `Smoke-${Math.random().toString(36).slice(2)}-Pass1!`;

  await check("sign-up (email/password)", async () => {
    const res = await get("/api/auth/signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password, name: "Smoke Test" }),
    });
    expect(res.status === 200, `HTTP ${res.status}: ${(await res.text()).slice(0, 120)}`);
  });

  await check("sign-in (credentials) → JWT session", async () => {
    const csrfRes = await get("/api/auth/csrf");
    store(csrfRes);
    const { csrfToken } = await json(csrfRes);
    const res = await get("/api/auth/callback/credentials", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", cookie: cookieHeader() },
      body: new URLSearchParams({ csrfToken, email, password, callbackUrl: `${base}/mission-control` }),
    });
    store(res);
    expect(res.status === 302, `HTTP ${res.status}`);
    const session = await json(await get("/api/auth/session", { headers: { cookie: cookieHeader() } }));
    expect(session?.user?.email === email, "no session after sign-in");
  });

  await check("Mission Control renders for the signed-in user", async () => {
    const res = await get("/mission-control", { headers: { cookie: cookieHeader() } });
    expect(res.status === 200, `HTTP ${res.status}`);
  });

  await check("audit: start → durable run → terminal state", async () => {
    const start = await get("/api/analyze", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: cookieHeader() },
      body: JSON.stringify({ url: "https://example.com" }),
    });
    expect(start.status === 200, `start HTTP ${start.status}: ${(await start.clone().text()).slice(0, 160)}`);
    const { id } = await json(start);
    const deadline = Date.now() + 8 * 60_000;
    let status = "processing";
    while (Date.now() < deadline) {
      const res = await get(`/api/report/${id}`, { headers: { cookie: cookieHeader() } });
      const body = await json(res);
      status = body.status;
      if (["completed", "partial", "failed"].includes(status)) break;
      await new Promise((r) => setTimeout(r, 3000));
    }
    expect(["completed", "partial", "failed"].includes(status), `still ${status} after 8 minutes`);

    // Same result through the MCP polling contract, when MCP is reachable.
    if (process.env.SMOKE_MCP_API_KEY) {
      const poll = await get("/api/mcp", {
        method: "POST",
        headers: MCP_HEADERS,
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 3,
          method: "tools/call",
          params: { name: "revel_get_analysis", arguments: { analysisId: id } },
        }),
      });
      expect(poll.status === 200, `MCP revel_get_analysis HTTP ${poll.status}`);
      const text = (await json(poll)).result?.content?.[0]?.text ?? "";
      expect(text.includes(id) && text.includes(status), "MCP poll does not match the stored status");
    }
    return `${id} → ${status}`;
  });

  await check("sign-out", async () => {
    const csrfRes = await get("/api/auth/csrf", { headers: { cookie: cookieHeader() } });
    store(csrfRes);
    const { csrfToken } = await json(csrfRes);
    const res = await get("/api/auth/signout", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", cookie: cookieHeader() },
      body: new URLSearchParams({ csrfToken, callbackUrl: base }),
    });
    expect(res.status === 302, `HTTP ${res.status}`);
  });
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed against ${base}`);
process.exit(failed === 0 ? 0 : 1);
