import { NextResponse } from "next/server";
import { getAiUsageKpis, getAuditUsageRows } from "@/lib/ai-usage/kpis";
import { getCurrentUserIsAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** Reject obviously bad dates rather than silently widening the window. */
function parseDate(value: string | null): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export async function GET(request: Request) {
  // Authorisation is enforced server-side on every request; the client never
  // decides whether these numbers may be read.
  const isAdmin = await getCurrentUserIsAdmin();
  if (!isAdmin) {
    return NextResponse.json(
      { error: "Admin access required" },
      { status: 403 }
    );
  }

  const url = new URL(request.url);
  const filters = {
    from: parseDate(url.searchParams.get("from")),
    to: parseDate(url.searchParams.get("to")),
    provider: url.searchParams.get("provider") ?? undefined,
    model: url.searchParams.get("model") ?? undefined,
    source: url.searchParams.get("source") ?? undefined,
  };

  const kpis = await getAiUsageKpis(filters);
  if (!kpis) {
    return NextResponse.json(
      { error: "AI usage analytics unavailable. Database is not configured." },
      { status: 503 }
    );
  }

  const includeAudits = url.searchParams.get("audits") === "1";
  const audits = includeAudits
    ? await getAuditUsageRows({
        ...filters,
        limit: Number(url.searchParams.get("limit") ?? "50"),
      })
    : undefined;

  return NextResponse.json({ ...kpis, ...(audits ? { audits } : {}) });
}
