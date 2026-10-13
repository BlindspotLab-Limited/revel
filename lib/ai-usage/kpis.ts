import { getPrisma } from "@/lib/prisma";
import { PRICING_SOURCE_NOTE, PRICING_VERSION } from "@/lib/ai-usage/pricing";

/**
 * Admin KPIs for audit throughput and AI spend.
 *
 * Accounting rules that the shapes below exist to protect:
 *  - Every provider ATTEMPT counts, including failures and fallbacks. Cost per
 *    completed audit that ignored the retries would understate spend.
 *  - Reported cost (billed by the provider) and estimated cost (our pricing
 *    table) are never added together. They are separate totals with separate
 *    coverage counts.
 *  - "Unknown" is not zero. `unknownCostAttempts` and `tokensUnavailable`
 *    report how much of the window we genuinely cannot price.
 *  - A free call (`free_tier`) is distinct from a missing price (`unknown`).
 */

export interface KpiRange {
  from: string;
  to: string;
}

export interface RateWithDenominator {
  value: number | null;
  numerator: number;
  denominator: number;
  definition: string;
}

export interface ProviderModelUsage {
  provider: string;
  model: string;
  attempts: number;
  successes: number;
  failures: number;
  rateLimited: number;
  timeouts: number;
  invalidOutput: number;
  reportRejected: number;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  reasoningTokens: number | null;
  cachedInputTokens: number | null;
  /** Attempts where the provider returned usage. */
  tokensReported: number;
  /** Attempts with no usage at all — unknown, not zero. */
  tokensUnavailable: number;
  reportedCostUsd: number | null;
  reportedCostAttempts: number;
  estimatedCostUsd: number | null;
  estimatedCostAttempts: number;
  unknownCostAttempts: number;
  freeTierAttempts: number;
  avgLatencyMs: number | null;
}

export interface AuditUsageRow {
  analysisId: string;
  website: string | null;
  status: string;
  source: string | null;
  createdAt: string;
  durationMs: number | null;
  attempts: number;
  providers: string[];
  models: string[];
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  reasoningTokens: number | null;
  reportedCostUsd: number | null;
  estimatedCostUsd: number | null;
  unknownCostAttempts: number;
}

export interface AiUsageKpis {
  generatedAt: string;
  range: KpiRange;
  pricing: { version: string; note: string };
  audits: {
    requested: number;
    completed: number;
    partial: number;
    failed: number;
    processing: number;
    completionRate: RateWithDenominator;
    /** completed + partial over terminal runs. */
    deliveryRate: RateWithDenominator;
    uniqueUsers: number;
    anonymousAudits: number;
    bySource: Array<{
      source: string;
      requested: number;
      completed: number;
      partial: number;
      failed: number;
    }>;
  };
  duration: {
    medianMs: number | null;
    p95Ms: number | null;
    sampleSize: number;
    definition: string;
  };
  providers: ProviderModelUsage[];
  reliability: {
    auditsWithAttempts: number;
    auditsWithFallback: number;
    fallbackRate: RateWithDenominator;
    totalAttempts: number;
    retryAttempts: number;
    attemptsPerAudit: number | null;
  };
  cost: {
    reportedTotalUsd: number | null;
    reportedCostAttempts: number;
    estimatedTotalUsd: number | null;
    estimatedCostAttempts: number;
    unknownCostAttempts: number;
    freeTierAttempts: number;
    /**
     * Spend across ALL attempts belonging to audits that reached completed or
     * partial in this window — retries and failed fallbacks included.
     */
    perCompletedAudit: {
      auditsCounted: number;
      attemptsCounted: number;
      reportedTotalUsd: number | null;
      estimatedTotalUsd: number | null;
      /** reported where available, else estimated. Labelled as blended. */
      blendedAvgUsd: number | null;
      unknownCostAttempts: number;
      definition: string;
    };
  };
}

