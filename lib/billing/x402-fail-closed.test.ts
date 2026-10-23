import assert from "node:assert/strict";
import { NextRequest } from "next/server";

/**
 * Billing must fail closed: with no OKX credentials, or with a facilitator
 * that rejects them, paid routes answer an explicit JSON 503 — never a
 * self-minted 402 (which would invite payments we cannot settle) and never
 * an empty 500. Facilitator mocked at `fetch`; no payment is attempted.
 */

const TEST_PAY_TO = "0x52908400098527886E0F7030069857D2E4169EE7";
delete process.env.MCP_API_KEY;

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.startsWith("https://web3.okx.com/")) {
    if (url.endsWith("/supported")) {
      return Response.json({ code: "50111", msg: "Invalid OK-ACCESS-KEY" }, { status: 401 });
    }
    throw new Error(`unexpected facilitator call: ${url}`);
  }
  return realFetch(input, init);
}) as typeof fetch;

const auditRequest = () =>
  new NextRequest("https://tryrevel.xyz/api/audit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: "https://example.com" }),
  });

async function main() {
  const audit = await import("@/app/api/audit/route");
  const mcp = await import("@/app/api/mcp/route");

  // 1. Credentials absent → 503 with a hint, billing manifest says disabled.
  for (const key of ["OKX_API_KEY", "OKX_SECRET_KEY", "OKX_PASSPHRASE", "OKX_PAY_TO"]) {
    delete process.env[key];
  }
  const missing = await audit.POST(auditRequest());
  assert.equal(missing.status, 503);
  const missingBody = await missing.json();
  assert.equal(missingBody.error, "OKX billing is not configured");
  assert.equal(missingBody.billing.enabled, false);

  // MCP with neither billing nor MCP_API_KEY → HTTP transport disabled (503).
  const mcpOff = await mcp.POST(
    new NextRequest("https://tryrevel.xyz/api/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    })
  );
  assert.equal(mcpOff.status, 503);

  // 2. Credentials present but rejected by the facilitator → 503, retryable.
  process.env.OKX_API_KEY = "rejected-key";
  process.env.OKX_SECRET_KEY = "rejected-secret";
  process.env.OKX_PASSPHRASE = "rejected-passphrase";
  process.env.OKX_PAY_TO = TEST_PAY_TO;

  const rejected = await audit.POST(auditRequest());
  assert.equal(rejected.status, 503);
  assert.equal(rejected.headers.get("PAYMENT-REQUIRED"), null, "no 402 challenge");
  const body = await rejected.json();
  assert.equal(body.error, "Payment facilitator unavailable");
  assert.equal(body.retryable, true);

  const paidMcp = await mcp.POST(
    new NextRequest("https://tryrevel.xyz/api/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "revel_analyze_website", arguments: { url: "https://example.com" } },
      }),
    })
  );
  assert.equal(paidMcp.status, 503);
  assert.equal(paidMcp.headers.get("access-control-allow-origin"), "*");

  console.log("x402 fail-closed (mocked facilitator): ok");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
