/**
 * Client-safe error handling: full detail stays server-side only.
 * Cloudflare Workers Logs get searchable single-line JSON via logServerError.
 */

const CLIENT_AI_GATEWAY_ERROR = "AI gateway error. Please try again.";
const CLIENT_GENERIC_ERROR = "Something went wrong. Please try again.";

/** Messages we intentionally show users (owned product copy). */
const SAFE_CLIENT_MESSAGE_PREFIXES = [
  "Too many requests",
  "Weekly limit reached",
  "Invalid URL",
  "Please enter a valid",
  "Could not access website",
  "email already",
  "Email already",
  "Invalid credentials",
  "Password must",
  "Passwords do not match",
  "Invalid or expired",
  "Token is required",
  "Name is required",
  "Email is required",
  "Unauthorized",
  "Forbidden",
  "Not found",
  "AI gateway error",
  "Something went wrong",
  "Export failed",
  "Could not start",
  "We couldn't start",
  "Application failed",
  "No actions available",
  "Connect",
  "Please wait",
  "Please try again",
];

/** Patterns that almost always mean upstream/provider leakage. */
const UNSAFE_PATTERNS = [
  /groq/i,
  /openrouter/i,
  /gemini/i,
  /openai/i,
  /anthropic/i,
  /meta-llama/i,
  /llama-/i,
  /org[_-]?[a-z0-9]/i,
  /api[_-]?key/i,
  /bearer\s+/i,
  /rate.?limit/i,
  /quota/i,
  /429/,
  /503/,
  /ECONNREFUSED/i,
  /ENOTFOUND/i,
  /stack/i,
  /at\s+\S+\s+\(/,
  /https?:\/\/[^\s]+api/i,
  /model[s]?\s*failed/i,
  /provider/i,
  /All analysis/i,
  /Last errors/i,
  /OPENROUTER_/i,
  /GROQ_/i,
  /GEMINI_/i,
];

/**
 * Error thrown to callers/clients with a safe message, while keeping the real
 * reason on `.serverDetail` for server logs and markAnalysisFailed.
 */
export class ClientSafeError extends Error {
  readonly serverDetail: string;
  readonly clientMessage: string;

  constructor(clientMessage: string, serverDetail: string) {
    super(clientMessage);
    this.name = "ClientSafeError";
    this.clientMessage = clientMessage;
    this.serverDetail = serverDetail;
  }
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return '"[unserializable]"';
  }
}

export function rawErrorMessage(error: unknown): string {
  if (error instanceof ClientSafeError) {
    return error.serverDetail || error.clientMessage;
  }
  if (error instanceof Error) {
    const cause = error.cause;
    if (
      cause instanceof Error &&
      cause.message &&
      cause.message !== error.message
    ) {
      return `${error.message} (${cause.message})`;
    }
    return error.message;
  }
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return "Unknown error";
  }
}

/**
 * Full detail for server logs / logEvent (never send this to the browser).
 */
export function serverErrorDetail(error: unknown): string {
  if (error instanceof ClientSafeError) {
    return error.serverDetail || error.message;
  }
  return rawErrorMessage(error);
}

/**
 * Emit a searchable single-line JSON error for Cloudflare Workers Logs.
 * Do not rely on console.error(msg, object) — log viewers often collapse objects to [Object].
 */
export function logServerError(
  scope: string,
  error: unknown,
  meta?: Record<string, unknown>
): void {
  const detail = serverErrorDetail(error);
  const payload: Record<string, unknown> = {
    level: "error",
    source: "revel",
    scope,
    timestamp: new Date().toISOString(),
    error: detail,
    ...(meta ?? {}),
  };

  if (error instanceof Error && error.stack && !(error instanceof ClientSafeError)) {
    payload.stack = error.stack.split("\n").slice(0, 15).join("\n");
  }

  // One line — fully visible & filterable in Workers Logs
  console.error(JSON.stringify(payload));
  // Plain summary for log search by scope name
  console.error(`[Revel] ${scope}: ${detail}`);
  if (meta && Object.keys(meta).length > 0) {
    console.error(`[Revel] ${scope} meta: ${safeJson(meta).slice(0, 4000)}`);
  }
}

function looksUnsafe(message: string): boolean {
  if (!message.trim()) return true;
  if (message.length > 280) return true;
  return UNSAFE_PATTERNS.some((re) => re.test(message));
}

function isAllowlistedSafeMessage(message: string): boolean {
  return SAFE_CLIENT_MESSAGE_PREFIXES.some((prefix) =>
    message.startsWith(prefix)
  );
}

/**
 * Map any thrown value to a short client-safe string.
 * Prefer our known product messages; otherwise return a generic fallback.
 */
export function toClientErrorMessage(
  error: unknown,
  fallback: string = CLIENT_GENERIC_ERROR
): string {
  if (error instanceof ClientSafeError) {
    return error.clientMessage;
  }

  const message = (error instanceof Error ? error.message : rawErrorMessage(error)).trim();

  if (isAllowlistedSafeMessage(message) && !looksUnsafe(message)) {
    return message;
  }

  // Known AI gateway failures always get the same public string
  if (
    /AI gateway/i.test(message) ||
    /All analysis/i.test(message) ||
    /analysis models failed/i.test(message) ||
    /analysis providers failed/i.test(message) ||
    /OpenRouter/i.test(message) ||
    /Groq/i.test(message) ||
    /Gemini/i.test(message)
  ) {
    return CLIENT_AI_GATEWAY_ERROR;
  }

  if (looksUnsafe(message)) {
    return fallback;
  }

  return fallback;
}

export function clientAiGatewayError(): string {
  return CLIENT_AI_GATEWAY_ERROR;
}

export function clientGenericError(): string {
  return CLIENT_GENERIC_ERROR;
}

/**
 * Throw a client-safe AI gateway error while preserving the real reason for logs.
 */
export function throwClientAiGatewayError(serverDetail: unknown): never {
  const detail =
    typeof serverDetail === "string"
      ? serverDetail
      : serverErrorDetail(serverDetail);
  throw new ClientSafeError(CLIENT_AI_GATEWAY_ERROR, detail);
}
