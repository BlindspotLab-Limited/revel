import assert from "node:assert/strict";
import { NextRequest } from "next/server";

/**
 * What a paid MCP call looks like *after* the buyer signs — the half of the
 * x402 flow x402-paywall.test.ts never reached, and where OKX's 2026-10-24
 * rejection came from. The facilitator is mocked at `fetch`; nothing is ever
 * verified or settled for real, and the test fails if anything other than
 * the read-only `supported` call reaches it.
 */

// EIP-55 test-vector address — not a real payout destination.
process.env.OKX_API_KEY = "test-key";
process.env.OKX_SECRET_KEY = "test-secret";
process.env.OKX_PASSPHRASE = "test-passphrase";
process.env.OKX_PAY_TO = "0x52908400098527886E0F7030069857D2E4169EE7";
delete process.env.OKX_PAY_NETWORK;
delete process.env.OKX_PAY_ASSET;
delete process.env.MCP_API_KEY;

const facilitatorCalls: string[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.startsWith("https://web3.okx.com/")) {
    facilitatorCalls.push(new URL(url).pathname);
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

function mcpPost(body: string, accept = "application/json, text/event-stream") {
  return new NextRequest("https://tryrevel.xyz/api/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", accept },
    ...(body ? { body } : {}),
  });
}

async function main() {
  const { asX402ApiClientRequest, withholdSettlementOnMcpError, X402_API_CLIENT_ACCEPT } =
    await import("@/lib/billing/x402-response");
  const { handleMcpHttpRequest } = await import("@/lib/mcp/http-transport");
  const mcp = await import("@/app/api/mcp/route");

  // --- 1. The request withX402 hands the handler after payment ------------
  // withX402 passes the handler the same request it was given, i.e. the one
  // asX402ApiClientRequest built. It must stay MCP-compliant.
  const browserish = new NextRequest("https://tryrevel.xyz/api/mcp", {
    method: "POST",
    headers: {
      accept: "text/html,application/xhtml+xml",
      "user-agent": "Mozilla/5.0",
      "content-type": "application/json",
    },
  });
  const forced = asX402ApiClientRequest(browserish, "{}");
  const accept = forced.headers.get("accept") ?? "";
  assert.equal(accept, X402_API_CLIENT_ACCEPT);
  assert.ok(accept.includes("application/json"));
  assert.ok(accept.includes("text/event-stream"), "MCP requires text/event-stream");
  assert.ok(!accept.includes("text/html"), "text/html would trigger the HTML paywall");
  assert.ok(!/Mozilla/.test(forced.headers.get("user-agent") ?? ""));

  // Regression: this exact request used to get HTTP 406 from the MCP SDK,
  // so every paid call failed after the buyer had signed.
  const listBody = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" });
  const replay = await handleMcpHttpRequest(
    asX402ApiClientRequest(mcpPost(listBody, "application/json"), listBody)
  );
  assert.equal(replay.status, 200, "MCP SDK must accept the forced Accept header");
  const tools = (await replay.json()).result.tools.map((t: { name: string }) => t.name);
  assert.ok(tools.includes("revel_analyze_website"));

  // Control: Accept application/json alone is still a 406, proving the
  // previous forced value was the cause.
  const rejected = await handleMcpHttpRequest(mcpPost(listBody, "application/json"));
  assert.equal(rejected.status, 406);

  // --- 2. A paid call that fails must not be settled ----------------------
  const json = { "content-type": "application/json" };
  const toolError = await withholdSettlementOnMcpError(
    new Response(
      JSON.stringify({ jsonrpc: "2.0", id: 1, result: { content: [], isError: true } }),
      { status: 200, headers: json }
    )
  );
  assert.equal(toolError.status, 422, "tool error must not settle");
  assert.equal((await toolError.json()).result.isError, true, "body kept intact");

  const rpcError = await withholdSettlementOnMcpError(
    new Response(
      JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32602, message: "bad" } }),
      { status: 200, headers: json }
    )
  );
  assert.equal(rpcError.status, 422, "JSON-RPC error must not settle");

  const success = await withholdSettlementOnMcpError(
    new Response(
      JSON.stringify({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: "ok" }] } }),
      { status: 200, headers: json }
    )
  );
  assert.equal(success.status, 200, "success still settles");
  assert.equal((await success.json()).result.content[0].text, "ok", "body still readable");

  const alreadyFailed = await withholdSettlementOnMcpError(
    new Response("{}", { status: 406, headers: json })
  );
  assert.equal(alreadyFailed.status, 406);

  // --- 3. Requests that can never succeed get no 402 ----------------------
  const cannotSucceed = [
    JSON.stringify([
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "revel_analyze_website", arguments: { url: "https://example.com" } },
      },
    ]),
    JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: {} }),
    JSON.stringify({ hello: "world" }),
    "not json",
  ];
  for (const body of cannotSucceed) {
    const res = await mcp.POST(mcpPost(body));
    assert.equal(res.status, 400, `no 402 for: ${body.slice(0, 60)}`);
    assert.equal(res.headers.get("PAYMENT-REQUIRED"), null);
  }

  // The bare discovery probe keeps its 402 (marketplace x402 self-check).
  for (const body of ["", "{}"]) {
    const res = await mcp.POST(mcpPost(body));
    assert.equal(res.status, 402, `probe ${JSON.stringify(body)} still challenged`);
    assert.ok(res.headers.get("PAYMENT-REQUIRED"));
  }

  // A valid billable call is still challenged, unchanged.
  const valid = await mcp.POST(
    mcpPost(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 7,
        method: "tools/call",
        params: { name: "revel_analyze_website", arguments: { url: "https://example.com" } },
      })
    )
  );
  assert.equal(valid.status, 402);

  assert.ok(facilitatorCalls.every((p) => p === "/api/v6/pay/x402/supported"));
  console.log("x402 paid replay: ok");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
