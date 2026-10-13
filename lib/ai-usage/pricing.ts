/**
 * Operator-maintained pricing table for estimated AI cost.
 *
 * Every number here is an ESTIMATE. Estimated cost is reported separately from
 * provider-reported cost and is always labelled as such in the admin UI — it is
 * never summed into the same figure.
 *
 * Three distinct "no number" cases must stay distinguishable, because
 * collapsing them to 0 silently understates spend:
 *   - free_tier  : the call genuinely cost nothing (`:free` models, free quota)
 *   - unknown    : we have no price for this model (missing table entry)
 *   - unavailable: the provider returned no usage, so nothing can be computed
 *
 * Bump PRICING_VERSION whenever a rate changes; it is stored on every usage row
 * so historical cost can be recomputed or audited against the rates in force.
 */

export const PRICING_VERSION = "2026-10-13";

/**
 * Source note for the seeded rates. These came from public pricing pages and
 * third-party aggregators, NOT from a billing API, so treat them as approximate
 * and re-verify before using them for invoicing.
 */
export const PRICING_SOURCE_NOTE =
  "Seeded from public provider pricing and third-party aggregators on 2026-10-13. Approximate; re-verify against provider billing before financial use.";

export interface ModelRate {
  /** USD per 1M input (prompt) tokens. */
  inputPerMillion: number;
  /** USD per 1M output (completion) tokens. */
  outputPerMillion: number;
  /** USD per 1M cached input tokens, when the provider discounts them. */
  cachedInputPerMillion?: number;
  /** USD per 1M reasoning tokens when billed separately from output. */
  reasoningPerMillion?: number;
}

/** provider → exact model id → rate. Exact ids only; no prefix guessing. */
const RATES: Record<string, Record<string, ModelRate>> = {
  groq: {
    "llama-3.3-70b-versatile": {
      inputPerMillion: 0.59,
      outputPerMillion: 0.79,
    },
    "llama-3.1-8b-instant": {
      inputPerMillion: 0.05,
      outputPerMillion: 0.08,
    },
  },
  openrouter: {
    // OpenRouter returns real cost in usage.cost; these are a fallback only.
    "google/gemini-2.5-flash": {
      inputPerMillion: 0.3,
      outputPerMillion: 2.5,
    },
  },
  gemini: {
    "gemini-2.5-flash": {
      inputPerMillion: 0.3,
      outputPerMillion: 2.5,
    },
    "gemini-2.5-flash-lite": {
      inputPerMillion: 0.1,
      outputPerMillion: 0.4,
    },
  },
  nvidia: {
    // NVIDIA build.nvidia.com credits are not published as per-token USD.
    // Left empty on purpose: cost is recorded as "unknown", never as 0.
  },
};

export type CostSource =
  | "provider_reported"
  | "estimated"
  | "free_tier"
  | "unknown";

/** `:free` OpenRouter variants and similar genuinely-free routes. */
export function isFreeTierModel(model: string): boolean {
  return model.endsWith(":free");
}

export function getModelRate(
  provider: string,
  model: string
): ModelRate | undefined {
  return RATES[provider]?.[model];
}

export interface EstimateInput {
  provider: string;
  model: string;
  inputTokens?: number | null;
  outputTokens?: number | null;
  reasoningTokens?: number | null;
  cachedInputTokens?: number | null;
  /**
   * True when the provider already includes reasoning tokens inside
   * outputTokens. Reasoning is then NOT billed again on top.
   */
  reasoningIncludedInOutput?: boolean | null;
}

export interface EstimateResult {
  estimatedCostUsd: number | null;
  costSource: CostSource;
  pricingVersion: string;
}

/**
 * Estimate cost from token counts.
 *
 * Returns null (not 0) whenever the cost cannot be computed, with
 * `costSource` explaining why.
 */
export function estimateCost(input: EstimateInput): EstimateResult {
  if (isFreeTierModel(input.model)) {
    return {
      estimatedCostUsd: 0,
      costSource: "free_tier",
      pricingVersion: PRICING_VERSION,
    };
  }

  const rate = getModelRate(input.provider, input.model);
  if (!rate) {
    return {
      estimatedCostUsd: null,
      costSource: "unknown",
      pricingVersion: PRICING_VERSION,
    };
  }

  const inputTokens = input.inputTokens ?? null;
  const outputTokens = input.outputTokens ?? null;

  // No usage at all → nothing to estimate from.
  if (inputTokens === null && outputTokens === null) {
    return {
      estimatedCostUsd: null,
      costSource: "unknown",
      pricingVersion: PRICING_VERSION,
    };
  }

  const cached = input.cachedInputTokens ?? 0;
  const billableInput = Math.max(0, (inputTokens ?? 0) - cached);

  let cost =
    (billableInput / 1_000_000) * rate.inputPerMillion +
    (cached / 1_000_000) *
      (rate.cachedInputPerMillion ?? rate.inputPerMillion);

  // Reasoning tokens are billed once. When the provider folds them into
  // outputTokens (the common case), charging them again double-counts.
  const reasoning = input.reasoningTokens ?? 0;
  const reasoningAlreadyCounted = input.reasoningIncludedInOutput !== false;
  const billableOutput = outputTokens ?? 0;

  cost += (billableOutput / 1_000_000) * rate.outputPerMillion;

  if (reasoning > 0 && !reasoningAlreadyCounted) {
    cost +=
      (reasoning / 1_000_000) *
      (rate.reasoningPerMillion ?? rate.outputPerMillion);
  }

  return {
    estimatedCostUsd: Number(cost.toFixed(8)),
    costSource: "estimated",
    pricingVersion: PRICING_VERSION,
  };
}
