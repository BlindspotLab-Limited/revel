import { getGroqModels } from "@/lib/analysis-provider";
import type { AnalysisReport } from "@/types/analysis";
import { runOpenAiCompatibleAgent } from "@/services/openai-compatible-agent";

const GROQ_BASE_URL = "https://api.groq.com/openai/v1";

/**
 * Groq agentic analysis.
 *
 * The loop itself lives in `openai-compatible-agent.ts` and is shared with
 * NVIDIA, so the page-coverage policy, usage accounting, request deadlines and
 * bounded retries are identical across providers.
 */
export async function runGroqAgent(website: string): Promise<AnalysisReport> {
  const apiKey = process.env.GROQ_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("GROQ_API_KEY is required for Groq agentic analysis");
  }

  return runOpenAiCompatibleAgent(website, {
    provider: "groq",
    baseUrl: GROQ_BASE_URL,
    apiKey,
    models: getGroqModels(),
    temperature: 0.4,
  });
}
