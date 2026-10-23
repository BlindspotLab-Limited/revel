import type { ActivitySource } from "@/lib/activity-context";
import { getActivityContext } from "@/lib/activity-context";
import { getPrisma } from "@/lib/prisma";
import { runInBackground } from "@/lib/runtime/cloudflare";
import type { Prisma } from "@/lib/generated/prisma/client";

export type ActivityEventType =
  | "analysis_started"
  | "analysis_completed"
  | "analysis_failed"
  | "mcp_tool_call"
  | "export_completed";

export type RecordActivityInput = {
  eventType: ActivityEventType;
  source?: ActivitySource;
  userId?: string | null;
  toolName?: string;
  analysisId?: string;
  website?: string;
  status?: string;
  metadata?: Record<string, unknown>;
};

export async function recordActivity(input: RecordActivityInput): Promise<void> {
  const prisma = getPrisma();
  if (!prisma) return;

  const ctx = getActivityContext();

  try {
    await prisma.activityEvent.create({
      data: {
        eventType: input.eventType,
        source: input.source ?? ctx?.source ?? "website",
        userId: input.userId ?? ctx?.userId ?? null,
        toolName: input.toolName ?? null,
        analysisId: input.analysisId ?? null,
        website: input.website ?? null,
        status: input.status ?? null,
        metadata: input.metadata
          ? (input.metadata as Prisma.InputJsonValue)
          : ctx?.paid
            ? ({ paid: true } as Prisma.InputJsonValue)
            : undefined,
      },
    });
  } catch (error) {
    console.error(
      "[Revel] activity_event_failed",
      error instanceof Error ? error.message : error
    );
  }
}

export function trackActivity(input: RecordActivityInput): void {
  runInBackground(recordActivity(input));
}