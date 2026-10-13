import {
  getAgentMaxSteps,
  getAuditBudgetMs,
  getAuditPageTarget,
  getGeminiModels,
  getProviderMaxRetries,
  getProviderRequestTimeoutMs,
} from "@/lib/analysis-provider";
import {
  classifyProviderFailure,
  normalizeGeminiUsage,
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
  AGENT_TOOL_DECLARATIONS,
  executeAgentTool,
  isAgentToolName,
} from "@/services/agent-tools";

type GeminiPart = {
  text?: string;
  functionCall?: { name: string; args: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
  thoughtSignature?: string;
  [key: string]: unknown;
};

interface GeminiContent {
  role: "user" | "model";
  parts: GeminiPart[];
}

interface GeminiCandidate {
  content?: GeminiContent;
  finishReason?: string;
  finishMessage?: string;
}

interface GeminiResponse {
  candidates?: GeminiCandidate[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: unknown;
  responseId?: string;
}

function geminiEndpoint(model: string, apiKey: string): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
}

function isRetryableGeminiStatus(status: number): boolean {
  return status === 429 || status === 500 || status === 503;
}

function toolConfigForModel(
  model: string,
  options?: { submitOnly?: boolean }
): {
  functionCallingConfig: {
    mode: "AUTO" | "ANY";
    allowedFunctionNames?: string[];
  };
} {
  if (options?.submitOnly) {
    return {
      functionCallingConfig: {
        mode: "ANY",
        allowedFunctionNames: ["submit_analysis_report"],
      },
    };
  }

  // Lite models often reply with chat instead of tools under AUTO.
  return {
    functionCallingConfig: { mode: model.includes("lite") ? "ANY" : "AUTO" },
  };
}

async function callGemini(
  apiKey: string,
  model: string,
  contents: GeminiContent[],
  options?: { submitOnly?: boolean; deadlineSignal?: AbortSignal }
): Promise<
  | { ok: true; data: GeminiResponse }
  | { ok: false; status: number; detail: string }
> {
  const startedAt = Date.now();

  try {
    const response = await resilientFetch(geminiEndpoint(model, apiKey), {
      context: "Gemini API",
      retries: getProviderMaxRetries(),
      timeoutMs: getProviderRequestTimeoutMs(),
      deadlineSignal: options?.deadlineSignal,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: buildAgentSystemPrompt() }],
        },
        contents,
        tools: [{ functionDeclarations: AGENT_TOOL_DECLARATIONS }],
        toolConfig: toolConfigForModel(model, options),
        generationConfig: {
          temperature: 0.4,
          ...(model.includes("lite")
            ? { thinkingConfig: { thinkingBudget: 0 } }
            : {}),
        },
      }),
    });

    const latencyMs = Date.now() - startedAt;

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      const { status, errorKind } = classifyProviderFailure(
        response.status,
        detail
      );
      await recordProviderAttempt({
        provider: "gemini",
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

    const data = (await response.json()) as GeminiResponse;
    const truncated = data.candidates?.[0]?.finishReason === "MAX_TOKENS";

    await recordProviderAttempt({
      provider: "gemini",
      model,
      status: truncated ? "invalid_output" : "success",
      ...(truncated
        ? { errorKind: "truncated", errorDetail: "finishReason=MAX_TOKENS" }
        : {}),
      httpStatus: response.status,
      latencyMs,
      providerRequestId: data.responseId,
      usage: normalizeGeminiUsage(data.usageMetadata),
    });

    return { ok: true, data };
  } catch (error) {
    const latencyMs = Date.now() - startedAt;

    if (isDeadlineError(error)) {
      await recordProviderAttempt({
        provider: "gemini",
        model,
        status: "timeout",
        errorKind: "deadline",
        errorDetail: error instanceof Error ? error.message : "deadline",
        latencyMs,
        usage: UNAVAILABLE_USAGE,
      });
      throw error instanceof DeadlineExceededError
        ? error
        : new DeadlineExceededError("Gemini API");
    }

    const detail =
      error instanceof Error ? error.message : "Gemini API unreachable";
    const { status, errorKind } = classifyProviderFailure(undefined, detail);

    await recordProviderAttempt({
      provider: "gemini",
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

async function callGeminiWithFallback(
  apiKey: string,
  contents: GeminiContent[],
  preferredModel: string,
  models: string[],
  options?: { submitOnly?: boolean; deadlineSignal?: AbortSignal }
): Promise<{ data: GeminiResponse; model: string }> {
  const ordered = [
    preferredModel,
    ...models.filter((model) => model !== preferredModel),
  ];
  const errors: string[] = [];

  for (const model of ordered) {
    const result = await callGemini(apiKey, model, contents, options);

    if (result.ok) {
      return { data: result.data, model };
    }

    errors.push(`${model} (${result.status}): ${result.detail.slice(0, 120)}`);

    if (!isRetryableGeminiStatus(result.status)) {
      break;
    }
  }

  const quotaOnly = errors.length > 0 && errors.every((entry) => entry.includes("(429)"));

  if (quotaOnly) {
    throw new Error(
      "Gemini free quota exceeded (429). Quota resets daily. Use gemini-2.5-flash-lite locally, or wait for reset."
    );
  }

  throw new Error(
    `All Gemini models failed. Last errors: ${errors.slice(-2).join(" | ")}`
  );
}

function extractFunctionCalls(candidate: GeminiCandidate | undefined): Array<{
  name: string;
  args: Record<string, unknown>;
}> {
  const parts = candidate?.content?.parts ?? [];
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];

  for (const part of parts) {
    const fn = part.functionCall;
    if (fn?.name) {
      calls.push({
        name: fn.name,
        args: fn.args ?? {},
      });
    }
  }

  return calls;
}

function hasModelText(candidate: GeminiCandidate | undefined): string | null {
  const parts = candidate?.content?.parts ?? [];
  for (const part of parts) {
    if (part.text?.trim()) {
      return part.text.trim();
    }
  }
  return null;
}

function describeEmptyCandidate(
  data: GeminiResponse,
  candidate: GeminiCandidate | undefined
): string {
  const parts = candidate?.content?.parts ?? [];
  const reason = candidate?.finishReason ?? "no_candidate";
  const message = candidate?.finishMessage ?? "";
  const blocked = data.promptFeedback?.blockReason ?? "";
  const partKeys = parts.map((part) => Object.keys(part).join("+")).join(", ");

  return [
    `finishReason=${reason}`,
    message && `message=${message}`,
    blocked && `blockReason=${blocked}`,
    partKeys && `partKeys=${partKeys}`,
  ]
    .filter(Boolean)
    .join(", ");
}

function nextToolNudge(
  fetchedPages: number,
  target: { min: number; max: number }
): string {
  if (fetchedPages === 0) {
    return "Call fetch_url on the homepage now.";
  }
  if (fetchedPages === 1) {
    return "Call discover_internal_links on the homepage, then fetch_url on a key page (pricing, about, features or product).";
  }
  if (fetchedPages < target.min) {
    return `Fetch at least ${target.min} pages before submitting.`;
  }
  if (fetchedPages < target.max) {
    return "Fetch another key page if it would add evidence, otherwise call submit_analysis_report with report_json.";
  }
  return "You have enough coverage. Call submit_analysis_report with report_json.";
}

export async function runGeminiAgent(website: string): Promise<AnalysisReport> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is required for agentic analysis");
  }

  const models = getGeminiModels();
  let activeModel = models[0];
  const maxSteps = getAgentMaxSteps();
  const target = getAuditPageTarget();

  // Total audit budget so the run always reaches a persisted terminal state.
  const budgetController = new AbortController();
  const budgetTimer = setTimeout(
    () => budgetController.abort(),
    getAuditBudgetMs()
  );

  const contents: GeminiContent[] = [
    {
      role: "user",
      parts: [
        {
          text: `Analyze this website and produce a product, messaging and UX-copy audit: ${website}

Fetch the homepage first, then discover internal links and fetch the key pages that exist (aim for ${target.min}-${target.max} pages in total). Submit via submit_analysis_report once the evidence you have supports your findings. Report only what you actually found.`,
        },
      ],
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

    // Force the final submit only when coverage is complete or the step budget
    // is nearly spent — not merely because two pages happened to load.
    const submitOnly = fetchedPages >= target.max || step >= maxSteps - 2;
    let modelParts: GeminiPart[] = [];
    let functionCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
    let candidate: GeminiCandidate | undefined;
    let data: GeminiResponse | undefined;

    if (submitOnly && !submittedReport) {
      contents.push({
        role: "user",
        parts: [
          {
            text: `${nextToolNudge(
              fetchedPages,
              target
            )} Ground every finding in text you fetched. Do not pad the finding list and do not inflate severity.`,
          },
        ],
      });
    }

    for (let apiRetry = 0; apiRetry < 3; apiRetry++) {
      let usedModel: string;
      ({ data, model: usedModel } = await callGeminiWithFallback(
        apiKey,
        contents,
        activeModel,
        models,
        { submitOnly, deadlineSignal: budgetController.signal }
      ));
      activeModel = usedModel;

      if (data.promptFeedback?.blockReason) {
        throw new Error(
          `Gemini blocked the request: ${data.promptFeedback.blockReason}`
        );
      }

      candidate = data.candidates?.[0];
      modelParts = candidate?.content?.parts ?? [];
      functionCalls = extractFunctionCalls(candidate);

      if (functionCalls.length) {
        break;
      }

      const text = hasModelText(candidate);
      if (text) {
        contents.push({ role: "model", parts: [{ text }] });
      }

      contents.push({
        role: "user",
        parts: [
          {
            text: `${nextToolNudge(
              fetchedPages,
              target
            )} Respond with a function call, not plain text.`,
          },
        ],
      });
    }

    if (!functionCalls.length) {
      throw new Error(
        `Gemini returned no tool calls (${describeEmptyCandidate(data!, candidate)})`
      );
    }

    // Preserve thoughtSignature and other Gemini 2.5 metadata for follow-up turns.
    contents.push({ role: "model", parts: modelParts });

    const responseParts: GeminiPart[] = [];

    for (const call of functionCalls) {
      if (!isAgentToolName(call.name)) {
        responseParts.push({
          functionResponse: {
            name: call.name,
            response: { error: `Unknown tool: ${call.name}` },
          },
        });
        continue;
      }

      const result = await executeAgentTool(call.name, call.args);
      responseParts.push({
        functionResponse: { name: call.name, response: result.response },
      });

      if (call.name === "fetch_url" && result.response.contentRetrieved === true) {
        fetchedPages++;
      }

      // A report that failed evidence validation is a recorded outcome, not a
      // silent retry: the model gets the reason and one more chance.
      if (call.name === "submit_analysis_report" && !result.report) {
        rejectionCount++;
        await recordProviderAttempt({
          provider: "gemini",
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
            `Gemini report rejected ${rejectionCount} times: ${String(
              result.response.error ?? "unsupported claims"
            ).slice(0, 300)}`
          );
        }
      }

      if (result.report) {
        submittedReport = result.report;
      }
    }

    contents.push({ role: "user", parts: responseParts });

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