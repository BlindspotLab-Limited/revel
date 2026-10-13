import assert from "node:assert/strict";
import { getAnalysisProviderChain, getGroqModels } from "@/lib/analysis-provider";

function withEnv<T>(env: Record<string, string | undefined>, fn: () => T): T {
  const saved: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(env)) {
    saved[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return fn();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

const ALL_KEYS = {
  GROQ_API_KEY: "g",
  OPENROUTER_API_KEY: "o",
  GEMINI_API_KEY: "m",
  ANALYSIS_PROVIDER: undefined,
  NVIDIA_PRIMARY: undefined,
};

// NVIDIA leads when its key is configured.
assert.deepEqual(
  withEnv({ ...ALL_KEYS, NVIDIA_API_KEY: "n" }, getAnalysisProviderChain),
  ["nvidia", "groq", "openrouter", "gemini"]
);

// Without an NVIDIA key the previous order is preserved exactly.
assert.deepEqual(
  withEnv({ ...ALL_KEYS, NVIDIA_API_KEY: undefined }, getAnalysisProviderChain),
  ["groq", "openrouter", "gemini"]
);

// NVIDIA_PRIMARY=false demotes it to last without removing it.
assert.deepEqual(
  withEnv(
    { ...ALL_KEYS, NVIDIA_API_KEY: "n", NVIDIA_PRIMARY: "false" },
    getAnalysisProviderChain
  ),
  ["groq", "openrouter", "gemini", "nvidia"]
);

// An explicit pin wins over the default order.
assert.deepEqual(
  withEnv(
    { ...ALL_KEYS, NVIDIA_API_KEY: "n", ANALYSIS_PROVIDER: "openrouter" },
    getAnalysisProviderChain
  ),
  ["openrouter", "nvidia", "groq", "gemini"]
);

// A provider with no key is never in the chain.
assert.deepEqual(
  withEnv(
    {
      GROQ_API_KEY: undefined,
      OPENROUTER_API_KEY: undefined,
      GEMINI_API_KEY: undefined,
      NVIDIA_API_KEY: "n",
      ANALYSIS_PROVIDER: undefined,
      NVIDIA_PRIMARY: undefined,
    },
    getAnalysisProviderChain
  ),
  ["nvidia"]
);

// No keys at all → empty chain (the caller raises a configuration error).
assert.deepEqual(
  withEnv(
    {
      GROQ_API_KEY: undefined,
      OPENROUTER_API_KEY: undefined,
      GEMINI_API_KEY: undefined,
      NVIDIA_API_KEY: undefined,
      ANALYSIS_PROVIDER: undefined,
    },
    getAnalysisProviderChain
  ),
  []
);

// Groq models retired by the provider must never be attempted: both previous
// defaults now return HTTP 404, and pinning one via env wasted the first call.
const retired = ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"];
const defaults = withEnv(
  { GROQ_MODEL: undefined, GROQ_MODEL_FALLBACK: undefined },
  getGroqModels
);
for (const model of retired) {
  assert.ok(!defaults.includes(model), `${model} must not be a default`);
}
assert.ok(defaults.length > 0, "Groq must still have a usable default model");

const pinnedToRetired = withEnv(
  { GROQ_MODEL: "llama-3.3-70b-versatile", GROQ_MODEL_FALLBACK: undefined },
  getGroqModels
);
assert.ok(
  !pinnedToRetired.includes("llama-3.3-70b-versatile"),
  "a stale GROQ_MODEL pinning a retired model must be filtered out"
);
assert.ok(
  pinnedToRetired.length > 0,
  "filtering a retired pin must still leave a usable model"
);

console.log("analysis-provider tests passed");