export interface KpiFilters {
  from?: Date;
  to?: Date;
  provider?: string;
  model?: string;
  source?: string;
}

function toNumber(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** Null when nothing contributed, so "no data" never renders as 0. */
function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function rate(
  numerator: number,
  denominator: number,
  definition: string
): RateWithDenominator {
  return {
    value: denominator > 0 ? Number((numerator / denominator).toFixed(4)) : null,
    numerator,
    denominator,
    definition,
  };
}

function defaultRange(filters: KpiFilters): { from: Date; to: Date } {
  const to = filters.to ?? new Date();
  const from =
    filters.from ?? new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
  return { from, to };
}

export async function getAiUsageKpis(
  filters: KpiFilters = {}
): Promise<AiUsageKpis | null> {
  const prisma = getPrisma();
  if (!prisma) return null;

  const { from, to } = defaultRange(filters);

  const analysisWhere = {
    createdAt: { gte: from, lte: to },
  };

  const usageWhere = {
    createdAt: { gte: from, lte: to },
    ...(filters.provider ? { provider: filters.provider } : {}),
    ...(filters.model ? { model: filters.model } : {}),
    ...(filters.source ? { source: filters.source } : {}),
  };

  const [statusGroups, uniqueUserRows, anonymousCount, usageRows] =
    await Promise.all([
      prisma.analysis.groupBy({
        by: ["status"],
        where: analysisWhere,
        _count: { status: true },
      }),
      prisma.analysis.groupBy({
        by: ["userId"],
        where: { ...analysisWhere, userId: { not: null } },
        _count: { userId: true },
      }),
      prisma.analysis.count({
        where: { ...analysisWhere, userId: null },
      }),
      prisma.aiUsageEvent.findMany({
        where: usageWhere,
        select: {
          analysisId: true,
          provider: true,
          model: true,
          status: true,
          attemptIndex: true,
          latencyMs: true,
          inputTokens: true,
          outputTokens: true,
          totalTokens: true,
          reasoningTokens: true,
          cachedInputTokens: true,
          usageSource: true,
          reportedCostUsd: true,
          estimatedCostUsd: true,
          costSource: true,
        },
      }),
    ]);

  const statusMap = Object.fromEntries(
    statusGroups.map((row) => [row.status, row._count.status])
  );
  const requested = statusGroups.reduce(
    (sum, row) => sum + row._count.status,
    0
  );
  const completed = statusMap.completed ?? 0;
  const partial = statusMap.partial ?? 0;
  const failed = statusMap.failed ?? 0;
  const processing = statusMap.processing ?? 0;
  const terminal = completed + partial + failed;

  // --- Duration percentiles -------------------------------------------------
  const duration = await getDurationPercentiles(prisma, from, to);

  // --- Per-source audit counts ---------------------------------------------
  const bySource = await getAuditsBySource(prisma, from, to);

  // --- Provider/model aggregation ------------------------------------------
  const providerMap = new Map<string, ProviderModelUsage>();
  const auditProviders = new Map<string, Set<string>>();
  const auditAttemptCounts = new Map<string, number>();

  let totalAttempts = 0;
  let reportedTotal = 0;
  let reportedCostAttempts = 0;
  let estimatedTotal = 0;
  let estimatedCostAttempts = 0;
  let unknownCostAttempts = 0;
  let freeTierAttempts = 0;

  for (const row of usageRows) {
    totalAttempts += 1;

    const key = `${row.provider}::${row.model}`;
    let entry = providerMap.get(key);
    if (!entry) {
      entry = {
        provider: row.provider,
        model: row.model,
        attempts: 0,
        successes: 0,
        failures: 0,
        rateLimited: 0,
        timeouts: 0,
        invalidOutput: 0,
        reportRejected: 0,
        inputTokens: null,
        outputTokens: null,
        totalTokens: null,
        reasoningTokens: null,
        cachedInputTokens: null,
        tokensReported: 0,
        tokensUnavailable: 0,
        reportedCostUsd: null,
        reportedCostAttempts: 0,
        estimatedCostUsd: null,
        estimatedCostAttempts: 0,
        unknownCostAttempts: 0,
        freeTierAttempts: 0,
        avgLatencyMs: null,
      };
      providerMap.set(key, entry);
    }

    entry.attempts += 1;

    switch (row.status) {
      case "success":
        entry.successes += 1;
        break;
      case "rate_limited":
        entry.rateLimited += 1;
        entry.failures += 1;
        break;
      case "timeout":
        entry.timeouts += 1;
        entry.failures += 1;
        break;
      case "invalid_output":
        entry.invalidOutput += 1;
        entry.failures += 1;
        break;
      case "report_rejected":
        entry.reportRejected += 1;
        break;
      default:
        entry.failures += 1;
    }

    if (row.usageSource === "unavailable") {
      entry.tokensUnavailable += 1;
    } else {
      entry.tokensReported += 1;
      entry.inputTokens =
        (entry.inputTokens ?? 0) + toNumber(row.inputTokens);
      entry.outputTokens =
        (entry.outputTokens ?? 0) + toNumber(row.outputTokens);
      entry.totalTokens =
        (entry.totalTokens ?? 0) + toNumber(row.totalTokens);
      if (row.reasoningTokens !== null) {
        entry.reasoningTokens =
          (entry.reasoningTokens ?? 0) + toNumber(row.reasoningTokens);
      }
      if (row.cachedInputTokens !== null) {
        entry.cachedInputTokens =
          (entry.cachedInputTokens ?? 0) + toNumber(row.cachedInputTokens);
      }
    }

    // Latency accumulated in totalTokens-independent fashion.
    entry.avgLatencyMs =
      ((entry.avgLatencyMs ?? 0) * (entry.attempts - 1) +
        toNumber(row.latencyMs)) /
      entry.attempts;

    const reported = toNullableNumber(row.reportedCostUsd);
    const estimated = toNullableNumber(row.estimatedCostUsd);

    if (row.costSource === "provider_reported" && reported !== null) {
      entry.reportedCostUsd = (entry.reportedCostUsd ?? 0) + reported;
      entry.reportedCostAttempts += 1;
      reportedTotal += reported;
      reportedCostAttempts += 1;
    } else if (row.costSource === "estimated" && estimated !== null) {
      entry.estimatedCostUsd = (entry.estimatedCostUsd ?? 0) + estimated;
      entry.estimatedCostAttempts += 1;
      estimatedTotal += estimated;
      estimatedCostAttempts += 1;
    } else if (row.costSource === "free_tier") {
      entry.freeTierAttempts += 1;
      freeTierAttempts += 1;
    } else {
      entry.unknownCostAttempts += 1;
      unknownCostAttempts += 1;
    }

    if (row.analysisId) {
      const providers = auditProviders.get(row.analysisId) ?? new Set<string>();
      providers.add(row.provider);
      auditProviders.set(row.analysisId, providers);
      auditAttemptCounts.set(
        row.analysisId,
        (auditAttemptCounts.get(row.analysisId) ?? 0) + 1
      );
    }
  }

  const providers = [...providerMap.values()]
    .map((entry) => ({
      ...entry,
      avgLatencyMs:
        entry.avgLatencyMs === null ? null : Math.round(entry.avgLatencyMs),
      reportedCostUsd:
        entry.reportedCostUsd === null
          ? null
          : Number(entry.reportedCostUsd.toFixed(6)),
      estimatedCostUsd:
        entry.estimatedCostUsd === null
          ? null
          : Number(entry.estimatedCostUsd.toFixed(6)),
    }))
    .sort((a, b) => b.attempts - a.attempts);

  const auditsWithAttempts = auditAttemptCounts.size;
  const auditsWithFallback = [...auditProviders.values()].filter(
    (set) => set.size > 1
  ).length;
  const retryAttempts = [...auditAttemptCounts.values()].reduce(
    (sum, count) => sum + Math.max(0, count - 1),
    0
  );

  // --- Cost per delivered audit (includes its failed attempts) -------------
  const perCompletedAudit = await getCostPerDeliveredAudit(prisma, from, to);

  return {
    generatedAt: new Date().toISOString(),
    range: { from: from.toISOString(), to: to.toISOString() },
    pricing: { version: PRICING_VERSION, note: PRICING_SOURCE_NOTE },
    audits: {
      requested,
      completed,
      partial,
      failed,
      processing,
      completionRate: rate(
        completed,
        terminal,
        "completed / (completed + partial + failed). Runs still processing are excluded from the denominator."
      ),
      deliveryRate: rate(
        completed + partial,
        terminal,
        "(completed + partial) / (completed + partial + failed). A partial audit still delivered a report."
      ),
      uniqueUsers: uniqueUserRows.length,
      anonymousAudits: anonymousCount,
      bySource,
    },
    duration,
    providers,
    reliability: {
      auditsWithAttempts,
      auditsWithFallback,
      fallbackRate: rate(
        auditsWithFallback,
        auditsWithAttempts,
        "audits that used more than one provider / audits with at least one recorded provider attempt"
      ),
      totalAttempts,
      retryAttempts,
      attemptsPerAudit:
        auditsWithAttempts > 0
          ? Number((totalAttempts / auditsWithAttempts).toFixed(2))
          : null,
    },
    cost: {
      reportedTotalUsd:
        reportedCostAttempts > 0 ? Number(reportedTotal.toFixed(6)) : null,
      reportedCostAttempts,
      estimatedTotalUsd:
        estimatedCostAttempts > 0 ? Number(estimatedTotal.toFixed(6)) : null,
      estimatedCostAttempts,
      unknownCostAttempts,
      freeTierAttempts,
      perCompletedAudit,
    },
  };
}

/**
 * Median and p95 from Postgres, over terminal runs only.
 * Still-processing rows have no duration and must not skew the distribution.
 */
async function getDurationPercentiles(
  prisma: NonNullable<ReturnType<typeof getPrisma>>,
  from: Date,
  to: Date
): Promise<AiUsageKpis["duration"]> {
  const definition =
    "Wall-clock duration of runs that reached completed/partial/failed in the range. Runs still processing are excluded.";

  try {
    const rows = await prisma.$queryRaw<
      Array<{ median: number | null; p95: number | null; n: bigint }>
    >`
      SELECT
        percentile_cont(0.5) WITHIN GROUP (ORDER BY duration_ms)::float AS median,
        percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms)::float AS p95,
        COUNT(*) AS n
      FROM analyses
      WHERE duration_ms IS NOT NULL
        AND created_at >= ${from}
        AND created_at <= ${to}
    `;

    const row = rows[0];
    return {
      medianMs: row?.median === null ? null : Math.round(row?.median ?? 0),
      p95Ms: row?.p95 === null ? null : Math.round(row?.p95 ?? 0),
      sampleSize: Number(row?.n ?? 0),
      definition,
    };
  } catch (error) {
    console.error(
      "[Revel] duration_percentiles_failed",
      error instanceof Error ? error.message : error
    );
    return { medianMs: null, p95Ms: null, sampleSize: 0, definition };
  }
}

/**
 * Audit counts per source. Web and partner/API traffic are reported
 * separately; `source` comes from the activity context of the request.
 */
async function getAuditsBySource(
  prisma: NonNullable<ReturnType<typeof getPrisma>>,
  from: Date,
  to: Date
): Promise<AiUsageKpis["audits"]["bySource"]> {
  try {
    const rows = await prisma.$queryRaw<
      Array<{
        source: string | null;
        requested: bigint;
        completed: bigint;
        partial: bigint;
        failed: bigint;
      }>
    >`
      SELECT
        COALESCE(e.source, 'unknown') AS source,
        COUNT(*) AS requested,
        COUNT(*) FILTER (WHERE a.status = 'completed') AS completed,
        COUNT(*) FILTER (WHERE a.status = 'partial')   AS partial,
        COUNT(*) FILTER (WHERE a.status = 'failed')    AS failed
      FROM analyses a
      LEFT JOIN (
        SELECT DISTINCT ON (analysis_id) analysis_id, source
        FROM activity_events
        WHERE event_type = 'analysis_started' AND analysis_id IS NOT NULL
        ORDER BY analysis_id, created_at ASC
      ) e ON e.analysis_id = a.id
      WHERE a.created_at >= ${from} AND a.created_at <= ${to}
      GROUP BY COALESCE(e.source, 'unknown')
      ORDER BY requested DESC
    `;

    return rows.map((row) => ({
      source: row.source ?? "unknown",
      requested: Number(row.requested),
      completed: Number(row.completed),
      partial: Number(row.partial),
      failed: Number(row.failed),
    }));
  } catch (error) {
    console.error(
      "[Revel] audits_by_source_failed",
      error instanceof Error ? error.message : error
    );
    return [];
  }
}

/**
 * AI spend attributable to audits that DELIVERED a report in the range,
 * counting every attempt made for those audits — including the retries and
 * failed fallbacks that preceded the successful call.
 */
async function getCostPerDeliveredAudit(
  prisma: NonNullable<ReturnType<typeof getPrisma>>,
  from: Date,
  to: Date
): Promise<AiUsageKpis["cost"]["perCompletedAudit"]> {
  const definition =
    "Sum of every provider attempt (including retries and failed fallbacks) belonging to audits that reached completed or partial in this range, divided by the number of those audits. Blended average uses provider-reported cost where available and estimated cost otherwise; attempts with unknown cost are excluded from the numerator and counted separately.";

  try {
    const rows = await prisma.$queryRaw<
      Array<{
        audits: bigint;
        attempts: bigint;
        reported: number | null;
        estimated: number | null;
        blended: number | null;
        unknown_attempts: bigint;
      }>
    >`
      WITH delivered AS (
        SELECT id
        FROM analyses
        WHERE status IN ('completed', 'partial')
          AND created_at >= ${from}
          AND created_at <= ${to}
      )
      SELECT
        (SELECT COUNT(*) FROM delivered) AS audits,
        COUNT(u.id) AS attempts,
        SUM(u.reported_cost_usd) FILTER (WHERE u.cost_source = 'provider_reported')::float AS reported,
        SUM(u.estimated_cost_usd) FILTER (WHERE u.cost_source = 'estimated')::float AS estimated,
        SUM(
          COALESCE(
            CASE WHEN u.cost_source = 'provider_reported' THEN u.reported_cost_usd END,
            CASE WHEN u.cost_source = 'estimated'         THEN u.estimated_cost_usd END,
            CASE WHEN u.cost_source = 'free_tier'         THEN 0 END
          )
        )::float AS blended,
        COUNT(u.id) FILTER (WHERE u.cost_source = 'unknown') AS unknown_attempts
      FROM delivered d
      LEFT JOIN ai_usage_events u ON u.analysis_id = d.id
    `;

    const row = rows[0];
    const audits = Number(row?.audits ?? 0);
    const blended = toNullableNumber(row?.blended);

    return {
      auditsCounted: audits,
      attemptsCounted: Number(row?.attempts ?? 0),
      reportedTotalUsd: toNullableNumber(row?.reported),
      estimatedTotalUsd: toNullableNumber(row?.estimated),
      blendedAvgUsd:
        audits > 0 && blended !== null
          ? Number((blended / audits).toFixed(6))
          : null,
      unknownCostAttempts: Number(row?.unknown_attempts ?? 0),
      definition,
    };
  } catch (error) {
    console.error(
      "[Revel] cost_per_audit_failed",
      error instanceof Error ? error.message : error
    );
    return {
      auditsCounted: 0,
      attemptsCounted: 0,
      reportedTotalUsd: null,
      estimatedTotalUsd: null,
      blendedAvgUsd: null,
      unknownCostAttempts: 0,
      definition,
    };
  }
}

/** Per-audit usage view for drill-down. */
export async function getAuditUsageRows(
  filters: KpiFilters & { limit?: number } = {}
): Promise<AuditUsageRow[]> {
  const prisma = getPrisma();
  if (!prisma) return [];

  const { from, to } = defaultRange(filters);
  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);

  try {
    const rows = await prisma.$queryRaw<
      Array<{
        analysis_id: string;
        website: string | null;
        status: string;
        source: string | null;
        created_at: Date;
        duration_ms: number | null;
        attempts: bigint;
        providers: string[] | null;
        models: string[] | null;
        input_tokens: number | null;
        output_tokens: number | null;
        total_tokens: number | null;
        reasoning_tokens: number | null;
        reported_cost: number | null;
        estimated_cost: number | null;
        unknown_attempts: bigint;
      }>
    >`
      SELECT
        a.id AS analysis_id,
        a.website,
        a.status,
        e.source,
        a.created_at,
        a.duration_ms,
        COUNT(u.id) AS attempts,
        ARRAY_AGG(DISTINCT u.provider) FILTER (WHERE u.provider IS NOT NULL) AS providers,
        ARRAY_AGG(DISTINCT u.model)    FILTER (WHERE u.model IS NOT NULL)    AS models,
        SUM(u.input_tokens)::int     AS input_tokens,
        SUM(u.output_tokens)::int    AS output_tokens,
        SUM(u.total_tokens)::int     AS total_tokens,
        SUM(u.reasoning_tokens)::int AS reasoning_tokens,
        SUM(u.reported_cost_usd) FILTER (WHERE u.cost_source = 'provider_reported')::float AS reported_cost,
        SUM(u.estimated_cost_usd) FILTER (WHERE u.cost_source = 'estimated')::float        AS estimated_cost,
        COUNT(u.id) FILTER (WHERE u.cost_source = 'unknown') AS unknown_attempts
      FROM analyses a
      LEFT JOIN ai_usage_events u ON u.analysis_id = a.id
      LEFT JOIN (
        SELECT DISTINCT ON (analysis_id) analysis_id, source
        FROM activity_events
        WHERE event_type = 'analysis_started' AND analysis_id IS NOT NULL
        ORDER BY analysis_id, created_at ASC
      ) e ON e.analysis_id = a.id
      WHERE a.created_at >= ${from} AND a.created_at <= ${to}
      GROUP BY a.id, a.website, a.status, e.source, a.created_at, a.duration_ms
      ORDER BY a.created_at DESC
      LIMIT ${limit}
    `;

    return rows.map((row) => ({
      analysisId: row.analysis_id,
      website: row.website,
      status: row.status,
      source: row.source,
      createdAt: row.created_at?.toISOString() ?? new Date().toISOString(),
      durationMs: row.duration_ms,
      attempts: Number(row.attempts),
      providers: row.providers ?? [],
      models: row.models ?? [],
      inputTokens: toNullableNumber(row.input_tokens),
      outputTokens: toNullableNumber(row.output_tokens),
      totalTokens: toNullableNumber(row.total_tokens),
      reasoningTokens: toNullableNumber(row.reasoning_tokens),
      reportedCostUsd: toNullableNumber(row.reported_cost),
      estimatedCostUsd: toNullableNumber(row.estimated_cost),
      unknownCostAttempts: Number(row.unknown_attempts),
    }));
  } catch (error) {
    console.error(
      "[Revel] audit_usage_rows_failed",
      error instanceof Error ? error.message : error
    );
    return [];
  }
}
