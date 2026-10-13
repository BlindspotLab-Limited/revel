import { isNetworkFetchError } from "@/lib/resilient-fetch";

export type AnalysisMode = "agentic" | "legacy";
/** Ordered backends — Groq and OpenRouter first; Gemini last (tight free quota). */
export type AnalysisBackend = "groq" | "openrouter" | "gemini" | "nvidia";
/** @deprecated Use AnalysisBackend — kept for older call sites */
export type AgentProvider = "groq" | "gemini" | "nvidia";

/**
 * Default analysis order when ANALYSIS_PROVIDER=auto:
 * 1. NVIDIA — primary when NVIDIA_API_KEY is set (NVIDIA_PRIMARY=false demotes it)
 * 2. Groq — agentic tool calling, free tier (tight rate limits)
 * 3. OpenRouter — single-shot grounded JSON (paid/reliable models)
 * 4. Gemini — last resort (small free quota)
 */
export function getAnalysisMode(): AnalysisMode {
  const raw = process.env.ANALYSIS_MODE?.toLowerCase();
  if (raw === "legacy") return "legacy";
  if (raw === "agentic") return "agentic";
  if (
    isGroqAgentEnabled() ||
    isGeminiAgentEnabled() ||
    isOpenRouterEnabled()
  ) {
    // OpenRouter-only → still use cascade via generateAgenticAnalysis when agentic keys exist
    if (isGroqAgentEnabled() || isGeminiAgentEnabled()) return "agentic";
    return "legacy";
  }
  return "legacy";
}

export function isGroqAgentEnabled(): boolean {
  return Boolean(process.env.GROQ_API_KEY?.trim());
}

export function isGeminiAgentEnabled(): boolean {
  return Boolean(process.env.GEMINI_API_KEY?.trim());
}

export function isOpenRouterEnabled(): boolean {
  return Boolean(process.env.OPENROUTER_API_KEY?.trim());
}

export function isNvidiaAgentEnabled(): boolean {
  return Boolean(process.env.NVIDIA_API_KEY?.trim());
}

/**
 * NVIDIA is the primary analysis provider when its key is configured
 * (owner decision, 2026-10-13); Groq, OpenRouter and Gemini are fallbacks.
 *
 * Opt out without removing the key by setting NVIDIA_PRIMARY=false, which
 * demotes NVIDIA to the end of the chain. With no key configured the order is
 * unchanged, so this cannot alter an environment that has not been given one.
 */
export function isNvidiaPrimary(): boolean {
  return (
    isNvidiaAgentEnabled() &&
    process.env.NVIDIA_PRIMARY?.toLowerCase() !== "false"
  );
}

/**
 * Preferred single agent provider for logging / explicit override.
 * Does not include openrouter (handled in the cascade).
 */
export function getAgentProvider(): AgentProvider | null {
  const preferred = process.env.ANALYSIS_PROVIDER?.toLowerCase();

  if (preferred === "groq" && isGroqAgentEnabled()) return "groq";
  if (preferred === "gemini" && isGeminiAgentEnabled()) return "gemini";

  if (isGroqAgentEnabled()) return "groq";
  if (isGeminiAgentEnabled()) return "gemini";
  return null;
}

/**
 * Full provider chain for analysis. Order is always tried until one succeeds.
 * ANALYSIS_PROVIDER can pin the first backend: groq | openrouter | gemini | auto
 */
export function getAnalysisProviderChain(): AnalysisBackend[] {
  const preferred = process.env.ANALYSIS_PROVIDER?.toLowerCase() ?? "auto";
  const chain: AnalysisBackend[] = [];

  const push = (backend: AnalysisBackend) => {
    if (chain.includes(backend)) return;
    if (backend === "groq" && !isGroqAgentEnabled()) return;
    if (backend === "openrouter" && !isOpenRouterEnabled()) return;
    if (backend === "gemini" && !isGeminiAgentEnabled()) return;
    if (backend === "nvidia" && !isNvidiaAgentEnabled()) return;
    chain.push(backend);
  };

  if (
    preferred === "groq" ||
    preferred === "openrouter" ||
    preferred === "gemini" ||
    preferred === "nvidia"
  ) {
    push(preferred);
  }

  // Default order: NVIDIA (primary) → Groq → OpenRouter → Gemini (last).
  // NVIDIA leads only when a key is configured and NVIDIA_PRIMARY is not
  // "false"; otherwise the previous Groq-first order is preserved exactly.
  if (isNvidiaPrimary()) {
    push("nvidia");
  }
  push("groq");
  push("openrouter");
  push("gemini");
  // Demoted NVIDIA still available as a last resort.
  push("nvidia");

  return chain;
}

