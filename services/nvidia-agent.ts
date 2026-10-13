import {
  getNvidiaBaseUrl,
  getNvidiaMaxOutputTokens,
  getNvidiaModels,
  getNvidiaThinkingConfig,
} from "@/lib/analysis-provider";
import type { AnalysisReport } from "@/types/analysis";
import { runOpenAiCompatibleAgent } from "@/services/openai-compatible-agent";

/**
 * NVIDIA agentic analysis via the OpenAI-compatible NIM endpoint.
 *
 * Verified against the live API on 2026-10-13:
 *   - base URL  https://integrate.api.nvidia.com/v1
 *   - GET /v1/models lists `nvidia/nemotron-3-super-120b-a12b`
 *
 * Reasoning control: Nemotron 3 exposes thinking through
 * `chat_template_kwargs` (`enable_thinking`, `low_effort`), not a top-level
 * `reasoning_effort` field. Reasoning defaults to ON upstream; Revel defaults
 * it OFF (NVIDIA_REASONING=off) because reasoning traces must never reach a
 * customer report and they consume latency the Vercel budget cannot spare.
 * Any `reasoning_content` the model does return is dropped by the shared agent
 * loop and never enters the report or the stored transcript.
 */
export async function runNvidiaAgent(website: string): Promise<AnalysisReport> {
  const apiKey = process.env.NVIDIA_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("NVIDIA_API_KEY is required for NVIDIA agentic analysis");
  }

  const thinking = getNvidiaThinkingConfig();

  return runOpenAiCompatibleAgent(website, {
    provider: "nvidia",
    baseUrl: getNvidiaBaseUrl(),
    apiKey,
    models: getNvidiaModels(),
    temperature: 0.4,
    maxOutputTokens: getNvidiaMaxOutputTokens(),
    extraBody: {
      chat_template_kwargs: {
        enable_thinking: thinking.enableThinking,
        ...(thinking.enableThinking ? { low_effort: thinking.lowEffort } : {}),
      },
    },
  });
}
