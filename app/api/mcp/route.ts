import { NextRequest, NextResponse } from "next/server";
import { withX402 } from "@okxweb3/app-x402-next";
import {
  getMcpRouteConfig,
  getOkxBillingManifest,
  getOkxResourceServer,
  getResourceServerReadiness,
  isOkxBillingEnabled,
  okxBillingUnavailableBody,
} from "@/lib/billing/okx-x402";
import {
  applyX402Cors,
  asX402ApiClientRequest,
  withholdSettlementOnMcpError,
} from "@/lib/billing/x402-response";
import {
  isMcpHttpEnabled,
  mcpUnauthorizedResponse,
  validateMcpRequest,
} from "@/lib/mcp/auth";
import { handleMcpHttpRequest } from "@/lib/mcp/http-transport";
import {
  extractBillableToolCall,
  isPaymentProbeBody,
  mcpBodyRequiresPayment,
  REVEL_BILLABLE_MCP_TOOLS,
  validateBillableToolArguments,
} from "@/lib/mcp/payment-gate";

export const runtime = "nodejs";
// Ignored on Cloudflare Workers (no wall-clock limit; audits run in a
// Workflow). Kept only while Vercel remains the rollback target — see
// docs/cloudflare-deployment.md → "Remove Vercel safely".
export const maxDuration = 300;

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Revel-MCP-Key, Mcp-Session-Id, MCP-Protocol-Version, PAYMENT-SIGNATURE, X-PAYMENT, payment-signature, x-payment",
  "Access-Control-Expose-Headers":
    "MCP-Protocol-Version, Mcp-Session-Id, PAYMENT-REQUIRED, PAYMENT-RESPONSE",
};

function applyCors(response: Response): NextResponse {
  return applyX402Cors(response, corsHeaders);
}

function cloneRequestWithBody(
  request: NextRequest,
  bodyText: string
): NextRequest {
  const init: ConstructorParameters<typeof NextRequest>[1] = {
    method: request.method,
    headers: request.headers,
    ...(bodyText.length > 0
      ? { body: bodyText, duplex: "half" as const }
      : {}),
  };
  return new NextRequest(request.url, init);
}

