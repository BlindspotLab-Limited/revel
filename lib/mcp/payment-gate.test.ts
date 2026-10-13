import assert from "node:assert/strict";
import {
  isBillableMcpTool,
  mcpBodyRequiresPayment,
} from "@/lib/mcp/payment-gate";

function rpc(method: string, params?: Record<string, unknown>) {
  return JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method,
    params,
  });
}

assert.equal(mcpBodyRequiresPayment(rpc("initialize", {})), false);
assert.equal(mcpBodyRequiresPayment(rpc("tools/list", {})), false);
assert.equal(mcpBodyRequiresPayment(rpc("ping")), false);
assert.equal(
  mcpBodyRequiresPayment(rpc("tools/call", { name: "revel_health" })),
  false
);
assert.equal(
  mcpBodyRequiresPayment(
    rpc("tools/call", { name: "revel_get_analysis", arguments: {} })
  ),
  false
);
assert.equal(
  mcpBodyRequiresPayment(
    rpc("tools/call", { name: "revel_export_blueprint", arguments: {} })
  ),
  false
);
assert.equal(
  mcpBodyRequiresPayment(
    rpc("tools/call", {
      name: "revel_analyze_website",
      arguments: { url: "https://example.com" },
    })
  ),
  true
);
assert.equal(
  mcpBodyRequiresPayment(
    rpc("tools/call", {
      name: "revel_analyze_website_and_wait",
      arguments: { url: "https://example.com" },
    })
  ),
  true
);
assert.equal(
  mcpBodyRequiresPayment(
    JSON.stringify([
      { jsonrpc: "2.0", id: 1, method: "tools/list" },
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "revel_analyze_website" },
      },
    ])
  ),
  true
);
// A bare POST with no body is the OKX x402 validator's own probe
// (`curl -i -X POST <endpoint>` → expect 402 + PAYMENT-REQUIRED), so it must
// require payment. This assertion previously expected `false` and had been
// failing since commit 191af40 changed the implementation to match the
// marketplace requirement.
assert.equal(mcpBodyRequiresPayment(""), true);
assert.equal(mcpBodyRequiresPayment("   "), true);
assert.equal(mcpBodyRequiresPayment("not json"), true);
assert.equal(mcpBodyRequiresPayment("[]"), true);
assert.equal(mcpBodyRequiresPayment("{}"), true);
assert.equal(isBillableMcpTool("revel_analyze_website"), true);
assert.equal(isBillableMcpTool("revel_health"), false);

console.log("payment-gate tests passed");
