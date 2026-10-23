import { NextResponse } from "next/server";
import { runWithActivityContext } from "@/lib/activity-context";
import { getAuthSecret } from "@/lib/auth-config";
import { parseAuditJob } from "@/lib/audit/job";
import {
  AUDIT_RUN_TOKEN_HEADER,
  verifyAuditRunToken,
  type AuditRunOperation,
} from "@/lib/audit/internal-token";
import { logServerError } from "@/lib/safe-client-error";
import { markAnalysisFailed, runAnalysis } from "@/services/analysis-runner";
import { getAnalysis } from "@/services/store";

/**
 * Internal: executes one audit for the Cloudflare Workflow
 * (cloudflare/audit-workflow.ts). Not part of the public API.
 *
 * Response contract with the Workflow step:
 * - 200 → terminal state persisted (or nothing to do). Never retried.
 * - 4xx → permanent problem (bad token, unknown analysis). Not retried.
 * - 5xx → infrastructure failure before a terminal state was persisted.
 *         The Workflow retries within its bounded policy.
 *
 * Provider errors, bad reports and unreachable websites are recorded as a
 * terminal "failed" state and answered with 200 — exactly the behaviour the
 * former `after()` runner had — so a failing site never burns a second full
 * provider cascade.
 */

export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: noStore });
}

const TERMINAL = new Set(["completed", "partial", "failed"]);

export async function POST(request: Request) {
  const op = new URL(request.url).searchParams.get("op") as AuditRunOperation;
  if (op !== "run" && op !== "fail") {
    return json({ error: "Not found" }, 404);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const job = parseAuditJob(body);
  if (!job) {
    return json({ error: "Invalid audit job" }, 400);
  }

  const secret = getAuthSecret();
  const authorized = await verifyAuditRunToken(
    secret ?? "",
    request.headers.get(AUDIT_RUN_TOKEN_HEADER),
    job.analysisId,
    op
  );
  if (!authorized) {
    // Same shape as any unknown route: do not advertise this endpoint.
    return json({ error: "Not found" }, 404);
  }

  let analysis;
  try {
    analysis = await getAnalysis(job.analysisId);
  } catch (error) {
    logServerError("audit_run_lookup_failed", error, {
      analysisId: job.analysisId,
    });
    return json({ error: "Storage unavailable" }, 503);
  }

  if (!analysis) {
    return json({ error: "Analysis not found" }, 404);
  }

  // Idempotency guard: a retried Workflow step, or a duplicate delivery,
  // must not re-run (and re-bill providers for) a finished audit.
  if (TERMINAL.has(analysis.status)) {
    return json({ analysisId: job.analysisId, status: analysis.status, skipped: true });
  }

  const context = { website: job.website, userId: job.userId };

  if (op === "fail") {
    const reason =
      typeof (body as { reason?: unknown }).reason === "string"
        ? (body as { reason: string }).reason
        : "Audit execution failed after retries";
    try {
      await markAnalysisFailed(job.analysisId, new Error(reason), context);
    } catch (error) {
      logServerError("audit_run_mark_failed_failed", error, {
        analysisId: job.analysisId,
      });
      return json({ error: "Could not persist failure" }, 503);
    }
    return json({ analysisId: job.analysisId, status: "failed" });
  }

  const activity = job.activity ?? { source: "website" as const };

  return runWithActivityContext(activity, async () => {
    try {
      await runAnalysis(job.analysisId, job.website, job.userId);
    } catch (error) {
      try {
        await markAnalysisFailed(job.analysisId, error, context);
      } catch (persistError) {
        logServerError("audit_run_mark_failed_failed", persistError, {
          analysisId: job.analysisId,
        });
        return json({ error: "Could not persist failure" }, 503);
      }
      return json({ analysisId: job.analysisId, status: "failed" });
    }

    const finished = await getAnalysis(job.analysisId).catch(() => null);
    return json({
      analysisId: job.analysisId,
      status: finished?.status ?? "completed",
    });
  });
}
