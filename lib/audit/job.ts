import type { ActivitySource } from "@/lib/activity-context";

/**
 * Everything a background audit run needs, in a plain serializable shape so
 * it can be stored as Cloudflare Workflow params and replayed on retry.
 *
 * `activity` carries the request's activity context (source / user / paid)
 * across the hop into the durable run, so AI usage rows and activity events
 * keep the same attribution they had when the run lived inside `after()`.
 */
export interface AuditJob {
  analysisId: string;
  website: string;
  userId?: string | null;
  activity?: {
    source: ActivitySource;
    userId?: string | null;
    paid?: boolean;
  };
}

const ACTIVITY_SOURCES: ReadonlySet<string> = new Set<ActivitySource>([
  "website",
  "mcp_okx",
  "mcp_dev",
  "api_audit",
  "partner_api",
]);

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Parse untrusted JSON into an AuditJob, or null when it is malformed. */
export function parseAuditJob(value: unknown): AuditJob | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;

  if (typeof raw.analysisId !== "string" || !UUID_PATTERN.test(raw.analysisId)) {
    return null;
  }
  if (typeof raw.website !== "string" || raw.website.length === 0) {
    return null;
  }

  const userId =
    typeof raw.userId === "string" && raw.userId.length > 0 ? raw.userId : null;

  let activity: AuditJob["activity"];
  if (raw.activity && typeof raw.activity === "object") {
    const a = raw.activity as Record<string, unknown>;
    if (typeof a.source === "string" && ACTIVITY_SOURCES.has(a.source)) {
      activity = {
        source: a.source as ActivitySource,
        userId: typeof a.userId === "string" ? a.userId : null,
        paid: a.paid === true,
      };
    }
  }

  return { analysisId: raw.analysisId, website: raw.website, userId, activity };
}
