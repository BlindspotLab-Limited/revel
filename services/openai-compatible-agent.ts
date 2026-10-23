import {
  getAgentMaxSteps,
  getAuditBudgetMs,
  getAuditPageTarget,
  getProviderMaxRetries,
  getProviderRequestTimeoutMs,
} from "@/lib/analysis-provider";
import {
  classifyProviderFailure,
  normalizeOpenAiUsage,
  recordProviderAttempt,
  UNAVAILABLE_USAGE,
} from "@/lib/ai-usage/recorder";
import {
  DeadlineExceededError,
  isDeadlineError,
  resilientFetch,
} from "@/lib/resilient-fetch";
import { buildAgentSystemPrompt } from "@/lib/prompt-builder";
import type { AnalysisReport } from "@/types/analysis";
import {
  executeAgentTool,
  getOpenAIAgentTools,
  isAgentToolName,
} from "@/services/agent-tools";

/**
 * One agent loop shared by every OpenAI-compatible provider (Groq, NVIDIA).
 *
 * Replaces the per-provider copies in groq-agent.ts / nvidia. Keeping a single
 * loop matters because the execution-policy bug it fixes existed identically in
 * both: `submitOnly` was set as soon as two pages had been fetched, which
 * pinned `tool_choice` to submit_analysis_report and made the documented
 * "homepage plus 2-4 key pages" coverage unreachable.
 */

type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | {
      role: "assistant";
      content: string | null;
      tool_calls?: ToolCall[];
    }
  | { role: "tool"; tool_call_id: string; name: string; content: string };

interface ChatChoice {
  message?: {
    content?: string | null;
    tool_calls?: ToolCall[];
    /** Nemotron/DeepSeek-style reasoning trace — never shown to customers. */
    reasoning_content?: string | null;
    reasoning?: string | null;
  };
  finish_reason?: string;
}

interface ChatResponse {
  id?: string;
  choices?: ChatChoice[];
  usage?: unknown;
}

export interface OpenAiCompatibleConfig {
  provider: "groq" | "nvidia" | "openrouter";
  baseUrl: string;
  apiKey: string;
  models: string[];
  temperature?: number;
  maxOutputTokens?: number;
  /** Provider-specific body fields (e.g. nemotron chat_template_kwargs). */
  extraBody?: Record<string, unknown>;
  /** Provider-specific headers (e.g. OpenRouter attribution). */
  extraHeaders?: Record<string, string>;
}

function isRetryableStatus(status: number): boolean {
  return (
    status === 408 ||
    status === 409 ||
    status === 429 ||
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 529
  );
}

/**
 * Should we try the NEXT model in the list?
 *
 * Distinct from `isRetryableStatus`, which is about retrying the same call.
 * A 404 means "this model does not exist for this account" — a per-model fact,
 * so the next model may well work. Treating 404 as fatal made a single retired
 * model take the whole provider down: when Groq decommissioned
 * llama-3.3-70b-versatile, the configured fallback was never attempted.
 *
 * 401/403 are account-level and abort the provider: no model will work.
 */
function shouldTryNextModel(status: number): boolean {
  if (status === 401 || status === 403) return false;
  return status === 404 || status === 400 || isRetryableStatus(status);
}

interface CallResult {
  ok: boolean;
  data?: ChatResponse;
  status?: number;
  detail?: string;
}

