import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { getActivityContext } from "@/lib/activity-context";
import { getPrisma } from "@/lib/prisma";
import { estimateCost, type CostSource } from "@/lib/ai-usage/pricing";

/**
 * Per-attempt AI usage accounting.
 *
 * Every provider HTTP attempt is recorded — not just the one that finally
 * succeeded. A fallback cascade that burns Groq, then OpenRouter, then Gemini
 * costs three times; recording only the winner understates spend and makes
 * "cost per completed audit" meaningless.
 *
 * Nothing sensitive is stored: no prompts, no fetched page bodies, no
 * credentials, no user content. Only provider, model, status, latency, token
 * counts and cost.
 */

export type UsageStatus =
  | "success"
  | "error"
  | "rate_limited"
  | "timeout"
  | "invalid_output"
  | "report_rejected";

export type UsageSource = "provider_reported" | "estimated" | "unavailable";

export interface NormalizedUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  reasoningTokens: number | null;
  cachedInputTokens: number | null;
  /**
   * Whether reasoningTokens are already inside outputTokens.
   * null when the provider does not say — treated as "included" when costing,
   * which is the conservative (non-double-counting) assumption.
   */
  reasoningIncludedInOutput: boolean | null;
  usageSource: UsageSource;
}

export const UNAVAILABLE_USAGE: NormalizedUsage = {
  inputTokens: null,
  outputTokens: null,
  totalTokens: null,
  reasoningTokens: null,
  cachedInputTokens: null,
  reasoningIncludedInOutput: null,
  usageSource: "unavailable",
};

interface AuditUsageContext {
  analysisId?: string;
  website?: string;
  /** Monotonic attempt counter across the whole audit. */
  counter: { value: number };
}

const storage = new AsyncLocalStorage<AuditUsageContext>();

export function runWithAuditUsageContext<T>(
  context: { analysisId?: string; website?: string },
  fn: () => Promise<T>
): Promise<T> {
  return storage.run({ ...context, counter: { value: 0 } }, fn);
}

export function getAuditUsageContext() {
  return storage.getStore();
}

function nextAttemptIndex(): number {
  const ctx = storage.getStore();
  if (!ctx) return 0;
  return ctx.counter.value++;
}

/**
 * OpenAI-compatible usage payload (Groq, OpenRouter, NVIDIA).
 *
 * `completion_tokens_details.reasoning_tokens` is, per the OpenAI spec that
 * these providers follow, a *breakdown of* completion_tokens — so it is already
 * included in the output count and must not be added again.
 */
export function normalizeOpenAiUsage(usage: unknown): NormalizedUsage {
  if (!usage || typeof usage !== "object") return UNAVAILABLE_USAGE;

  const u = usage as Record<string, unknown>;
  const num = (value: unknown): number | null =>
    typeof value === "number" && Number.isFinite(value) ? value : null;

  const promptDetails = (u.prompt_tokens_details ?? {}) as Record<string, unknown>;
  const completionDetails = (u.completion_tokens_details ?? {}) as Record<
    string,
    unknown
  >;

  const inputTokens = num(u.prompt_tokens) ?? num(u.input_tokens);
  const outputTokens = num(u.completion_tokens) ?? num(u.output_tokens);
  const reasoningTokens = num(completionDetails.reasoning_tokens);
  const cachedInputTokens = num(promptDetails.cached_tokens);

  if (inputTokens === null && outputTokens === null) {
    return UNAVAILABLE_USAGE;
  }

  return {
    inputTokens,
    outputTokens,
    totalTokens:
      num(u.total_tokens) ??
      (inputTokens !== null && outputTokens !== null
        ? inputTokens + outputTokens
        : null),
    reasoningTokens,
    cachedInputTokens,
    // Spec: reasoning_tokens is a subset of completion_tokens.
    reasoningIncludedInOutput: reasoningTokens === null ? null : true,
    usageSource: "provider_reported",
  };
}

/** Gemini `usageMetadata`. `thoughtsTokenCount` is billed as output. */
export function normalizeGeminiUsage(usage: unknown): NormalizedUsage {
  if (!usage || typeof usage !== "object") return UNAVAILABLE_USAGE;

  const u = usage as Record<string, unknown>;
  const num = (value: unknown): number | null =>
    typeof value === "number" && Number.isFinite(value) ? value : null;

  const inputTokens = num(u.promptTokenCount);
  const outputTokens = num(u.candidatesTokenCount);
  const reasoningTokens = num(u.thoughtsTokenCount);
  const cachedInputTokens = num(u.cachedContentTokenCount);

  if (inputTokens === null && outputTokens === null) {
    return UNAVAILABLE_USAGE;
  }

  return {
    inputTokens,
    outputTokens,
    totalTokens: num(u.totalTokenCount),
    reasoningTokens,
    cachedInputTokens,
    // Gemini reports thoughts separately from candidates: NOT included.
    reasoningIncludedInOutput: reasoningTokens === null ? null : false,
    usageSource: "provider_reported",
  };
}

