import {
  getOpenRouterMaxOutputTokens,
  getOpenRouterModels,
} from "@/lib/analysis-provider";
import { siteConfig } from "@/lib/site-config";
import type { AnalysisReport } from "@/types/analysis";
import { runOpenAiCompatibleAgent } from "@/services/openai-compatible-agent";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

/**
 * OpenRouter agentic analysis.
 *
 * OpenRouter speaks the OpenAI chat-completions protocol, so the loop in
 * `openai-compatible-agent.ts` is shared with Groq and NVIDIA: identical
 * page-coverage policy, usage accounting, request deadlines and bounded
 * retries.
 *
 * Until now OpenRouter was wired only as a single-shot backend
 * (`lib/openrouter.ts`), which reads the homepage alone. An OpenRouter-only
 * deployment therefore produced shallower audits than a Groq or NVIDIA one.
 * Running it through the shared agent lets it crawl to the same
 * AUDIT_MIN_PAGES/AUDIT_MAX_PAGES target as every other backend.
 *
 * Verified against OpenRouter on 2026-10-23: google/gemini-2.5-flash,
 * google/gemini-2.5-pro and openai/gpt-oss-120b all advertise `tools` and
 * `tool_choice`, which the agent loop requires. Re-check
 * `supported_parameters` on /api/v1/models before pinning a new model.
 *
 * The attribution headers are optional and carry no credentials; OpenRouter
 * uses them for its public app rankings.
 */
export async function runOpenRouterAgent(website: string): Promise<AnalysisReport> {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is required for OpenRouter agentic analysis");
  }

  return runOpenAiCompatibleAgent(website, {
    provider: "openrouter",
    baseUrl: OPENROUTER_BASE_URL,
    apiKey,
    models: getOpenRouterModels(),
    temperature: 0.4,
    // Without an explicit ceiling OpenRouter reserves the model's whole output
    // window and rejects the request with 402 unless the balance covers it.
    maxOutputTokens: getOpenRouterMaxOutputTokens(),
    extraHeaders: {
      "HTTP-Referer": siteConfig.url,
      "X-Title": "Revel",
    },
  });
}
