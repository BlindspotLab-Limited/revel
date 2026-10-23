import { enforceRateLimit } from "@/lib/rate-limit";

/**
 * 30 requests / minute per partner: per-instance window plus, on Cloudflare
 * Workers, the shared PARTNER_RATE_LIMITER binding.
 */
export async function partnerRateLimit(
  partnerId: string,
  limit = 30,
  windowMs = 60_000
): Promise<{ success: boolean }> {
  return enforceRateLimit(`partner:${partnerId}`, {
    limit,
    windowMs,
    binding: "PARTNER_RATE_LIMITER",
  });
}