/**
 * Groq defaults.
 *
 * Verified against GET https://api.groq.com/openai/v1/models on 2026-10-13:
 * the previous defaults `llama-3.3-70b-versatile` and `llama-3.1-8b-instant`
 * have been decommissioned and return HTTP 404 ("model does not exist"). Groq
 * is first in the production cascade, so every audit was failing through it.
 *
 * These are tool-calling capable models that the account can currently reach.
 * Re-verify against /v1/models when Groq retires a model again.
 */
const DEFAULT_GROQ_MODEL = "openai/gpt-oss-120b";
const BUILTIN_GROQ_FALLBACKS = ["openai/gpt-oss-20b", "qwen/qwen3.8-27b"];

export function getGroqModel(): string {
  return getGroqModels()[0];
}

export function getGroqModels(): string[] {
  const primary = process.env.GROQ_MODEL?.trim() || DEFAULT_GROQ_MODEL;
  const extra = (process.env.GROQ_MODEL_FALLBACK ?? "")
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean);

  // Models Groq has retired. Keeping them out stops a stale env var from
  // pinning a 404 model as the primary and burning the first attempt.
  const removed = new Set([
    "meta-llama/llama-4-scout-17b-16e-instruct",
    "llama-3.3-70b-versatile",
    "llama-3.1-8b-instant",
  ]);
  return [
    ...new Set(
      [primary, ...extra, ...BUILTIN_GROQ_FALLBACKS.filter((m) => m !== primary)]
        .filter((model) => !removed.has(model))
    ),
  ];
}

const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";
const BUILTIN_GEMINI_FALLBACKS = ["gemini-2.5-flash-lite"];

export function getGeminiModel(): string {
  return getGeminiModels()[0];
}

export function getGeminiModels(): string[] {
  const primary = process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL;
  const extra = (process.env.GEMINI_MODEL_FALLBACK ?? "")
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean);

  return [
    ...new Set([
      primary,
      ...extra,
      ...BUILTIN_GEMINI_FALLBACKS.filter((model) => model !== primary),
    ]),
  ];
}

/** Official OpenAI-compatible NVIDIA endpoint (verified against /v1/models). */
export const NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1";

const DEFAULT_NVIDIA_MODEL = "nvidia/nemotron-3-super-120b-a12b";
const BUILTIN_NVIDIA_FALLBACKS = ["nvidia/nemotron-nano-3-30b-a3b"];

export function getNvidiaBaseUrl(): string {
  return process.env.NVIDIA_BASE_URL?.trim() || NVIDIA_BASE_URL;
}

export function getNvidiaModel(): string {
  return getNvidiaModels()[0];
}

export function getNvidiaModels(): string[] {
  const primary = process.env.NVIDIA_MODEL?.trim() || DEFAULT_NVIDIA_MODEL;
  const extra = (process.env.NVIDIA_MODEL_FALLBACK ?? "")
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean);

  return [
    ...new Set([
      primary,
      ...extra,
      ...BUILTIN_NVIDIA_FALLBACKS.filter((model) => model !== primary),
    ]),
  ];
}

/**
 * Nemotron 3 reasoning is controlled through `chat_template_kwargs`
 * (`enable_thinking`, `low_effort`) rather than a top-level `reasoning_effort`
 * field. Reasoning is ON by default upstream; we default it OFF because
 * reasoning traces must never reach a customer report and add latency we
 * cannot spend inside a Vercel function budget.
 */
export function getNvidiaThinkingConfig(): {
  enableThinking: boolean;
  lowEffort: boolean;
} {
  const raw = process.env.NVIDIA_REASONING?.toLowerCase().trim();
  if (raw === "high") return { enableThinking: true, lowEffort: false };
  if (raw === "low") return { enableThinking: true, lowEffort: true };
  return { enableThinking: false, lowEffort: false };
}

