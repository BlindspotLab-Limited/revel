import {
  getAnalysisProviderChain,
  isRateLimitError,
  isRecoverableAgenticFailure,
} from "@/lib/analysis-provider";
import { getEvidenceStore } from "@/lib/audit/evidence-context";
import { generateAnalysis } from "@/lib/openrouter";
import { isDeadlineError } from "@/lib/resilient-fetch";
import {
  logServerError,
  serverErrorDetail,
  throwClientAiGatewayError,
} from "@/lib/safe-client-error";
import type { AnalysisReport } from "@/types/analysis";
import {
  evidenceToPromptText,
  fetchPageEvidence,
} from "@/services/content-extractor";
import { runGeminiAgent } from "@/services/gemini-agent";
import { runGroqAgent } from "@/services/groq-agent";
import { runNvidiaAgent } from "@/services/nvidia-agent";

/**
 * Fetch the homepage for the single-shot (OpenRouter) path.
 *
 * Previously, a failed fetch returned a synthesized placeholder telling the
 * model to "only use the domain and URL structure", and an audit was then
 * produced from the domain name alone. That is a fabricated report, so a fetch
 * failure now aborts this backend and the cascade moves on.
 */
async function fetchContentForSingleShot(website: string): Promise<string> {
  const evidence = await fetchPageEvidence(website);
  getEvidenceStore()?.record(evidence);

  if (evidence.outcome !== "ok") {
    throw new Error(
      `openrouter: live page fetch failed (${evidence.outcome}${
        evidence.httpStatus ? ` HTTP ${evidence.httpStatus}` : ""
      }) — refusing to audit from the domain name alone`
    );
  }

  return evidenceToPromptText(evidence);
}

async function runOpenRouterAnalysis(website: string): Promise<AnalysisReport> {
  const attempts = 2;
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const content = await fetchContentForSingleShot(website);
      return await generateAnalysis(website, content);
    } catch (error) {
      lastError = error;

      // A spent audit budget is terminal — do not burn the remaining time.
      if (isDeadlineError(error)) break;

      if (attempt < attempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
    }
  }

  const detail = serverErrorDetail(lastError);
  logServerError("openrouter_analysis_failed", detail, {
    website,
    attempts,
  });
  throwClientAiGatewayError(`openrouter: ${detail}`);
}

/**
 * Run analysis with cascade:
 *   Groq (agentic) → OpenRouter (grounded single-shot) → Gemini (agentic)
 *   → NVIDIA (agentic, only when NVIDIA_ENABLE_FALLBACK=true)
 *
 * On recoverable errors, try the next backend. Client only ever sees a generic
 * message. The caller is responsible for scoping an evidence store.
 */
export async function generateAgenticAnalysis(
  website: string
): Promise<AnalysisReport> {
  const chain = getAnalysisProviderChain();

  if (chain.length === 0) {
    logServerError(
      "analysis_no_providers",
      "No analysis API keys configured",
      { website }
    );
    throwClientAiGatewayError("No analysis API keys configured");
  }

  const errors: Array<{ provider: string; detail: string }> = [];

  for (let i = 0; i < chain.length; i++) {
    const provider = chain[i];
    const isLast = i === chain.length - 1;

    try {
      console.info(
        `[Revel] Analysis provider: ${provider} (${i + 1}/${chain.length})`
      );

      if (provider === "groq") {
        return await runGroqAgent(website);
      }
      if (provider === "openrouter") {
        return await runOpenRouterAnalysis(website);
      }
      if (provider === "nvidia") {
        return await runNvidiaAgent(website);
      }
      return await runGeminiAgent(website);
    } catch (error) {
      // Prefer serverDetail so ClientSafeError does not collapse to the public message
      const detail = serverErrorDetail(error);
      errors.push({ provider, detail });

      // The total audit budget is shared across the whole cascade. Once it is
      // gone, trying another provider cannot finish either.
      if (isDeadlineError(error)) {
        logServerError("analysis_budget_exhausted", detail, {
          website,
          provider,
        });
        break;
      }

      const canFallback =
        !isLast &&
        (isRecoverableAgenticFailure(error) || isRateLimitError(error));

      if (canFallback) {
        console.warn(
          `[Revel] ${provider} failed — falling back to next provider`
        );
        logServerError("analysis_provider_fallback", detail, {
          website,
          provider,
          next: chain[i + 1],
        });
        continue;
      }

      if (isLast) {
        break;
      }

      console.warn(
        `[Revel] ${provider} error — trying next provider anyway`
      );
      logServerError("analysis_provider_error", detail, {
        website,
        provider,
        next: chain[i + 1],
      });
    }
  }

  const chainSummary = errors
    .map((e) => `${e.provider}: ${e.detail}`)
    .join(" | ");
  const summary =
    chainSummary ||
    `All analysis providers failed (chain: ${chain.join("→")})`;

  logServerError("analysis_all_providers_failed", summary, {
    website,
    chain,
    errors,
  });
  throwClientAiGatewayError(summary);
}