async function mcpPostHandler(
  request: NextRequest,
  paid: boolean
): Promise<NextResponse> {
  const response = await handleMcpHttpRequest(request, {
    source: "mcp_okx",
    paid,
  });
  // Paid only: an MCP error comes back as HTTP 200, which withX402 would
  // settle. Re-issue it as 422 so the buyer is never charged for a failure.
  return applyCors(paid ? await withholdSettlementOnMcpError(response) : response);
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function GET() {
  if (!isMcpHttpEnabled()) {
    return Response.json(
      {
        error: "MCP HTTP is disabled. Set MCP_API_KEY or OKX billing env vars.",
      },
      { status: 503, headers: corsHeaders }
    );
  }

  return Response.json(
    {
      service: "revel-mcp",
      transport: "streamable-http",
      methods: ["POST", "DELETE", "GET", "OPTIONS"],
      manifest: "/api/mcp/manifest",
      docs: "/docs/mcp",
      billing: getOkxBillingManifest(),
      payments:
        isOkxBillingEnabled()
          ? {
              protocol: "x402",
              agentPaymentsProtocol: "okx-agent-payments-protocol",
              requiredOn: "tools/call (billable)",
              billableTools: [...REVEL_BILLABLE_MCP_TOOLS],
              headers: ["PAYMENT-SIGNATURE", "X-PAYMENT"],
            }
          : null,
    },
    { headers: corsHeaders }
  );
}

export async function POST(request: NextRequest) {
  if (!isMcpHttpEnabled()) {
    return Response.json(
      {
        error: "MCP HTTP is disabled. Set MCP_API_KEY or OKX billing env vars.",
        billing: getOkxBillingManifest(),
      },
      { status: 503, headers: corsHeaders }
    );
  }

  const bodyText = await request.text();
  const requestWithBody = cloneRequestWithBody(request, bodyText);

  const mcpDevBypass =
    validateMcpRequest(requestWithBody) &&
    (process.env.NODE_ENV === "development" || !isOkxBillingEnabled());

  if (mcpDevBypass) {
    return applyCors(
      await handleMcpHttpRequest(requestWithBody, {
        source: "mcp_dev",
        paid: false,
      })
    );
  }

  if (isOkxBillingEnabled()) {
    if (!mcpBodyRequiresPayment(bodyText)) {
      return mcpPostHandler(requestWithBody, false);
    }

    // OKX review finding: a buyer was charged, then only afterward told the
    // call's arguments were missing or invalid — the tool handler's own Zod
    // validation ran after withX402 had already settled payment. Validate a
    // billable tools/call's arguments here, before any 402 challenge is
    // issued, using the same rules the handler enforces
    // (validateBillableToolArguments mirrors create-server.ts's schemas and
    // calls the same normalizeUrlSafe). An invalid call gets the identical
    // MCP JSON-RPC error shape the SDK itself returns for a free call
    // (HTTP 200, result.isError: true) — free, because nothing billable
    // could have succeeded anyway.
    const billableCall = extractBillableToolCall(bodyText);
    if (billableCall) {
      const validation = await validateBillableToolArguments(
        billableCall.toolName,
        billableCall.args
      );
      if (!validation.ok) {
        return applyCors(
          NextResponse.json({
            jsonrpc: "2.0",
            id: billableCall.id ?? null,
            result: {
              content: [
                {
                  type: "text",
                  text: `MCP error -32602: Invalid arguments for tool ${billableCall.toolName}: ${validation.error}`,
                },
              ],
              isError: true,
            },
          })
        );
      }
    } else if (!isPaymentProbeBody(bodyText)) {
      // Treated as paid by mcpBodyRequiresPayment, but not a single
      // well-formed billable tools/call: a batch, a tools/call with no tool
      // name, non-JSON, or a message with no method. None of these can
      // succeed after payment, so none receives a 402 challenge. Only the
      // bare discovery probe (empty body or `{}`) still does.
      let parses = true;
      try {
        JSON.parse(bodyText);
      } catch {
        parses = false;
      }
      return applyCors(
        NextResponse.json(
          {
            jsonrpc: "2.0",
            id: null,
            error: parses
              ? {
                  code: -32600,
                  message:
                    "Invalid Request: a paid call must be one JSON-RPC tools/call for revel_analyze_website or revel_analyze_website_and_wait, with arguments.url. Batches are not supported for paid tools.",
                }
              : { code: -32700, message: "Parse error: body is not valid JSON" },
          },
          { status: 400 }
        )
      );
    }

    // Readiness is checked without throwing: a rejected-credential facilitator
    // used to surface as an empty HTTP 500 from this line, which breaks every
    // paid client and fails OKX's x402 validator.
    const readiness = await getResourceServerReadiness();
    if (!readiness.ok) {
      return applyCors(
        NextResponse.json(okxBillingUnavailableBody(readiness.error), {
          status: 503,
        })
      );
    }

    try {
      // Force non-browser headers so SDK emits PAYMENT-REQUIRED (not HTML paywall).
      const paidRequest = asX402ApiClientRequest(requestWithBody, bodyText);
      const paidPost = withX402(
        (req) => mcpPostHandler(req, true),
        getMcpRouteConfig(),
        getOkxResourceServer()
      );
      return applyCors(await paidPost(paidRequest));
    } catch (error) {
      const { logServerError } = await import("@/lib/safe-client-error");
      logServerError("mcp_x402_paywall_failed", error);
      return applyCors(
        NextResponse.json(
          okxBillingUnavailableBody(
            error instanceof Error ? error.message : "x402 paywall error"
          ),
          { status: 503 }
        )
      );
    }
  }

  return applyCors(mcpUnauthorizedResponse());
}

export async function DELETE(request: Request) {
  if (!validateMcpRequest(request)) {
    return applyCors(mcpUnauthorizedResponse());
  }

  return applyCors(
    await handleMcpHttpRequest(request, { source: "mcp_dev", paid: false })
  );
}
