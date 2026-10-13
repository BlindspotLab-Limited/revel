/**
 * Reproducible cost model for one Revel audit.
 *
 * Every number marked ASSUMPTION is an engineering estimate, not a measurement.
 * Once `ai_usage_events` has production data, replace these with the measured
 * figures from /mission-control/ai-usage and re-run.
 *
 *   node scripts/estimate-audit-cost.mjs
 */
const RATES = {
  "groq/llama-3.3-70b-versatile": { in: 0.59, out: 0.79 },
  "openrouter/google/gemini-2.5-flash": { in: 0.30, out: 2.50 },
};

// ASSUMPTION: agentic loop shape, from AGENT_MAX_STEPS and the 2-4 page target.
const AGENTIC = {
  calls: 6,              // ASSUMPTION: typical steps to fetch + submit
  avgInputTokens: 8000,  // ASSUMPTION: grows as fetched pages accumulate
  avgOutputTokens: 1500, // ASSUMPTION: final report JSON dominates
};

const SINGLE_SHOT = {
  calls: 1,
  avgInputTokens: 15000, // one page of extracted text + prompt
  avgOutputTokens: 3000,
};

const cost = (rate, shape) =>
  (shape.calls * shape.avgInputTokens / 1e6) * rate.in +
  (shape.calls * shape.avgOutputTokens / 1e6) * rate.out;

const groq = cost(RATES["groq/llama-3.3-70b-versatile"], AGENTIC);
const openrouter = cost(RATES["openrouter/google/gemini-2.5-flash"], SINGLE_SHOT);

// ASSUMPTION: 20% of audits exhaust Groq (rate limit / rejected report) and
// fall back, paying BOTH the wasted Groq attempts and the OpenRouter run.
const FALLBACK_RATE = 0.20;
// ASSUMPTION: a fallback burns ~60% of a full Groq run before giving up.
const WASTED_GROQ_FRACTION = 0.6;

const blendedAi =
  (1 - FALLBACK_RATE) * groq +
  FALLBACK_RATE * (groq * WASTED_GROQ_FRACTION + openrouter);

// ASSUMPTION: Vercel Fluid compute. 1.7 GB function, ~90s active per audit.
// Vercel active CPU/memory pricing varies by plan; treat as order-of-magnitude.
const VERCEL_GB_HOURS = (1.7 * 90) / 3600;
const VERCEL_USD_PER_GB_HOUR = 0.18; // ASSUMPTION
const vercel = VERCEL_GB_HOURS * VERCEL_USD_PER_GB_HOUR;

const f = (n) => `$${n.toFixed(4)}`;
console.log("--- Per-audit cost model (ALL FIGURES ESTIMATED) ---");
console.log("Groq agentic run              ", f(groq));
console.log("OpenRouter single-shot run    ", f(openrouter));
console.log(`Blended AI (incl. ${FALLBACK_RATE * 100}% fallback)`, f(blendedAi));
console.log("Vercel compute                ", f(vercel));
console.log("TOTAL variable cost / audit   ", f(blendedAi + vercel));
console.log("");
for (const price of [0.2, 0.35, 0.5, 0.75]) {
  const margin = (price - (blendedAi + vercel)) / price;
  console.log(
    `  at $${price.toFixed(2)}/audit → gross margin ${(margin * 100).toFixed(1)}%`
  );
}