export function getNvidiaMaxOutputTokens(): number {
  const n = Number(process.env.NVIDIA_MAX_OUTPUT_TOKENS ?? "8192");
  return Number.isFinite(n) && n > 0 ? Math.min(n, 32768) : 8192;
}

export function getAgentMaxSteps(): number {
  const n = Number(process.env.AGENT_MAX_STEPS ?? "10");
  return Number.isFinite(n) && n > 0 ? Math.min(n, 20) : 10;
}

/**
 * Page-coverage policy for agentic runs.
 *
 * The documented behaviour (system prompt, A2MCP skill) is "homepage plus 2-4
 * key pages". The agents previously forced `tool_choice: submit_analysis_report`
 * as soon as two fetches succeeded, so the documented coverage could never
 * happen. These bounds are the single source of truth for both.
 */
export function getAuditPageTarget(): { min: number; max: number } {
  const min = Number(process.env.AUDIT_MIN_PAGES ?? "2");
  const max = Number(process.env.AUDIT_MAX_PAGES ?? "4");
  const safeMin = Number.isFinite(min) && min > 0 ? Math.min(min, 6) : 2;
  const safeMax = Number.isFinite(max) && max >= safeMin ? Math.min(max, 8) : 4;
  return { min: safeMin, max: safeMax };
}

/**
 * Total wall-clock budget for one audit, kept under the Vercel function
 * maxDuration (300s) so the run finishes and persists a result rather than
 * being killed mid-flight with the record stuck in "processing".
 */
export function getAuditBudgetMs(): number {
  const n = Number(process.env.AUDIT_BUDGET_MS ?? "240000");
  return Number.isFinite(n) && n > 0 ? Math.min(n, 280_000) : 240_000;
}

/** Per-request deadline for a single provider HTTP call. */
export function getProviderRequestTimeoutMs(): number {
  const n = Number(process.env.PROVIDER_REQUEST_TIMEOUT_MS ?? "60000");
  return Number.isFinite(n) && n > 0 ? Math.min(n, 180_000) : 60_000;
}

/** Bounded retries for a single provider call. */
export function getProviderMaxRetries(): number {
  const n = Number(process.env.PROVIDER_MAX_RETRIES ?? "2");
  return Number.isFinite(n) && n >= 0 ? Math.min(n, 5) : 2;
}

function errorTextForMatch(error: unknown): string {
  const publicMsg = error instanceof Error ? error.message : String(error);
  const serverDetail =
    error &&
    typeof error === "object" &&
    "serverDetail" in error &&
    typeof (error as { serverDetail: unknown }).serverDetail === "string"
      ? (error as { serverDetail: string }).serverDetail
      : "";
  return `${publicMsg} ${serverDetail}`;
}

export function isRateLimitError(error: unknown): boolean {
  const message = errorTextForMatch(error);
  return (
    message.includes("429") ||
    /quota/i.test(message) ||
    /rate limit/i.test(message) ||
    /resource.exhausted/i.test(message)
  );
}

/** @deprecated Use isRateLimitError */
export function isGeminiQuotaError(error: unknown): boolean {
  return isRateLimitError(error);
}

/** Failures where trying the next provider/model is the right move. */
export function isRecoverableAgenticFailure(error: unknown): boolean {
  // ClientSafeError.message is public — match against serverDetail as well
  const message = errorTextForMatch(error);

  return (
    isRateLimitError(error) ||
    isNetworkFetchError(error) ||
    message.includes("did not submit a report") ||
    message.includes("returned no tool calls") ||
    message.includes("All Groq models failed") ||
    message.includes("All analysis models failed") ||
    message.includes("All analysis providers failed") ||
    message.includes("all models failed") ||
    message.includes("Groq API") ||
    message.includes("Gemini API") ||
    message.includes("OpenRouter") ||
    message.includes("openrouter:") ||
    message.includes("AI gateway error") ||
    message.includes("Incomplete") ||
    message.includes("generic audit") ||
    message.includes("Incomplete or generic") ||
    message.includes("Incomplete audit")
  );
}