/** Keep provider error text short and free of any echoed prompt content. */
function scrubErrorDetail(detail: string | undefined): string | undefined {
  if (!detail) return undefined;

  return detail
    // Drop long quoted spans — these are where echoed prompts/page text appear.
    .replace(/"[^"]{120,}"/g, '"<omitted>"')
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

export interface RecordAttemptInput {
  provider: string;
  /** Exact model identifier as sent to the provider. */
  model: string;
  status: UsageStatus;
  latencyMs: number;
  usage?: NormalizedUsage;
  /** Provider's own request id, when returned. */
  providerRequestId?: string;
  /** Real cost returned by the provider (OpenRouter usage.cost). */
  reportedCostUsd?: number | null;
  errorKind?: string;
  errorDetail?: string;
  httpStatus?: number;
}

export interface RecordedAttempt extends RecordAttemptInput {
  attemptId: string;
  attemptIndex: number;
  analysisId?: string;
  source?: string;
  estimatedCostUsd: number | null;
  costSource: CostSource;
  pricingVersion: string;
}

/**
 * Persist one provider attempt. Never throws — analytics must not be able to
 * fail an audit.
 */
export async function recordProviderAttempt(
  input: RecordAttemptInput
): Promise<RecordedAttempt> {
  const ctx = storage.getStore();
  const activity = getActivityContext();
  const usage = input.usage ?? UNAVAILABLE_USAGE;

  const estimate = estimateCost({
    provider: input.provider,
    model: input.model,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    reasoningTokens: usage.reasoningTokens,
    cachedInputTokens: usage.cachedInputTokens,
    reasoningIncludedInOutput: usage.reasoningIncludedInOutput,
  });

  const hasReportedCost =
    typeof input.reportedCostUsd === "number" &&
    Number.isFinite(input.reportedCostUsd);

  const record: RecordedAttempt = {
    ...input,
    attemptId: randomUUID(),
    attemptIndex: nextAttemptIndex(),
    analysisId: ctx?.analysisId,
    source: activity?.source,
    estimatedCostUsd: estimate.estimatedCostUsd,
    costSource: hasReportedCost ? "provider_reported" : estimate.costSource,
    pricingVersion: estimate.pricingVersion,
    errorDetail: scrubErrorDetail(input.errorDetail),
  };

  const prisma = getPrisma();
  if (!prisma) return record;

  try {
    await prisma.aiUsageEvent.create({
      data: {
        attemptId: record.attemptId,
        analysisId: record.analysisId ?? null,
        source: record.source ?? null,
        provider: record.provider,
        model: record.model,
        status: record.status,
        attemptIndex: record.attemptIndex,
        latencyMs: Math.round(record.latencyMs),
        providerRequestId: record.providerRequestId ?? null,
        httpStatus: record.httpStatus ?? null,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        totalTokens: usage.totalTokens,
        reasoningTokens: usage.reasoningTokens,
        cachedInputTokens: usage.cachedInputTokens,
        reasoningIncludedInOutput: usage.reasoningIncludedInOutput,
        usageSource: usage.usageSource,
        reportedCostUsd: hasReportedCost ? String(input.reportedCostUsd) : null,
        estimatedCostUsd:
          record.estimatedCostUsd === null
            ? null
            : String(record.estimatedCostUsd),
        costSource: record.costSource,
        pricingVersion: record.pricingVersion,
        errorKind: record.errorKind ?? null,
        errorDetail: record.errorDetail ?? null,
      },
    });
  } catch (error) {
    console.error(
      "[Revel] ai_usage_event_failed",
      error instanceof Error ? error.message : error
    );
  }

  return record;
}

/** Map an HTTP status / error to a stable status + errorKind pair. */
export function classifyProviderFailure(
  httpStatus: number | undefined,
  message: string
): { status: UsageStatus; errorKind: string } {
  if (httpStatus === 429 || /rate limit|quota|resource.exhausted/i.test(message)) {
    return { status: "rate_limited", errorKind: "rate_limit" };
  }
  if (/timeout|timed out|abort/i.test(message)) {
    return { status: "timeout", errorKind: "timeout" };
  }
  if (httpStatus === 401 || httpStatus === 403) {
    return { status: "error", errorKind: "auth" };
  }
  if (httpStatus && httpStatus >= 500) {
    return { status: "error", errorKind: "provider_5xx" };
  }
  if (httpStatus && httpStatus >= 400) {
    return { status: "error", errorKind: "provider_4xx" };
  }
  return { status: "error", errorKind: "network" };
}
