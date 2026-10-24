import assert from "node:assert/strict";
import {
  extractBillableToolCall,
  isBillableMcpTool,
  isPaymentProbeBody,
  mcpBodyRequiresPayment,
  validateBillableToolArguments,
} from "@/lib/mcp/payment-gate";

function rpc(method: string, params?: Record<string, unknown>) {
  return JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method,
    params,
  });
}

async function main() {
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

  // extractBillableToolCall: only a single (non-batch) billable tools/call
  // yields a result; everything else is null and falls through to the
  // existing mcpBodyRequiresPayment flow unchanged.
  {
    const call = extractBillableToolCall(
      rpc("tools/call", {
        name: "revel_analyze_website",
        arguments: { url: "https://example.com" },
      })
    );
    assert.ok(call);
    assert.equal(call.toolName, "revel_analyze_website");
    assert.deepEqual(call.args, { url: "https://example.com" });
    assert.equal(call.id, 1);
  }
  assert.equal(
    extractBillableToolCall(rpc("tools/call", { name: "revel_health" })),
    null
  );
  assert.equal(extractBillableToolCall(rpc("tools/list")), null);
  assert.equal(
    extractBillableToolCall(
      JSON.stringify([
        {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "revel_analyze_website" },
        },
      ])
    ),
    null
  );
  assert.equal(extractBillableToolCall("not json"), null);
  assert.equal(extractBillableToolCall(""), null);

  // validateBillableToolArguments — the OKX review regression: a billable
  // call with a missing/invalid url must fail here, before any payment
  // decision is made, not only inside the real tool handler afterward.
  const missingUrl = await validateBillableToolArguments(
    "revel_analyze_website",
    {}
  );
  assert.equal(missingUrl.ok, false);

  const emptyUrl = await validateBillableToolArguments(
    "revel_analyze_website",
    { url: "" }
  );
  assert.equal(emptyUrl.ok, false);

  const malformedUrl = await validateBillableToolArguments(
    "revel_analyze_website",
    { url: "not a url" }
  );
  assert.equal(malformedUrl.ok, false);

  const outOfRangeTimeout = await validateBillableToolArguments(
    "revel_analyze_website_and_wait",
    { url: "https://example.com", timeoutSeconds: 10 }
  );
  assert.equal(outOfRangeTimeout.ok, false);

  const validCall = await validateBillableToolArguments(
    "revel_analyze_website",
    { url: "https://example.com" }
  );
  assert.equal(validCall.ok, true);

  const validWithTimeout = await validateBillableToolArguments(
    "revel_analyze_website_and_wait",
    { url: "https://example.com", timeoutSeconds: 120 }
  );
  assert.equal(validWithTimeout.ok, true);

  // isPaymentProbeBody: only empty / `{}` remain 402 discovery probes.
  assert.equal(isPaymentProbeBody(""), true);
  assert.equal(isPaymentProbeBody("   "), true);
  assert.equal(isPaymentProbeBody("{}"), true);
  assert.equal(isPaymentProbeBody("not json"), false);
  assert.equal(isPaymentProbeBody("[]"), false);
  assert.equal(isPaymentProbeBody('{"hello":"world"}'), false);
  assert.equal(
    isPaymentProbeBody(rpc("tools/call", { name: "revel_analyze_website" })),
    false
  );

  console.log("payment-gate tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
