import type { AiUsageKpis, AuditUsageRow } from "@/lib/ai-usage/kpis";
import { Card, CardContent, CardTitle } from "@/components/ui/card";

/**
 * Admin AI-usage view.
 *
 * Presentation rules mirror the accounting rules: provider-reported cost and
 * estimated cost are shown as separate figures (never summed), and anything we
 * cannot price renders as "unknown" rather than as 0.
 */

const UNKNOWN = "unknown";

function formatInt(value: number | null | undefined): string {
  if (value === null || value === undefined) return UNKNOWN;
  return value.toLocaleString();
}

function formatUsd(value: number | null | undefined): string {
  if (value === null || value === undefined) return UNKNOWN;
  if (value === 0) return "$0.00";
  return value < 0.01 ? `$${value.toFixed(6)}` : `$${value.toFixed(4)}`;
}

function formatMs(value: number | null | undefined): string {
  if (value === null || value === undefined) return UNKNOWN;
  if (value < 1000) return `${value} ms`;
  return `${(value / 1000).toFixed(1)}s`;
}

function formatRate(value: number | null): string {
  if (value === null) return UNKNOWN;
  return `${(value * 100).toFixed(1)}%`;
}

function formatSource(source: string): string {
  const labels: Record<string, string> = {
    website: "Mission Control (web)",
    mcp_okx: "OKX MCP",
    mcp_dev: "MCP (dev key)",
    api_audit: "Paid API",
    partner_api: "Partner API",
    unknown: "Unattributed",
  };
  return labels[source] ?? source;
}

function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <Card>
      <CardContent className="pt-0">
        <p className="text-xs font-medium uppercase tracking-wide text-muted">
          {label}
        </p>
        <p className="mt-2 font-heading text-3xl font-semibold tabular-nums">
          {value}
        </p>
        {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
      </CardContent>
    </Card>
  );
}

