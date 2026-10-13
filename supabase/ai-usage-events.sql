-- Run in Supabase SQL Editor (mirror of prisma/migrations/20261013120000_ai_usage_events)
-- AI usage accounting + audit duration.
--
-- One row per provider ATTEMPT (including failures and fallbacks) so that
-- "AI cost per completed audit" can include the retries it really consumed.
--
-- NULL token/cost columns mean UNKNOWN, never zero. "cost_source"
-- distinguishes a genuinely free call ('free_tier') from a missing price
-- ('unknown') and from a provider-billed figure ('provider_reported').
--
-- Contains no prompts, page bodies, credentials or user content.

CREATE TABLE IF NOT EXISTS "ai_usage_events" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Idempotency key: one row per attempt, prevents double accounting.
  "attempt_id" UUID NOT NULL UNIQUE,
  "analysis_id" UUID,
  "source" TEXT,
  "provider" TEXT NOT NULL,
  -- Exact model identifier as sent to the provider.
  "model" TEXT NOT NULL,
  -- success | error | rate_limited | timeout | invalid_output | report_rejected
  "status" TEXT NOT NULL,
  "attempt_index" INTEGER NOT NULL DEFAULT 0,
  "latency_ms" INTEGER NOT NULL,
  "provider_request_id" TEXT,
  "http_status" INTEGER,
  "input_tokens" INTEGER,
  "output_tokens" INTEGER,
  "total_tokens" INTEGER,
  "reasoning_tokens" INTEGER,
  "cached_input_tokens" INTEGER,
  -- TRUE when reasoning_tokens are already inside output_tokens.
  "reasoning_included_in_output" BOOLEAN,
  -- provider_reported | estimated | unavailable
  "usage_source" TEXT NOT NULL,
  "reported_cost_usd" DECIMAL(14, 8),
  "estimated_cost_usd" DECIMAL(14, 8),
  -- provider_reported | estimated | free_tier | unknown
  "cost_source" TEXT NOT NULL,
  "pricing_version" TEXT,
  "error_kind" TEXT,
  "error_detail" TEXT,
  "created_at" TIMESTAMPTZ(6) DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "idx_ai_usage_events_created_at"
  ON "ai_usage_events" ("created_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_ai_usage_events_analysis_id"
  ON "ai_usage_events" ("analysis_id");
CREATE INDEX IF NOT EXISTS "idx_ai_usage_events_provider_model"
  ON "ai_usage_events" ("provider", "model");
CREATE INDEX IF NOT EXISTS "idx_ai_usage_events_status"
  ON "ai_usage_events" ("status");
CREATE INDEX IF NOT EXISTS "idx_ai_usage_events_source"
  ON "ai_usage_events" ("source");

-- Audit duration for median/p95 reporting, and a terminal-state timestamp.
-- "partial" joins processing/completed/failed as a valid analyses.status.
ALTER TABLE "analyses"
  ADD COLUMN IF NOT EXISTS "completed_at" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "duration_ms" INTEGER;

CREATE INDEX IF NOT EXISTS "idx_analyses_status"
  ON "analyses" ("status");