/** One HTTP attempt against one model, with usage recorded either way. */
async function callModel(
  config: OpenAiCompatibleConfig,
  model: string,
  messages: ChatMessage[],
  options: { submitOnly: boolean; deadlineSignal: AbortSignal }
): Promise<CallResult> {
  const startedAt = Date.now();

  const body: Record<string, unknown> = {
    model,
    messages,
    tools: getOpenAIAgentTools(),
    tool_choice: options.submitOnly
      ? { type: "function", function: { name: "submit_analysis_report" } }
      : "auto",
    temperature: config.temperature ?? 0.4,
    ...(config.maxOutputTokens ? { max_tokens: config.maxOutputTokens } : {}),
    ...(config.extraBody ?? {}),
  };

  try {
    const response = await resilientFetch(`${config.baseUrl}/chat/completions`, {
      context: `${config.provider} API`,
      retries: getProviderMaxRetries(),
      timeoutMs: getProviderRequestTimeoutMs(),
      deadlineSignal: options.deadlineSignal,
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
        ...config.extraHeaders,
      },
      body: JSON.stringify(body),
    });

    const latencyMs = Date.now() - startedAt;

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      const { status, errorKind } = classifyProviderFailure(
        response.status,
        detail
      );
      await recordProviderAttempt({
        provider: config.provider,
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

    const data = (await response.json()) as ChatResponse;
    const finishReason = data.choices?.[0]?.finish_reason;
    const truncated = finishReason === "length";

    await recordProviderAttempt({
      provider: config.provider,
      model,
      status: truncated ? "invalid_output" : "success",
      ...(truncated
        ? { errorKind: "truncated", errorDetail: "finish_reason=length" }
        : {}),
      httpStatus: response.status,
      latencyMs,
      providerRequestId: data.id,
      usage: normalizeOpenAiUsage(data.usage),
      reportedCostUsd: readReportedCost(data.usage),
    });

    return { ok: true, data };
  } catch (error) {
    const latencyMs = Date.now() - startedAt;

    if (isDeadlineError(error)) {
      await recordProviderAttempt({
        provider: config.provider,
        model,
        status: "timeout",
        errorKind: "deadline",
        errorDetail: error instanceof Error ? error.message : "deadline",
        latencyMs,
        usage: UNAVAILABLE_USAGE,
      });
      throw error instanceof DeadlineExceededError
        ? error
        : new DeadlineExceededError(`${config.provider} API`);
    }

    const detail =
      error instanceof Error
        ? error.message
        : `${config.provider} API unreachable`;
    const { status, errorKind } = classifyProviderFailure(undefined, detail);

    await recordProviderAttempt({
      provider: config.provider,
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

/** OpenRouter-style real cost, when the provider includes it. */
function readReportedCost(usage: unknown): number | null {
  if (!usage || typeof usage !== "object") return null;
  const cost = (usage as Record<string, unknown>).cost;
  return typeof cost === "number" && Number.isFinite(cost) ? cost : null;
}

async function callWithModelFallback(
  config: OpenAiCompatibleConfig,
  messages: ChatMessage[],
  activeModel: string,
  options: { submitOnly: boolean; deadlineSignal: AbortSignal }
): Promise<{ data: ChatResponse; model: string }> {
  const ordered = [
    activeModel,
    ...config.models.filter((model) => model !== activeModel),
  ];
  const errors: string[] = [];

  for (const model of ordered) {
    const result = await callModel(config, model, messages, options);

    if (result.ok && result.data) {
      return { data: result.data, model };
    }

    errors.push(
      `${model} (${result.status}): ${(result.detail ?? "").slice(0, 120)}`
    );

    if (result.status !== undefined && !shouldTryNextModel(result.status)) {
      break;
    }
  }

  throw new Error(
    `All ${config.provider} models failed. Last errors: ${errors
      .slice(-2)
      .join(" | ")}`
  );
}

function coverageNudge(
  fetchedPages: number,
  target: { min: number; max: number }
): string {
  if (fetchedPages === 0) {
    return "Call fetch_url on the homepage now.";
  }
  if (fetchedPages === 1) {
    return `Call discover_internal_links on the homepage, then fetch_url on a key page (pricing, about, features or product).`;
  }
  if (fetchedPages < target.min) {
    return `Fetch at least ${target.min} pages before submitting.`;
  }
  if (fetchedPages < target.max) {
    return `You have ${fetchedPages} pages. Fetch another key page if it would add evidence, otherwise call submit_analysis_report with report_json.`;
  }
  return "You have enough coverage. Call submit_analysis_report with report_json.";
}

export async function runOpenAiCompatibleAgent(
  website: string,
  config: OpenAiCompatibleConfig
): Promise<AnalysisReport> {
  if (!config.apiKey) {
    throw new Error(`${config.provider} API key is required`);
  }
  if (config.models.length === 0) {
    throw new Error(`${config.provider} has no configured model`);
  }

  const target = getAuditPageTarget();
  const maxSteps = getAgentMaxSteps();

  // Total audit budget — keeps the run well inside the Workflow step timeout
  // so a result is always persisted rather than the record being stranded.
  const budgetController = new AbortController();
  const budgetTimer = setTimeout(
    () => budgetController.abort(),
    getAuditBudgetMs()
  );

  let activeModel = config.models[0];
  const messages: ChatMessage[] = [
    { role: "system", content: buildAgentSystemPrompt() },
    {
      role: "user",
      content: `Analyze this website and produce a product, messaging and UX-copy audit: ${website}

Fetch the homepage first, then discover internal links and fetch the key pages that exist (aim for ${target.min}-${target.max} pages in total). Submit via submit_analysis_report once the evidence you have supports your findings. Report only what you actually found.`,
    },
  ];

  let submittedReport: AnalysisReport | null = null;
  let fetchedPages = 0;
  let rejectionCount = 0;

  try {
    for (let step = 0; step < maxSteps; step++) {
      if (budgetController.signal.aborted) {
        throw new DeadlineExceededError("audit budget");
      }

      // Force the final submit only when coverage is genuinely complete, or
      // when the step budget is nearly spent — never merely because two pages
      // happened to load.
      const submitOnly =
        fetchedPages >= target.max || step >= maxSteps - 2;

      if (submitOnly && !submittedReport) {
        messages.push({
          role: "user",
          content: `${coverageNudge(
            fetchedPages,
            target
          )} Ground every finding in text you fetched. Do not pad the finding list and do not inflate severity.`,
        });
      }

      let toolCalls: ToolCall[] = [];
      let assistantContent: string | null = null;
      let sawResponse = false;

      for (let apiRetry = 0; apiRetry < 3; apiRetry++) {
        const { data, model } = await callWithModelFallback(
          config,
          messages,
          activeModel,
          { submitOnly, deadlineSignal: budgetController.signal }
        );
        activeModel = model;
        sawResponse = true;

        const choice = data.choices?.[0];
        // Reasoning traces are deliberately dropped here: they must never
        // reach a customer report or the stored transcript.
        assistantContent = choice?.message?.content ?? null;
        toolCalls = choice?.message?.tool_calls ?? [];

        if (toolCalls.length) break;

        if (choice?.finish_reason === "length") {
          messages.push({
            role: "user",
            content:
              "Your previous response was cut off before the tool call completed. Reply with a single function call and keep report_json compact.",
          });
          continue;
        }

        if (assistantContent?.trim()) {
          messages.push({ role: "assistant", content: assistantContent.trim() });
        }

        messages.push({
          role: "user",
          content: `${coverageNudge(
            fetchedPages,
            target
          )} Respond with a function call, not plain text.`,
        });
      }

      if (!toolCalls.length) {
        throw new Error(
          `${config.provider} returned no tool calls (${
            sawResponse ? "no_tools" : "empty"
          })`
        );
      }

      messages.push({
        role: "assistant",
        content: assistantContent,
        tool_calls: toolCalls,
      });

      for (const call of toolCalls) {
        const name = call.function.name;
        let args: Record<string, unknown> = {};

        try {
          args = JSON.parse(call.function.arguments || "{}") as Record<
            string,
            unknown
          >;
        } catch {
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            name,
            content: JSON.stringify({
              error:
                "Invalid tool arguments JSON. Re-send the call with valid JSON.",
            }),
          });
          continue;
        }

        if (!isAgentToolName(name)) {
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            name,
            content: JSON.stringify({ error: `Unknown tool: ${name}` }),
          });
          continue;
        }

        const result = await executeAgentTool(name, args);
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          name,
          content: JSON.stringify(result.response),
        });

        if (name === "fetch_url" && result.response.contentRetrieved === true) {
          fetchedPages++;
        }

        // A report that failed evidence validation is a recorded outcome, not
        // a silent retry: the model gets the reason and one more chance.
        if (name === "submit_analysis_report" && !result.report) {
          rejectionCount++;
          await recordProviderAttempt({
            provider: config.provider,
            model: activeModel,
            status: "report_rejected",
            errorKind:
              result.response.evidenceRejected === true
                ? "evidence_unsupported"
                : "report_incomplete",
            errorDetail: String(result.response.error ?? ""),
            latencyMs: 0,
            usage: UNAVAILABLE_USAGE,
          });

          if (rejectionCount >= 3) {
            throw new Error(
              `${config.provider} report rejected ${rejectionCount} times: ${String(
                result.response.error ?? "unsupported claims"
              ).slice(0, 300)}`
            );
          }
        }

        if (result.report) {
          submittedReport = result.report;
        }
      }

      if (submittedReport) {
        return submittedReport;
      }
    }

    throw new Error(
      `Agent did not submit an accepted report within ${maxSteps} steps.`
    );
  } finally {
    clearTimeout(budgetTimer);
  }
}
