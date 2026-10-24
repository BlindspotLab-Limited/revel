import { z } from "zod";
import { normalizeUrlSafe } from "@/lib/validation";

export const REVEL_BILLABLE_MCP_TOOLS = [
  "revel_analyze_website",
  "revel_analyze_website_and_wait",
] as const;

export type RevelBillableMcpTool = (typeof REVEL_BILLABLE_MCP_TOOLS)[number];

const BILLABLE_TOOL_SET = new Set<string>(REVEL_BILLABLE_MCP_TOOLS);

const FREE_MCP_METHODS = new Set([
  "initialize",
  "notifications/initialized",
  "notifications/cancelled",
  "ping",
  "tools/list",
  "resources/list",
  "resources/templates/list",
  "resources/read",
  "prompts/list",
  "prompts/get",
  "logging/setLevel",
  "completion/complete",
]);

type JsonRpcMessage = {
  method?: unknown;
  params?: {
    name?: unknown;
    arguments?: unknown;
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function messageRequiresPayment(message: unknown): boolean {
  if (!isRecord(message)) {
    return true;
  }

  const method =
    typeof message.method === "string" ? message.method : undefined;

  // Non-MCP / probe payloads (bare POST {}, marketplace curl) → require 402
  if (!method) {
    return true;
  }

  if (FREE_MCP_METHODS.has(method) || method.startsWith("notifications/")) {
    return false;
  }

  if (method !== "tools/call") {
    // Unknown MCP methods stay free so handshake does not break
    return false;
  }

  const params = isRecord(message.params) ? message.params : undefined;
  const toolName = typeof params?.name === "string" ? params.name : undefined;

  if (!toolName) {
    return true;
  }

  return BILLABLE_TOOL_SET.has(toolName);
}

/**
 * OKX A2MCP self-check for paid endpoints:
 *   curl -i -X POST https://endpoint  → expect HTTP 402 + PAYMENT-REQUIRED
 *
 * Empty body / non-MCP JSON must 402. Only known free MCP methods skip paywall.
 */
export function mcpBodyRequiresPayment(bodyText: string): boolean {
  const trimmed = bodyText.trim();
  // Bare POST (marketplace validator) → paid
  if (!trimmed) {
    return true;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed) as unknown;
  } catch {
    return true;
  }

  if (Array.isArray(parsed)) {
    // Empty batch is not a free discovery call
    if (parsed.length === 0) return true;
    return parsed.some((item) => messageRequiresPayment(item));
  }

  return messageRequiresPayment(parsed as JsonRpcMessage);
}

export function isBillableMcpTool(toolName: string): boolean {
  return BILLABLE_TOOL_SET.has(toolName);
}

/**
 * A body that is only a 402 discovery probe: empty, or the empty object `{}`.
 * These carry no tool call, and keep receiving a 402 challenge so the
 * marketplace's `curl -i -X POST <endpoint>` x402 self-check still passes.
 *
 * Every other body that mcpBodyRequiresPayment() treats as paid but that is
 * not a single, well-formed billable tools/call (a batch, a tools/call with
 * no tool name, non-JSON, a message with no method) can never succeed after
 * payment, so the route rejects it free, before any challenge.
 */
export function isPaymentProbeBody(bodyText: string): boolean {
  const trimmed = bodyText.trim();
  if (!trimmed) return true;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return isRecord(parsed) && Object.keys(parsed).length === 0;
  } catch {
    return false;
  }
}

/**
 * Pulls {id, toolName, args} out of a single (non-batch) JSON-RPC
 * `tools/call` for a billable tool, so the caller can validate arguments
 * before deciding whether to charge. Returns null for anything else —
 * batches, free methods, non-billable tools, malformed bodies — which all
 * fall through to the existing mcpBodyRequiresPayment flow unchanged.
 */
export function extractBillableToolCall(
  bodyText: string
): { id: unknown; toolName: RevelBillableMcpTool; args: unknown } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText.trim()) as unknown;
  } catch {
    return null;
  }

  if (!isRecord(parsed) || parsed.method !== "tools/call") {
    return null;
  }

  const params = isRecord(parsed.params) ? parsed.params : undefined;
  const toolName = typeof params?.name === "string" ? params.name : undefined;

  if (!toolName || !BILLABLE_TOOL_SET.has(toolName)) {
    return null;
  }

  return {
    id: parsed.id,
    toolName: toolName as RevelBillableMcpTool,
    args: params?.arguments,
  };
}

/**
 * Same required/format rules as the Zod schemas registered for these tools
 * in lib/mcp/create-server.ts, run here so a request with a missing or
 * malformed url can be rejected before the x402 challenge is issued — not
 * after the buyer has already signed and paid for it.
 *
 * Reuses normalizeUrlSafe (format + SSRF check), the exact function the
 * real tool handler calls, so nothing validated here can still fail there.
 */
const analyzeArgsSchema = z.object({ url: z.string().min(1) });
const analyzeAndWaitArgsSchema = z.object({
  url: z.string().min(1),
  timeoutSeconds: z.number().int().min(60).max(300).optional(),
});

export async function validateBillableToolArguments(
  toolName: RevelBillableMcpTool,
  args: unknown
): Promise<{ ok: true } | { ok: false; error: string }> {
  const schema =
    toolName === "revel_analyze_website_and_wait"
      ? analyzeAndWaitArgsSchema
      : analyzeArgsSchema;

  const parsed = schema.safeParse(args);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "arguments"}: ${issue.message}`)
        .join("; "),
    };
  }

  try {
    await normalizeUrlSafe(parsed.data.url);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Invalid url",
    };
  }

  return { ok: true };
}
