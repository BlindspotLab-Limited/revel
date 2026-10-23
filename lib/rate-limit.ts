import {
  getCloudflareEnv,
  isCloudflareWorkersRuntime,
  type RateLimitBinding,
} from "@/lib/runtime/cloudflare";

const requests = new Map<string, { count: number; resetAt: number }>();

const WINDOW_MS = 60_000;
const MAX_REQUESTS = 10;

/**
 * Per-instance fixed-window limiter. On Cloudflare Workers each isolate has
 * its own map, so this is a first line only; `enforceRateLimit` adds the
 * Workers Rate Limiting binding for limits shared across isolates.
 */
export function rateLimit(
  key: string,
  limit = MAX_REQUESTS,
  windowMs = WINDOW_MS
): { success: boolean; remaining: number } {
  const now = Date.now();
  const entry = requests.get(key);

  if (!entry || now > entry.resetAt) {
    requests.set(key, { count: 1, resetAt: now + windowMs });
    return { success: true, remaining: limit - 1 };
  }

  if (entry.count >= limit) {
    return { success: false, remaining: 0 };
  }

  entry.count++;
  return { success: true, remaining: limit - entry.count };
}

/** Which Workers Rate Limiting binding (wrangler.jsonc → ratelimits) to consult. */
export type DistributedRateLimiter = "AUDIT_RATE_LIMITER" | "PARTNER_RATE_LIMITER";

/**
 * Local limiter plus, on Cloudflare Workers, the shared Rate Limiting
 * binding. A request must pass both. Fails open on binding errors so a
 * platform hiccup never blocks paying traffic; the local limiter still
 * applies.
 */
export async function enforceRateLimit(
  key: string,
  options: { limit: number; windowMs: number; binding: DistributedRateLimiter }
): Promise<{ success: boolean }> {
  const local = rateLimit(key, options.limit, options.windowMs);
  if (!local.success) return { success: false };

  const binding = getCloudflareEnv()?.[options.binding] as
    | RateLimitBinding
    | undefined;
  if (!binding) return { success: true };

  try {
    const { success } = await binding.limit({ key });
    return { success };
  } catch (error) {
    console.error(
      "[Revel] rate_limit_binding_failed",
      error instanceof Error ? error.message : error
    );
    return { success: true };
  }
}

/**
 * Client IP for rate-limit keys.
 *
 * On Cloudflare, `CF-Connecting-IP` is set by the edge and cannot be forged,
 * while the first `X-Forwarded-For` entry is whatever the client sent
 * (Cloudflare appends, it does not overwrite). Elsewhere, fall back to the
 * platform-set `X-Forwarded-For`.
 */
export function getClientIp(request: Request): string | null {
  if (isCloudflareWorkersRuntime()) {
    const cfIp = request.headers.get("cf-connecting-ip")?.trim();
    if (cfIp) return cfIp;
  }

  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || null;
}

export function getRateLimitKey(request: Request, userId?: string | null): string {
  if (userId) return `user:${userId}`;

  return `ip:${getClientIp(request) ?? "anonymous"}`;
}