export function AiUsageDashboardView({
  data,
  audits,
}: {
  data: AiUsageKpis;
  audits?: AuditUsageRow[];
}) {
  const { audits: auditKpis, duration, providers, reliability, cost } = data;

  return (
    <div className="space-y-8">
      <p className="text-sm text-muted">
        {new Date(data.range.from).toLocaleDateString()} –{" "}
        {new Date(data.range.to).toLocaleDateString()} · generated{" "}
        {new Date(data.generatedAt).toLocaleString()}
      </p>

      {/* ---------------- Audit throughput ---------------- */}
      <section>
        <h2 className="font-heading text-xl font-semibold">Audit throughput</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Requested"
            value={formatInt(auditKpis.requested)}
            hint={`${formatInt(auditKpis.processing)} still processing`}
          />
          <StatCard
            label="Completed"
            value={formatInt(auditKpis.completed)}
            hint={`${formatInt(auditKpis.partial)} partial · ${formatInt(auditKpis.failed)} failed`}
          />
          <StatCard
            label="Completion rate"
            value={formatRate(auditKpis.completionRate.value)}
            hint={`${auditKpis.completionRate.numerator} / ${auditKpis.completionRate.denominator} terminal runs`}
          />
          <StatCard
            label="Delivery rate"
            value={formatRate(auditKpis.deliveryRate.value)}
            hint="completed + partial"
          />
        </div>
        <p className="mt-3 text-xs text-muted">
          Completion rate denominator: {auditKpis.completionRate.definition}
        </p>
      </section>

      {/* ---------------- Users and duration ---------------- */}
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Unique auditing users"
          value={formatInt(auditKpis.uniqueUsers)}
          hint={`${formatInt(auditKpis.anonymousAudits)} anonymous audits`}
        />
        <StatCard
          label="Median duration"
          value={formatMs(duration.medianMs)}
          hint={`n = ${duration.sampleSize}`}
        />
        <StatCard
          label="p95 duration"
          value={formatMs(duration.p95Ms)}
          hint="terminal runs only"
        />
        <StatCard
          label="Provider fallback rate"
          value={formatRate(reliability.fallbackRate.value)}
          hint={`${reliability.auditsWithFallback} / ${reliability.auditsWithAttempts} audits used >1 provider`}
        />
      </section>

      {/* ---------------- Cost ---------------- */}
      <section>
        <h2 className="font-heading text-xl font-semibold">AI cost</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Provider-reported"
            value={formatUsd(cost.reportedTotalUsd)}
            hint={`${cost.reportedCostAttempts} attempts billed by provider`}
          />
          <StatCard
            label="Estimated (our pricing)"
            value={formatUsd(cost.estimatedTotalUsd)}
            hint={`${cost.estimatedCostAttempts} attempts · pricing ${data.pricing.version}`}
          />
          <StatCard
            label="Unpriced attempts"
            value={formatInt(cost.unknownCostAttempts)}
            hint={`${cost.freeTierAttempts} free-tier calls (distinct from unpriced)`}
          />
          <StatCard
            label="Avg per delivered audit"
            value={formatUsd(cost.perCompletedAudit.blendedAvgUsd)}
            hint={`${cost.perCompletedAudit.attemptsCounted} attempts across ${cost.perCompletedAudit.auditsCounted} audits`}
          />
        </div>
        <p className="mt-3 text-xs text-muted">
          Reported and estimated cost are separate totals and are never summed.
          Estimated cost is labelled and derived from pricing version{" "}
          {data.pricing.version}. {data.pricing.note}
        </p>
        <p className="mt-2 text-xs text-muted">
          Avg per delivered audit: {cost.perCompletedAudit.definition}
        </p>
      </section>

      {/* ---------------- Provider / model breakdown ---------------- */}
      <section>
        <Card>
          <CardContent className="pt-0">
            <CardTitle>Provider and model usage</CardTitle>
            {providers.length === 0 ? (
              <p className="mt-4 text-sm text-muted">
                No provider attempts recorded in this range.
              </p>
            ) : (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[1000px] text-left text-sm">
                  <thead className="text-xs uppercase tracking-wide text-muted">
                    <tr>
                      <th className="pb-2 pr-4">Provider / model</th>
                      <th className="pb-2 pr-4 text-right">Attempts</th>
                      <th className="pb-2 pr-4 text-right">OK</th>
                      <th className="pb-2 pr-4 text-right">Fail</th>
                      <th className="pb-2 pr-4 text-right">429</th>
                      <th className="pb-2 pr-4 text-right">Rejected</th>
                      <th className="pb-2 pr-4 text-right">In tok</th>
                      <th className="pb-2 pr-4 text-right">Out tok</th>
                      <th className="pb-2 pr-4 text-right">Reasoning</th>
                      <th className="pb-2 pr-4 text-right">Cached</th>
                      <th className="pb-2 pr-4 text-right">Reported $</th>
                      <th className="pb-2 pr-4 text-right">Est $</th>
                      <th className="pb-2 pr-4 text-right">Avg ms</th>
                    </tr>
                  </thead>
                  <tbody className="tabular-nums">
                    {providers.map((row) => (
                      <tr
                        key={`${row.provider}-${row.model}`}
                        className="border-t border-border"
                      >
                        <td className="py-2 pr-4">
                          <span className="font-medium">{row.provider}</span>
                          <span className="block text-xs text-muted">
                            {row.model}
                          </span>
                        </td>
                        <td className="py-2 pr-4 text-right">{row.attempts}</td>
                        <td className="py-2 pr-4 text-right">{row.successes}</td>
                        <td className="py-2 pr-4 text-right">{row.failures}</td>
                        <td className="py-2 pr-4 text-right">
                          {row.rateLimited}
                        </td>
                        <td className="py-2 pr-4 text-right">
                          {row.reportRejected}
                        </td>
                        <td className="py-2 pr-4 text-right">
                          {formatInt(row.inputTokens)}
                        </td>
                        <td className="py-2 pr-4 text-right">
                          {formatInt(row.outputTokens)}
                        </td>
                        <td className="py-2 pr-4 text-right">
                          {formatInt(row.reasoningTokens)}
                        </td>
                        <td className="py-2 pr-4 text-right">
                          {formatInt(row.cachedInputTokens)}
                        </td>
                        <td className="py-2 pr-4 text-right">
                          {formatUsd(row.reportedCostUsd)}
                        </td>
                        <td className="py-2 pr-4 text-right">
                          {formatUsd(row.estimatedCostUsd)}
                        </td>
                        <td className="py-2 pr-4 text-right">
                          {formatInt(row.avgLatencyMs)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="mt-3 text-xs text-muted">
              Reasoning tokens are reported as returned by the provider. Where
              they are already included in completion tokens they are not
              charged twice.
            </p>
          </CardContent>
        </Card>
      </section>

      {/* ---------------- Web vs partner split ---------------- */}
      <section>
        <Card>
          <CardContent className="pt-0">
            <CardTitle>Audits by source</CardTitle>
            {auditKpis.bySource.length === 0 ? (
              <p className="mt-4 text-sm text-muted">No audits in this range.</p>
            ) : (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[520px] text-left text-sm">
                  <thead className="text-xs uppercase tracking-wide text-muted">
                    <tr>
                      <th className="pb-2 pr-4">Source</th>
                      <th className="pb-2 pr-4 text-right">Requested</th>
                      <th className="pb-2 pr-4 text-right">Completed</th>
                      <th className="pb-2 pr-4 text-right">Partial</th>
                      <th className="pb-2 pr-4 text-right">Failed</th>
                    </tr>
                  </thead>
                  <tbody className="tabular-nums">
                    {auditKpis.bySource.map((row) => (
                      <tr key={row.source} className="border-t border-border">
                        <td className="py-2 pr-4">{formatSource(row.source)}</td>
                        <td className="py-2 pr-4 text-right">{row.requested}</td>
                        <td className="py-2 pr-4 text-right">{row.completed}</td>
                        <td className="py-2 pr-4 text-right">{row.partial}</td>
                        <td className="py-2 pr-4 text-right">{row.failed}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      {/* ---------------- Per-audit drill-down ---------------- */}
      {audits && audits.length > 0 ? (
        <section>
          <Card>
            <CardContent className="pt-0">
              <CardTitle>Recent audits — usage detail</CardTitle>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[900px] text-left text-sm">
                  <thead className="text-xs uppercase tracking-wide text-muted">
                    <tr>
                      <th className="pb-2 pr-4">Website</th>
                      <th className="pb-2 pr-4">Status</th>
                      <th className="pb-2 pr-4">Source</th>
                      <th className="pb-2 pr-4 text-right">Duration</th>
                      <th className="pb-2 pr-4 text-right">Attempts</th>
                      <th className="pb-2 pr-4">Providers</th>
                      <th className="pb-2 pr-4 text-right">Total tok</th>
                      <th className="pb-2 pr-4 text-right">Reported $</th>
                      <th className="pb-2 pr-4 text-right">Est $</th>
                    </tr>
                  </thead>
                  <tbody className="tabular-nums">
                    {audits.map((row) => (
                      <tr
                        key={row.analysisId}
                        className="border-t border-border"
                      >
                        <td className="py-2 pr-4 max-w-[220px] truncate">
                          {row.website ?? UNKNOWN}
                        </td>
                        <td className="py-2 pr-4">{row.status}</td>
                        <td className="py-2 pr-4">
                          {formatSource(row.source ?? "unknown")}
                        </td>
                        <td className="py-2 pr-4 text-right">
                          {formatMs(row.durationMs)}
                        </td>
                        <td className="py-2 pr-4 text-right">{row.attempts}</td>
                        <td className="py-2 pr-4">
                          {row.providers.length > 0
                            ? row.providers.join(", ")
                            : UNKNOWN}
                        </td>
                        <td className="py-2 pr-4 text-right">
                          {formatInt(row.totalTokens)}
                        </td>
                        <td className="py-2 pr-4 text-right">
                          {formatUsd(row.reportedCostUsd)}
                        </td>
                        <td className="py-2 pr-4 text-right">
                          {formatUsd(row.estimatedCostUsd)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </section>
      ) : null}
    </div>
  );
}
