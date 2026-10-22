import { v4 as uuidv4 } from "uuid";
import { trackActivity } from "@/lib/activity";
import { getOkxBillingManifest } from "@/lib/billing/okx-x402";
import { getMcpUsageSummary } from "@/lib/mcp/usage-model";
import { getExportCapabilities } from "@/lib/mission-control-config";
import { normalizeUrlSafe } from "@/lib/validation";
import { executeAgentTool } from "@/services/agent-tools";
import { dispatchAnalysis } from "@/services/audit-dispatch";
import {
  exportToJson,
  exportToMarkdown,
} from "@/services/export-service";
import { getAnalysis, saveAnalysis } from "@/services/store";
import type { Analysis } from "@/types/analysis";

const DEFAULT_WAIT_MS = 180_000;
const POLL_INTERVAL_MS = 3_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function getRevelMcpHealth() {
  return {
    service: "revel-mcp",
    version: "1.0.0",
    category: "A2MCP",
    description:
      "Revel discovers product blindspots, scores the Reveal Index, and returns a prioritized Blueprint and Action Queue.",
    exports: getExportCapabilities(),
    usage: getMcpUsageSummary(),
    billing: getOkxBillingManifest(),
  };
}

export async function startWebsiteAnalysis(url: string) {
  const website = await normalizeUrlSafe(url);
  const id = uuidv4();

  await saveAnalysis({
    id,
    website,
    status: "processing",
    createdAt: new Date().toISOString(),
  });

  // Durable background run: Cloudflare Workflow on Workers, `after()` on
  // Node (stdio MCP falls back to fire-and-forget).
  await dispatchAnalysis({ analysisId: id, website });
  trackActivity({
    eventType: "analysis_started",
    analysisId: id,
    website,
    status: "started",
  });

  return {
    analysisId: id,
    website,
    status: "processing" as const,
    message:
      "Analysis started. Poll revel_get_analysis or call revel_wait_for_analysis.",
  };
}

export async function getAnalysisStatus(analysisId: string) {
  const analysis = await getAnalysis(analysisId);
  if (!analysis) {
    throw new Error(`Analysis not found: ${analysisId}`);
  }

  return formatAnalysisResponse(analysis);
}

export async function waitForAnalysis(
  analysisId: string,
  timeoutMs = DEFAULT_WAIT_MS
): Promise<ReturnType<typeof formatAnalysisResponse>> {
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    const analysis = await getAnalysis(analysisId);
    if (!analysis) {
      throw new Error(`Analysis not found: ${analysisId}`);
    }

    if (analysis.status === "completed" && analysis.report) {
      return formatAnalysisResponse(analysis);
    }

    if (analysis.status === "failed") {
      throw new Error(analysis.error ?? "Analysis failed");
    }

    await sleep(POLL_INTERVAL_MS);
  }

  throw new Error(
    `Analysis timed out after ${Math.round(timeoutMs / 1000)}s. Retry revel_get_analysis later.`
  );
}

export async function analyzeWebsiteAndWait(
  url: string,
  timeoutMs = DEFAULT_WAIT_MS
) {
  const started = await startWebsiteAnalysis(url);
  const result = await waitForAnalysis(started.analysisId, timeoutMs);
  return result;
}

export async function exportBlueprint(
  analysisId: string,
  format: "markdown" | "json"
) {
  const analysis = await getAnalysis(analysisId);
  if (!analysis?.report) {
    throw new Error("Report not found or not ready");
  }

  const content =
    format === "json"
      ? exportToJson(analysis.report, analysis.website)
      : exportToMarkdown(analysis.report, analysis.website);

  return {
    analysisId,
    website: analysis.website,
    format,
    filename: `revel-blueprint-${analysisId}.${format === "json" ? "json" : "md"}`,
    content,
  };
}

export async function fetchUrlContent(url: string) {
  const result = await executeAgentTool("fetch_url", {
    url: await normalizeUrlSafe(url),
  });
  return result.response;
}

function formatAnalysisResponse(analysis: Analysis) {
  return {
    analysisId: analysis.id,
    website: analysis.website,
    status: analysis.status,
    score: analysis.score ?? analysis.report?.score,
    error: analysis.error,
    createdAt: analysis.createdAt,
    report: analysis.report ?? null,
  };
}