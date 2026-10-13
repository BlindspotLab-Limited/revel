import { Agent, type Dispatcher } from "undici";
import { assertPublicHttpUrl } from "@/lib/security/ssrf";

const defaultAgent: Dispatcher = new Agent({
  connect: { timeout: 20_000 },
  headersTimeout: 30_000,
  bodyTimeout: 60_000,
});

export function isNetworkFetchError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  const message = error.message.toLowerCase();
  if (
    message === "fetch failed" ||
    message.includes("network") ||
    message.includes("timeout") ||
    message.includes("econnreset") ||
    message.includes("enotfound") ||
    message.includes("socket")
  ) {
    return true;
  }

  const cause = error.cause;
  if (cause instanceof Error) {
    const code = (cause as Error & { code?: string }).code ?? "";
    return (
      code.startsWith("UND_ERR") ||
      code === "ECONNRESET" ||
      code === "ETIMEDOUT" ||
      code === "ENOTFOUND"
    );
  }

  return false;
}

export function formatFetchError(
  error: unknown,
  context: string
): string {
  if (!(error instanceof Error)) {
    return `${context}: request failed`;
  }

  const cause = error.cause;
  const causeDetail =
    cause instanceof Error
      ? cause.message || (cause as Error & { code?: string }).code
      : undefined;

  if (causeDetail && causeDetail !== error.message) {
    return `${context}: ${error.message} (${causeDetail})`;
  }

  return `${context}: ${error.message}`;
}

export interface ResilientFetchOptions extends RequestInit {
  retries?: number;
  retryDelayMs?: number;
  context?: string;
  /** Validate URL and each redirect target against SSRF blocklist. */
  ssrfGuard?: boolean;
  maxRedirects?: number;
  /** Per-attempt deadline. Aborts the request instead of hanging. */
  timeoutMs?: number;
  /** Outer deadline shared across attempts (total audit budget). */
  deadlineSignal?: AbortSignal;
}

export class DeadlineExceededError extends Error {
  constructor(context: string) {
    super(`${context}: deadline exceeded`);
    this.name = "DeadlineExceededError";
  }
}

export function isDeadlineError(error: unknown): boolean {
  return (
    error instanceof DeadlineExceededError ||
    (error instanceof Error &&
      (error.name === "AbortError" || /deadline exceeded|aborted/i.test(error.message)))
  );
}

async function fetchWithOptionalSsrGuard(
  url: string,
  init: RequestInit,
  options: {
    ssrfGuard: boolean;
    maxRedirects: number;
    context: string;
  }
): Promise<Response> {
  const { ssrfGuard, maxRedirects, context } = options;

  if (!ssrfGuard) {
    return fetch(url, {
      ...init,
      // @ts-expect-error undici dispatcher
      dispatcher: defaultAgent,
    });
  }

  let currentUrl = url;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    await assertPublicHttpUrl(currentUrl);

    const response = await fetch(currentUrl, {
      ...init,
      redirect: "manual",
      // @ts-expect-error undici dispatcher
      dispatcher: defaultAgent,
    });

    if (response.status < 300 || response.status >= 400) {
      return response;
    }

    const location = response.headers.get("location");
    if (!location) {
      return response;
    }

    currentUrl = new URL(location, currentUrl).href;
  }

  throw new Error(`${context}: too many redirects`);
}

export async function resilientFetch(
  url: string,
  options: ResilientFetchOptions = {}
): Promise<Response> {
  const {
    retries = 2,
    retryDelayMs = 1500,
    context = "HTTP request",
    ssrfGuard = false,
    maxRedirects = 5,
    timeoutMs,
    deadlineSignal,
    ...init
  } = options;

  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (deadlineSignal?.aborted) {
      throw new DeadlineExceededError(context);
    }

    // Per-attempt timeout, combined with any outer audit-budget signal.
    const timeoutController = new AbortController();
    const timer = timeoutMs
      ? setTimeout(() => timeoutController.abort(), timeoutMs)
      : undefined;
    const signals = [
      timeoutMs ? timeoutController.signal : undefined,
      deadlineSignal,
      init.signal ?? undefined,
    ].filter((signal): signal is AbortSignal => Boolean(signal));

    try {
      return await fetchWithOptionalSsrGuard(
        url,
        signals.length > 0 ? { ...init, signal: anySignal(signals) } : init,
        { ssrfGuard, maxRedirects, context }
      );
    } catch (error) {
      lastError = error;

      // An outer deadline is terminal — retrying cannot help.
      if (deadlineSignal?.aborted) {
        throw new DeadlineExceededError(context);
      }

      const retryable =
        isNetworkFetchError(error) ||
        (timeoutMs !== undefined && timeoutController.signal.aborted);

      if (attempt < retries && retryable) {
        await new Promise((resolve) =>
          setTimeout(resolve, retryDelayMs * (attempt + 1))
        );
        continue;
      }
      throw new Error(formatFetchError(error, context));
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  throw new Error(formatFetchError(lastError, context));
}

/** AbortSignal.any with a fallback for runtimes that lack it. */
function anySignal(signals: AbortSignal[]): AbortSignal {
  if (signals.length === 1) return signals[0];

  const anyFn = (
    AbortSignal as unknown as { any?: (list: AbortSignal[]) => AbortSignal }
  ).any;
  if (typeof anyFn === "function") return anyFn(signals);

  const controller = new AbortController();
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      break;
    }
    signal.addEventListener("abort", () => controller.abort(signal.reason), {
      once: true,
    });
  }
  return controller.signal;
}