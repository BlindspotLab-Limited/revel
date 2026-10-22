import { getAnalysisMode, getAuditPageTarget } from "@/lib/analysis-provider";
import { runWithAuditUsageContext } from "@/lib/ai-usage/recorder";
import { AuditEvidenceStore } from "@/lib/audit/evidence";
import { runWithEvidenceStore } from "@/lib/audit/evidence-context";
import { trackActivity } from "@/lib/activity";
import { logEvent } from "@/lib/logger";
import { generateAnalysis } from "@/lib/openrouter";
import {
  clientAiGatewayError,
  logServerError,
  serverErrorDetail,
  toClientErrorMessage,
} from "@/lib/safe-client-error";
import {
  finalizeReport,
  isCompleteReport,
  normalizeAnalysisReport,
  reportCompletenessError,
} from "@/lib/report-schema";
import {
  AUDIT_LIMITATIONS,
  buildCheckStatuses,
} from "@/lib/audit/capabilities";
import { generateAgenticAnalysis } from "@/services/agentic-analysis";
import {
  evidenceToPromptText,
  fetchPageEvidence,
} from "@/services/content-extractor";
import { getAnalysis, saveAnalysis } from "@/services/store";
import type { AnalysisStatus, ReportCoverage } from "@/types/analysis";

export async function markAnalysisFailed(
  id: string,
  error: unknown,
  context?: { website?: string; userId?: string | null }
): Promise<void> {
  const failed = await getAnalysis(id);
  if (!failed) return;

  const website = context?.website ?? failed.website;
  // Real reason for server logs (never the generic client string alone)
  const detail = serverErrorDetail(error);

  logServerError("analysis_failed", detail, {
    id,
    website,
    userId: context?.userId,
  });

  const clientMessage = toClientErrorMessage(
    error,
    clientAiGatewayError()
  );

  const startedAt = new Date(failed.createdAt).getTime();
  const completedAt = new Date();

  await saveAnalysis({
    ...failed,
    status: "failed",
    error: clientMessage,
    completedAt: completedAt.toISOString(),
    durationMs: Number.isFinite(startedAt)
      ? Math.max(0, completedAt.getTime() - startedAt)
      : undefined,
  });

  // Production: single JSON line via logEvent — include full server detail
  logEvent("analysis_failed", {
    id,
    website,
    userId: context?.userId,
    error: clientMessage,
    errorDetail: detail.slice(0, 2000),
  });
  trackActivity({
    eventType: "analysis_failed",
    analysisId: id,
    website,
    userId: context?.userId,
    status: "failed",
    metadata: { error: clientMessage },
  });
}

/**
 * Decide the terminal status from what the audit actually covered.
 *
 * A report built from fewer pages than the coverage target, or with failed
 * fetches, is reported as "partial" rather than "completed" so that the
 * completion rate is not inflated by thin runs.
 */
function terminalStatusFor(coverage: ReportCoverage | undefined): AnalysisStatus {
  if (!coverage) return "completed";

  const target = getAuditPageTarget();
  if (coverage.pagesFailed > 0) return "partial";
  if (coverage.pagesFetched < target.min) return "partial";
  return "completed";
}

export async function runAnalysis(
  id: string,
  website: string,
  userId?: string | null
): Promise<void> {
  const startedAt = Date.now();
  const store = new AuditEvidenceStore();

  // One evidence store and one usage context per audit, so every fetch and
  // every provider attempt made anywhere in the cascade is attributed here.
  await runWithAuditUsageContext({ analysisId: id, website }, () =>
    runWithEvidenceStore(store, async () => {
      const mode = getAnalysisMode();

      const rawReport =
        mode === "agentic"
          ? await generateAgenticAnalysis(website)
          : await generateAnalysis(
              website,
              await fetchLegacyContent(website, store)
            );

      const normalized = normalizeAnalysisReport(rawReport);

      if (!isCompleteReport(normalized)) {
        throw new Error(reportCompletenessError(normalized));
      }

      // Coverage is authoritative from the store, not from model output.
      const coverage: ReportCoverage = {
        ...store.coverage(),
        visualEvidenceAvailable: false,
        checks: buildCheckStatuses(store),
        limitations: [...AUDIT_LIMITATIONS],
      };

      // Preserve evidence the provider layer already attached.
      const report = finalizeReport(
        { ...normalized, blindspots: rawReport.blindspots ?? normalized.blindspots },
        coverage
      );

      const analysis = await getAnalysis(id);
      if (!analysis) {
        throw new Error("Analysis record was not found after processing started");
      }

      const status = terminalStatusFor(coverage);
      const completedAt = new Date();
      const durationMs = completedAt.getTime() - startedAt;

      await saveAnalysis({
        ...analysis,
        status,
        score: report.score,
        report,
        completedAt: completedAt.toISOString(),
        durationMs,
      });

      logEvent(
        status === "partial" ? "analysis_partial" : "analysis_completed",
        {
          id,
          website,
          userId,
          score: report.score,
          durationMs,
          pagesFetched: coverage.pagesFetched,
          pagesFailed: coverage.pagesFailed,
        }
      );
      trackActivity({
        eventType: "analysis_completed",
        analysisId: id,
        website,
        userId,
        status,
        metadata: {
          score: report.score,
          durationMs,
          pagesFetched: coverage.pagesFetched,
          pagesFailed: coverage.pagesFailed,
        },
      });
    })
  );
}

/** Legacy single-shot path: record the fetch so coverage is still reported. */
async function fetchLegacyContent(
  website: string,
  store: AuditEvidenceStore
): Promise<string> {
  const evidence = await fetchPageEvidence(website);
  store.record(evidence);

  if (evidence.outcome !== "ok") {
    throw new Error(
      evidence.error ?? `Fetch website ${website}: request failed`
    );
  }

  return evidenceToPromptText(evidence);
}
