import { NextRequest, NextResponse } from "next/server";

/**
 * OKX x402 marketplace standard:
 * - HTTP 402
 * - PAYMENT-REQUIRED header (base64 JSON, x402 v2)
 * - JSON body with the same challenge
 * - Never HTML paywall (validators fail without PAYMENT-REQUIRED)
 *
 * @okxweb3/app-x402-next treats Accept:text/html + Mozilla UA as a browser and
 * returns HTML *without* PAYMENT-REQUIRED — even with paywallConfig undefined.
 * Force API client headers before withX402 so challenges stay standard.
 *
 * The forced Accept MUST also list text/event-stream. withX402 hands this
 * same request to the route handler once a payment is verified, and the MCP
 * Streamable HTTP transport rejects any POST whose Accept lacks either
 * application/json or text/event-stream with HTTP 406 (SDK 1.29,
 * webStandardStreamableHttp.js). Forcing "application/json" alone made every
 * paid /api/mcp call fail with 406 *after* the buyer had signed — the
 * failure behind OKX's 2026-10-24 rejection. Browser detection only looks
 * for text/html, so this value still yields a standard JSON challenge.
 */
export const X402_API_CLIENT_ACCEPT = "application/json, text/event-stream";

export function asX402ApiClientRequest(
  request: NextRequest,
  bodyText?: string
): NextRequest {
  const headers = new Headers(request.headers);
  // isWebBrowser = accept.includes("text/html") && ua.includes("Mozilla")
  headers.delete("accept");
  headers.set("Accept", X402_API_CLIENT_ACCEPT);
  const ua = headers.get("user-agent") ?? headers.get("User-Agent") ?? "";
  if (/Mozilla/i.test(ua)) {
    headers.set("User-Agent", "Revel-A2MCP-x402-client/1.0");
  }

  const hasBody = typeof bodyText === "string";
  const init: ConstructorParameters<typeof NextRequest>[1] = {
    method: request.method,
    headers,
    ...(hasBody && bodyText!.length > 0
      ? { body: bodyText, duplex: "half" as const }
      : {}),
  };
  return new NextRequest(request.url, init);
}

export function applyX402Cors(
  response: Response,
  corsHeaders: Record<string, string>
): NextResponse {
  const status = response.status;
  const paymentRequired =
    response.headers.get("PAYMENT-REQUIRED") ??
    response.headers.get("payment-required");

  // Standardize 402 challenges for marketplace validators
  if (status === 402 && paymentRequired) {
    let body: unknown = {};
    try {
      body = JSON.parse(
        Buffer.from(paymentRequired, "base64").toString("utf8")
      ) as unknown;
    } catch {
      body = { error: "Payment required", paymentRequiredHeader: true };
    }

    const headers = new Headers();
    // Preserve settlement / protocol headers from the SDK
    response.headers.forEach((value, key) => {
      const lower = key.toLowerCase();
      if (
        lower === "content-type" ||
        lower === "content-length" ||
        lower === "transfer-encoding"
      ) {
        return;
      }
      headers.set(key, value);
    });
    headers.set("Content-Type", "application/json");
    headers.set("PAYMENT-REQUIRED", paymentRequired);
    for (const [key, value] of Object.entries(corsHeaders)) {
      headers.set(key, value);
    }

    return NextResponse.json(body, { status: 402, headers });
  }

  // HTML 402 without header should never ship — surface as error for logs
  if (status === 402) {
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("text/html")) {
      console.error(
        JSON.stringify({
          level: "error",
          source: "revel",
          scope: "x402_html_paywall_leaked",
          message:
            "HTML 402 without PAYMENT-REQUIRED — force API client headers before withX402",
        })
      );
    }
  }

  const next = new NextResponse(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
  for (const [key, value] of Object.entries(corsHeaders)) {
    next.headers.set(key, value);
  }
  return next;
}

/**
 * Paid MCP calls must never be charged for a failure.
 *
 * withX402 settles (moves the buyer's funds) only when the handler's response
 * status is below 400. The MCP SDK reports tool failures — a thrown handler,
 * an argument the tool rejects — as HTTP 200 with `result.isError: true`, and
 * protocol errors as a JSON-RPC `error` object. Left as 200, either would be
 * settled: the buyer pays for an error.
 *
 * For paid calls only, re-issue any such JSON-RPC response with HTTP 422 so
 * settlement is skipped. The body is untouched, so the caller still gets the
 * full error. Successful results, non-JSON bodies and responses already >= 400
 * pass through unchanged.
 */
export async function withholdSettlementOnMcpError(
  response: Response
): Promise<Response> {
  if (response.status >= 400) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  let text: string;
  try {
    text = await response.clone().text();
  } catch {
    return response;
  }

  let failed = false;
  try {
    const parsed: unknown = JSON.parse(text);
    const messages = Array.isArray(parsed) ? parsed : [parsed];
    failed = messages.some((message) => {
      if (typeof message !== "object" || message === null) return false;
      const record = message as {
        error?: unknown;
        result?: { isError?: unknown };
      };
      return record.error !== undefined || record.result?.isError === true;
    });
  } catch {
    return response;
  }

  if (!failed) return response;
  return new Response(text, { status: 422, headers: new Headers(response.headers) });
}
