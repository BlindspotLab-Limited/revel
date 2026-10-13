import { redirect } from "next/navigation";
import { AiUsageDashboardView } from "@/components/dashboard/ai-usage-dashboard";
import { getAiUsageKpis, getAuditUsageRows } from "@/lib/ai-usage/kpis";
import { getCurrentUserIsAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** Preset windows; `days` is clamped so a URL cannot request an unbounded scan. */
const PRESETS = [
  { days: 1, label: "24h" },
  { days: 7, label: "7d" },
  { days: 30, label: "30d" },
  { days: 90, label: "90d" },
];

export default async function AiUsagePage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string; provider?: string; source?: string }>;
}) {
  const isAdmin = await getCurrentUserIsAdmin();
  if (!isAdmin) {
    redirect("/mission-control");
  }

  const params = await searchParams;
  const requestedDays = Number(params.days ?? "30");
  const days =
    Number.isFinite(requestedDays) && requestedDays > 0
      ? Math.min(requestedDays, 365)
      : 30;

  const to = new Date();
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
  const filters = {
    from,
    to,
    provider: params.provider,
    source: params.source,
  };

  const [kpis, audits] = await Promise.all([
    getAiUsageKpis(filters),
    getAuditUsageRows({ ...filters, limit: 40 }),
  ]);

  return (
    <div className="max-w-6xl">
      <h1 className="font-heading text-3xl font-semibold">AI usage & cost</h1>
      <p className="mt-2 text-muted">
        Every provider attempt — including retries and failed fallbacks — with
        token and cost accounting.
      </p>

      <nav className="mt-6 flex flex-wrap gap-2" aria-label="Date range">
        {PRESETS.map((preset) => {
          const active = preset.days === days;
          return (
            <a
              key={preset.days}
              href={`/mission-control/ai-usage?days=${preset.days}${
                params.provider ? `&provider=${params.provider}` : ""
              }${params.source ? `&source=${params.source}` : ""}`}
              aria-current={active ? "page" : undefined}
              className={`rounded-md border px-3 py-1.5 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current ${
                active
                  ? "border-current bg-surface font-medium"
                  : "border-border text-muted hover:text-foreground"
              }`}
            >
              {preset.label}
            </a>
          );
        })}
      </nav>

      <div className="mt-8">
        {kpis ? (
          <AiUsageDashboardView data={kpis} audits={audits} />
        ) : (
          <p className="text-sm text-muted">
            AI usage analytics requires a configured database. Apply{" "}
            <code>prisma/migrations/20261013120000_ai_usage_events</code> (or{" "}
            <code>supabase/ai-usage-events.sql</code>), then refresh.
          </p>
        )}
      </div>
    </div>
  );
}
