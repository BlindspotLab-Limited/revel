import {
  classifyProviderFailure,
  normalizeOpenAiUsage,
  recordProviderAttempt,
  UNAVAILABLE_USAGE,
} from "@/lib/ai-usage/recorder";
import {
  AUDIT_LIMITATIONS,
  buildCheckStatuses,
} from "@/lib/audit/capabilities";
import { getEvidenceStore } from "@/lib/audit/evidence-context";
import {
  getOpenRouterMaxOutputTokens,
  getProviderMaxRetries,
  getProviderRequestTimeoutMs,
} from "@/lib/analysis-provider";
import { resilientFetch } from "@/lib/resilient-fetch";
import {
  logServerError,
  throwClientAiGatewayError,
} from "@/lib/safe-client-error";
import {
  ensureFindingEvidence,
  finalizeReport,
  isCompleteReport,
  normalizeAnalysisReport,
  reportCompletenessError,
  validateReportEvidence,
} from "./report-schema";
import { buildAnalysisPrompt } from "./prompt-builder";
import { siteConfig } from "./site-config";
import type { AnalysisReport, ReportCoverage } from "@/types/analysis";

/**
 * Model selection order: OPENROUTER_MODEL, then OPENROUTER_MODEL_FALLBACK
 * (comma-separated), then the built-in list below.
 *
 * Production recommendation: google/gemini-2.5-flash — reliable JSON mode,
 * roughly $0.003 per analysis at 20k in / 3k out.
 *
 * The built-in entries were all ":free" slugs. Verified against OpenRouter on
 * 2026-10-23: qwen3-next-80b:free and nemotron-3-super:free return 404
 * ("unavailable for free") and gemma-4-31b-it:free returns 429, so the entire
 * built-in safety net was dead and every audit fell through it.
 *
 * These are paid slugs confirmed to answer and to honour
 * response_format: json_object. Re-verify when OpenRouter retires a model.
 */
const BUILTIN_FALLBACK_MODELS = [
  "google/gemini-2.5-pro",
  "openai/gpt-oss-120b",
];

const DEFAULT_MODEL = "google/gemini-2.5-flash";

interface OpenRouterMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

function analysisModels(): string[] {
  const primary = process.env.OPENROUTER_MODEL || DEFAULT_MODEL;
  const extra = (process.env.OPENROUTER_MODEL_FALLBACK ?? "")
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);

  return [...new Set([primary, ...extra, ...BUILTIN_FALLBACK_MODELS])];
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 502 || status === 503 || status === 529;
}

async function requestAnalysis(
  apiKey: string,
  model: string,
  prompt: string
): Promise<{ ok: true; raw: string } | { ok: false; status: number; detail: string }> {
  const startedAt = Date.now();

  try {
    const response = await resilientFetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        context: "OpenRouter API",
        retries: getProviderMaxRetries(),
        timeoutMs: getProviderRequestTimeoutMs(),
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": siteConfig.url,
          "X-Title": "Revel",
        },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: prompt }] as OpenRouterMessage[],
          response_format: { type: "json_object" },
          temperature: 0.4,
          // Without this OpenRouter reserves the model's full output window
          // and rejects the request with 402 unless the balance covers it.
          max_tokens: getOpenRouterMaxOutputTokens(),
          // Ask OpenRouter for real billed cost so estimates are a fallback.
          usage: { include: true },
        }),
      }
    );

    const latencyMs = Date.now() - startedAt;

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      const { status, errorKind } = classifyProviderFailure(
        response.status,
        detail
      );
      await recordProviderAttempt({
        provider: "openrouter",
        model,
        status,
        errorKind,
        errorDetail: detail,
        httpStatus: response.status,
        latencyMs,
        usage: UNAVAILABLE_USAGE,
      });
      return { ok: false, status: response.status, detail };
    }

    const data = await response.json();
    const raw = data.choices?.[0]?.message?.content;
    const cost = data.usage?.cost;

    await recordProviderAttempt({
      provider: "openrouter",
      model,
      status: raw ? "success" : "invalid_output",
      ...(raw ? {} : { errorKind: "empty_response" }),
      httpStatus: response.status,
      latencyMs,
      providerRequestId: data.id,
      usage: normalizeOpenAiUsage(data.usage),
      reportedCostUsd:
        typeof cost === "number" && Number.isFinite(cost) ? cost : null,
    });

    if (!raw) {
      return {
        ok: false,
        status: 502,
        detail: "Empty analysis response from AI service",
      };
    }

    return { ok: true, raw };
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    const detail =
      error instanceof Error ? error.message : "OpenRouter API unreachable";
    const { status, errorKind } = classifyProviderFailure(undefined, detail);

    await recordProviderAttempt({
      provider: "openrouter",
      model,
      status,
      errorKind,
      errorDetail: detail,
      latencyMs,
      usage: UNAVAILABLE_USAGE,
    });

    return { ok: false, status: 503, detail };
  }
}

