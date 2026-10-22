import { NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { runWithActivityContext } from "@/lib/activity-context";
import { trackActivity } from "@/lib/activity";
import { getCurrentUserId } from "@/lib/auth";
import { checkWeeklyAuditLimit } from "@/lib/weekly-audit-limit";
import { logEvent } from "@/lib/logger";
import { enforceRateLimit, getRateLimitKey } from "@/lib/rate-limit";
import { normalizeUrlSafe } from "@/lib/validation";
import { dispatchAnalysis } from "@/services/audit-dispatch";
import { saveAnalysis } from "@/services/store";

/** Agentic runs (Groq + fallback) often need 2–3 min on slow networks. */
// Ignored on Cloudflare Workers (no wall-clock limit; audits run in a
// Workflow). Kept only while Vercel remains the rollback target — see
// docs/cloudflare-deployment.md → "Remove Vercel safely".
export const maxDuration = 300;

export async function POST(request: Request) {
  const userId = await getCurrentUserId();

  return runWithActivityContext({ source: "website", userId }, async () => {
  try {
    const rateLimitKey = getRateLimitKey(request, userId);
    const { success } = await enforceRateLimit(`analyze:${rateLimitKey}`, {
      limit: 5,
      windowMs: 60_000,
      binding: "AUDIT_RATE_LIMITER",
    });

    if (!success) {
      return NextResponse.json(
        { error: "Too many requests. Please wait a moment and try again." },
        { status: 429 }
      );
    }

    const weekly = await checkWeeklyAuditLimit(userId);
    if (!weekly.allowed) {
      return NextResponse.json(
        {
          error: `Weekly limit reached (${weekly.limit} audits per week). Resets Monday 00:00 UTC. Need more? Use Revel on OKX.AI marketplace ($0.35 per successful audit).`,
          used: weekly.used,
          limit: weekly.limit,
          resetsAt: weekly.resetsAt,
        },
        { status: 429 }
      );
    }

    const body = await request.json();
    const website = await normalizeUrlSafe(body.url);
    const id = uuidv4();

    const analysis = {
      id,
      userId: userId ?? undefined,
      website,
      status: "processing" as const,
      createdAt: new Date().toISOString(),
    };

    await saveAnalysis(analysis);
    logEvent("analysis_started", { id, website, userId });
    trackActivity({
      eventType: "analysis_started",
      analysisId: id,
      website,
      userId,
      status: "started",
    });

    // Durable background run: Cloudflare Workflow on Workers, `after()` on Node.
    await dispatchAnalysis({ analysisId: id, website, userId });

    return NextResponse.json({ id });
  } catch (error) {
    const { logServerError, toClientErrorMessage } = await import(
      "@/lib/safe-client-error"
    );
    logServerError("analyze_start_failed", error);
    return NextResponse.json(
      {
        error: toClientErrorMessage(
          error,
          "We couldn't start the analysis. Please try again."
        ),
      },
      { status: 400 }
    );
  }
  });
}