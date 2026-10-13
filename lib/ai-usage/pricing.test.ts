import assert from "node:assert/strict";
import { estimateCost, getModelRate } from "@/lib/ai-usage/pricing";
import {
  normalizeGeminiUsage,
  normalizeOpenAiUsage,
  UNAVAILABLE_USAGE,
} from "@/lib/ai-usage/recorder";

// ---------------------------------------------------------------------------
// Unknown pricing must stay unknown — never silently 0, which would hide spend.
// ---------------------------------------------------------------------------
const unknownModel = estimateCost({
  provider: "nvidia",
  model: "nvidia/nemotron-3-super-120b-a12b",
  inputTokens: 1000,
  outputTokens: 500,
});
assert.equal(unknownModel.estimatedCostUsd, null);
assert.equal(unknownModel.costSource, "unknown");

// A genuinely free route is distinguishable from a missing price.
const free = estimateCost({
  provider: "openrouter",
  model: "qwen/qwen3-next-80b-a3b-instruct:free",
  inputTokens: 1000,
  outputTokens: 500,
});
assert.equal(free.estimatedCostUsd, 0);
assert.equal(free.costSource, "free_tier");

// Known model with no usage at all → unknown, not 0.
const noUsage = estimateCost({
  provider: "groq",
  model: "llama-3.3-70b-versatile",
  inputTokens: null,
  outputTokens: null,
});
assert.equal(noUsage.estimatedCostUsd, null);
assert.equal(noUsage.costSource, "unknown");

// ---------------------------------------------------------------------------
// Known rate maths
// ---------------------------------------------------------------------------
const rate = getModelRate("groq", "llama-3.3-70b-versatile");
assert.ok(rate);
const known = estimateCost({
  provider: "groq",
  model: "llama-3.3-70b-versatile",
  inputTokens: 1_000_000,
  outputTokens: 1_000_000,
});
assert.equal(known.costSource, "estimated");
assert.equal(
  known.estimatedCostUsd,
  Number((rate!.inputPerMillion + rate!.outputPerMillion).toFixed(8))
);

// ---------------------------------------------------------------------------
// Reasoning tokens must not be double-counted.
//
// OpenAI-compatible providers report reasoning as a BREAKDOWN of completion
// tokens, so charging it again on top would overstate cost.
// ---------------------------------------------------------------------------
const included = estimateCost({
  provider: "groq",
  model: "llama-3.3-70b-versatile",
  inputTokens: 0,
  outputTokens: 1_000_000,
  reasoningTokens: 400_000,
  reasoningIncludedInOutput: true,
});
assert.equal(
  included.estimatedCostUsd,
  Number(rate!.outputPerMillion.toFixed(8)),
  "reasoning already inside outputTokens must not be billed twice"
);

// When the provider reports reasoning SEPARATELY (Gemini thoughtsTokenCount),
// it is additional billable output.
const separate = estimateCost({
  provider: "groq",
  model: "llama-3.3-70b-versatile",
  inputTokens: 0,
  outputTokens: 1_000_000,
  reasoningTokens: 1_000_000,
  reasoningIncludedInOutput: false,
});
assert.equal(
  separate.estimatedCostUsd,
  Number((rate!.outputPerMillion * 2).toFixed(8))
);

// Unstated (null) is treated as included — the conservative, non-inflating choice.
const unstated = estimateCost({
  provider: "groq",
  model: "llama-3.3-70b-versatile",
  inputTokens: 0,
  outputTokens: 1_000_000,
  reasoningTokens: 500_000,
  reasoningIncludedInOutput: null,
});
assert.equal(unstated.estimatedCostUsd, included.estimatedCostUsd);

// Cached input tokens are discounted out of the billable input count.
const cachedRate = getModelRate("gemini", "gemini-2.5-flash")!;
const cached = estimateCost({
  provider: "gemini",
  model: "gemini-2.5-flash",
  inputTokens: 1_000_000,
  outputTokens: 0,
  cachedInputTokens: 1_000_000,
});
// No cached rate configured → falls back to the normal input rate, not 0.
assert.equal(
  cached.estimatedCostUsd,
  Number(cachedRate.inputPerMillion.toFixed(8))
);

// ---------------------------------------------------------------------------
// Usage normalization
// ---------------------------------------------------------------------------
const openai = normalizeOpenAiUsage({
  prompt_tokens: 1200,
  completion_tokens: 800,
  total_tokens: 2000,
  completion_tokens_details: { reasoning_tokens: 300 },
  prompt_tokens_details: { cached_tokens: 200 },
});
assert.equal(openai.inputTokens, 1200);
assert.equal(openai.outputTokens, 800);
assert.equal(openai.totalTokens, 2000);
assert.equal(openai.reasoningTokens, 300);
assert.equal(openai.cachedInputTokens, 200);
assert.equal(openai.reasoningIncludedInOutput, true);
assert.equal(openai.usageSource, "provider_reported");

const gemini = normalizeGeminiUsage({
  promptTokenCount: 500,
  candidatesTokenCount: 400,
  thoughtsTokenCount: 150,
  totalTokenCount: 1050,
});
assert.equal(gemini.inputTokens, 500);
assert.equal(gemini.outputTokens, 400);
assert.equal(gemini.reasoningTokens, 150);
// Gemini reports thoughts separately from candidates.
assert.equal(gemini.reasoningIncludedInOutput, false);

// Missing / malformed usage → unavailable, with NULL counts (not zeros).
assert.deepEqual(normalizeOpenAiUsage(undefined), UNAVAILABLE_USAGE);
assert.deepEqual(normalizeOpenAiUsage({}), UNAVAILABLE_USAGE);
assert.deepEqual(normalizeGeminiUsage(null), UNAVAILABLE_USAGE);
assert.equal(UNAVAILABLE_USAGE.inputTokens, null);
assert.equal(UNAVAILABLE_USAGE.usageSource, "unavailable");

console.log("ai-usage pricing tests passed");