export async function generateAnalysis(
  website: string,
  content: string
): Promise<AnalysisReport> {
  const apiKey = process.env.OPENROUTER_API_KEY;

  // No demo/sample fallback. A fabricated report that is stored as
  // status:"completed" is indistinguishable from a real audit to the customer,
  // to the partner API and to OKX billing. Missing credentials must fail loudly.
  if (!apiKey) {
    logServerError(
      "openrouter_missing_api_key",
      "OPENROUTER_API_KEY is not configured",
      { website }
    );
    throwClientAiGatewayError(
      "openrouter: OPENROUTER_API_KEY is not configured — refusing to emit a sample report as a completed audit"
    );
  }

  const prompt = buildAnalysisPrompt(website, content);
  const models = analysisModels();
  const errors: string[] = [];
  const store = getEvidenceStore();

  for (const model of models) {
    const result = await requestAnalysis(apiKey, model, prompt);

    if (!result.ok) {
      errors.push(`${model} (${result.status}): ${result.detail.slice(0, 120)}`);
      // A 404 is model-level — that slug is gone or not available on this key,
      // which says nothing about the next model. Treating it as terminal meant
      // one retired slug disabled the entire fallback list. Account-level
      // failures (401/403) still end the loop, since no model would succeed.
      if (isRetryableStatus(result.status) || result.status === 404) {
        continue;
      }
      break;
    }

    try {
      const parsed = JSON.parse(result.raw) as unknown;
      const report = normalizeAnalysisReport(parsed);
      // Reject thin shells (e.g. summary-only with 0 blindspots) — try next model
      if (!isCompleteReport(report)) {
        errors.push(
          `${model}: ${reportCompletenessError(report).slice(0, 140)}`
        );
        continue;
      }

      // Evidence gate: unverifiable quotes and visual claims are rejected here
      // exactly as they are on the agentic path.
      if (!store) {
        errors.push(
          `${model}: no evidence store attached — quoted text cannot be verified`
        );
        continue;
      }

      const validation = validateReportEvidence(report, store);
      if (!validation.ok) {
        await recordProviderAttempt({
          provider: "openrouter",
          model,
          status: "report_rejected",
          errorKind: "evidence_unsupported",
          errorDetail: validation.errors.slice(0, 2).join(" "),
          latencyMs: 0,
          usage: UNAVAILABLE_USAGE,
        });
        errors.push(
          `${model}: evidence validation failed — ${validation.errors[0] ?? "unsupported claims"}`
        );
        continue;
      }

      const coverage: ReportCoverage = {
        ...store.coverage(),
        visualEvidenceAvailable: false,
        checks: buildCheckStatuses(store),
        limitations: [...AUDIT_LIMITATIONS],
      };

      return finalizeReport(
        {
          ...report,
          blindspots: report.blindspots.map((finding) => ({
            ...finding,
            evidence: ensureFindingEvidence(finding, store),
          })),
        },
        coverage
      );
    } catch {
      errors.push(`${model}: invalid JSON`);
    }
  }

  const summary =
    errors.length > 0
      ? `OpenRouter all models failed: ${errors.join(" | ")}`
      : "OpenRouter all models failed (no model details)";
  logServerError("openrouter_all_models_failed", summary, {
    errors,
    models,
  });
  throwClientAiGatewayError(summary);
}

