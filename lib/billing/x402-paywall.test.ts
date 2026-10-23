import assert from "node:assert/strict";
import { NextRequest } from "next/server";

/**
 * OKX x402 paywall on the real route handlers, with the OKX facilitator
 * mocked at `fetch`. No payment is ever signed, verified or settled: the
 * test fails if anything other than the read-only `supported` call reaches
 * the facilitator.
 */

// EIP-55 test-vector address — not a real payout destination.
const TEST_PAY_TO = "0x52908400098527886E0F7030069857D2E4169EE7";

process.env.OKX_API_KEY = "test-key";
process.env.OKX_SECRET_KEY = "test-secret";
process.env.OKX_PASSPHRASE = "test-passphrase";
process.env.OKX_PAY_TO = TEST_PAY_TO;
delete process.env.OKX_PAY_NETWORK;
delete process.env.OKX_PAY_ASSET;
delete process.env.MCP_API_KEY;

const facilitatorCalls: string[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.startsWith("https://web3.okx.com/")) {
    facilitatorCalls.push(new URL(url).pathname);
    const headers = new Headers(init?.headers);
    // Requests are HMAC-signed with node:crypto (nodejs_compat on Workers).
    assert.ok(headers.get("OK-ACCESS-SIGN"), "facilitator requests are signed");
    if (url.endsWith("/api/v6/pay/x402/supported")) {
      return Response.json({
        code: "0",
        data: {
          kinds: [{ x402Version: 2, scheme: "exact", network: "eip155:196" }],
          extensions: [],
          signers: {},
        },
      });
    }
    throw new Error(`unexpected facilitator call (would move money): ${url}`);
  }
  return realFetch(input, init);
}) as typeof fetch;

function decodeChallenge(header: string | null) {
  assert.ok(header, "PAYMENT-REQUIRED header present");
  return JSON.parse(Buffer.from(header, "base64").toString("utf8"));
}

async function main() {
  const audit = await import("@/app/api/audit/route");
  const mcp = await import("@/app/api/mcp/route");

  // /api/audit without payment → standard x402 challenge, never HTML.
  const auditRes = await audit.POST(
    new NextRequest("https://tryrevel.xyz/api/audit", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        // A browser-looking client must still get the JSON challenge.
        accept: "text/html",
        "user-agent": "Mozilla/5.0",
      },
      body: JSON.stringify({ url: "https://example.com" }),
    })
  );
  assert.equal(auditRes.status, 402);
  assert.match(auditRes.headers.get("content-type") ?? "", /application\/json/);
  assert.match(
    auditRes.headers.get("access-control-expose-headers") ?? "",
    /PAYMENT-REQUIRED/
  );
  const auditChallenge = decodeChallenge(auditRes.headers.get("PAYMENT-REQUIRED"));
  assert.equal(auditChallenge.x402Version, 2);
  const accept = auditChallenge.accepts[0];
  assert.equal(accept.scheme, "exact");
  assert.equal(accept.network, "eip155:196");
  assert.equal(accept.payTo, TEST_PAY_TO);
  assert.deepEqual(await auditRes.json(), auditChallenge, "body mirrors the header");

  // MCP: free methods stay free, billable tools require payment.
  const rpc = (method: string, params?: unknown) =>
    new NextRequest("https://tryrevel.xyz/api/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });

  const list = await mcp.POST(rpc("tools/list"));
  assert.equal(list.status, 200);
  const tools = (await list.json()).result.tools.map((t: { name: string }) => t.name);
  assert.ok(tools.includes("revel_analyze_website"));

  const paid = await mcp.POST(
    rpc("tools/call", { name: "revel_analyze_website", arguments: { url: "https://example.com" } })
  );
  assert.equal(paid.status, 402);
  assert.equal(decodeChallenge(paid.headers.get("PAYMENT-REQUIRED")).x402Version, 2);
  assert.equal(paid.headers.get("access-control-allow-origin"), "*");

  // Only the read-only capability lookup reached the facilitator.
  assert.ok(facilitatorCalls.length >= 1);
  assert.ok(facilitatorCalls.every((p) => p === "/api/v6/pay/x402/supported"));

  console.log("x402 paywall (mocked facilitator): ok");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
