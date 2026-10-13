import { getPrisma } from "@/lib/prisma";
import { normalizeAnalysisReport } from "@/lib/report-schema";
import type { Analysis, AnalysisReport } from "@/types/analysis";
import type { Prisma } from "@/lib/generated/prisma/client";

function toAnalysis(
  row: {
    id: string;
    userId: string | null;
    website: string;
    status: string;
    score: number | null;
    error: string | null;
    createdAt: Date | null;
    completedAt?: Date | null;
    durationMs?: number | null;
    report?: { jsonResult: Prisma.JsonValue } | null;
  }
): Analysis {
  const raw = row.report?.jsonResult;
  const report =
    raw && typeof raw === "object"
      ? normalizeAnalysisReport(raw)
      : undefined;

  return {
    id: row.id,
    userId: row.userId ?? undefined,
    website: row.website,
    status: row.status as Analysis["status"],
    score: report?.score ?? row.score ?? undefined,
    createdAt: row.createdAt?.toISOString() ?? new Date().toISOString(),
    completedAt: row.completedAt?.toISOString() ?? undefined,
    durationMs: row.durationMs ?? undefined,
    report,
    error: row.error ?? undefined,
  };
}

export async function getAnalysisFromPrisma(
  id: string
): Promise<Analysis | null> {
  const prisma = getPrisma();
  if (!prisma) return null;

  const row = await prisma.analysis.findUnique({
    where: { id },
    include: { report: true },
  });

  if (!row) return null;
  return toAnalysis(row);
}

export async function getAllAnalysesFromPrisma(
  userId?: string | null
): Promise<Analysis[]> {
  const prisma = getPrisma();
  if (!prisma) return [];

  const rows = await prisma.analysis.findMany({
    where: userId ? { userId } : undefined,
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      userId: true,
      website: true,
      status: true,
      score: true,
      error: true,
      createdAt: true,
      completedAt: true,
      durationMs: true,
    },
  });

  return rows.map((row) => toAnalysis(row));
}

export async function saveAnalysisToPrisma(
  analysis: Analysis
): Promise<void> {
  const prisma = getPrisma();
  if (!prisma) {
    throw new Error("Database is not configured for analysis storage");
  }

  if (analysis.userId) {
    await prisma.user.upsert({
      where: { id: analysis.userId },
      create: { id: analysis.userId },
      update: {},
    });
  }

  await prisma.analysis.upsert({
    where: { id: analysis.id },
    create: {
      id: analysis.id,
      userId: analysis.userId ?? null,
      website: analysis.website,
      status: analysis.status,
      score: analysis.score ?? null,
      error: analysis.error ?? null,
      createdAt: analysis.createdAt
        ? new Date(analysis.createdAt)
        : undefined,
      completedAt: analysis.completedAt
        ? new Date(analysis.completedAt)
        : null,
      durationMs: analysis.durationMs ?? null,
    },
    update: {
      userId: analysis.userId ?? null,
      website: analysis.website,
      status: analysis.status,
      score: analysis.score ?? null,
      error: analysis.error ?? null,
      completedAt: analysis.completedAt
        ? new Date(analysis.completedAt)
        : null,
      durationMs: analysis.durationMs ?? null,
    },
  });

  if (analysis.report) {
    await prisma.report.upsert({
      where: { analysisId: analysis.id },
      create: {
        analysisId: analysis.id,
        jsonResult: analysis.report as unknown as Prisma.InputJsonValue,
      },
      update: {
        jsonResult: analysis.report as unknown as Prisma.InputJsonValue,
      },
    });
  }
}

export async function deleteAnalysisFromPrisma(
  id: string
): Promise<boolean> {
  const prisma = getPrisma();
  if (!prisma) return false;

  try {
    await prisma.analysis.delete({ where: { id } });
    return true;
  } catch {
    return false;
  }
}