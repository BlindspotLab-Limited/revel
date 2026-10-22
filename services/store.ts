import { isPrismaEnabled } from "@/lib/prisma";
import { isSupabaseEnabled } from "@/lib/supabase";
import type { Analysis } from "@/types/analysis";
import {
  deleteAnalysisFromFile,
  getAllAnalysesFromFile,
  getAnalysisFromFile,
  saveAnalysisToFile,
} from "./file-store";
import {
  deleteAnalysisFromPrisma,
  getAllAnalysesFromPrisma,
  getAnalysisFromPrisma,
  saveAnalysisToPrisma,
} from "./prisma-store";
import {
  deleteAnalysisFromSupabase,
  getAllAnalysesFromSupabase,
  getAnalysisFromSupabase,
  saveAnalysisToSupabase,
} from "./supabase-store";

function usePrisma(): boolean {
  // Direct Postgres (5432/6543) is often blocked on local networks.
  // Supabase JS over HTTPS works locally; Prisma (via Hyperdrive on
  // Cloudflare Workers) runs in production.
  if (process.env.USE_PRISMA_LOCAL === "true") {
    return isPrismaEnabled();
  }

  return isPrismaEnabled() && process.env.NODE_ENV === "production";
}

function useSupabase(): boolean {
  return isSupabaseEnabled();
}

/**
 * The local JSON file store is a development convenience only. Production
 * (Cloudflare Workers, or any `NODE_ENV=production` host) has no durable
 * local filesystem, so it must never silently fall back to it — a missing
 * database configuration surfaces as an error instead.
 */
function isLocalDevelopment(): boolean {
  return process.env.NODE_ENV !== "production";
}

/** Local JSON file fallback — development only. */
function useFileStore(): boolean {
  if (!isLocalDevelopment()) return false;
  return !usePrisma() && !useSupabase();
}

/** Mirror full analyses to disk locally so report JSON survives Supabase RLS/upsert gaps. */
function mirrorFileStore(): boolean {
  return isLocalDevelopment();
}

/**
 * An audit still "processing" after this long cannot finish any more: the
 * run budget is AUDIT_BUDGET_MS (≤ 280s) and the Cloudflare Workflow gives
 * up after one retry with a 10-minute step timeout. Anything older lost its
 * runner (deploy, isolate eviction, platform incident) and is closed out as
 * failed so polling clients get a terminal answer instead of waiting forever.
 */
const STALE_PROCESSING_MS = 30 * 60_000;

export const STALE_PROCESSING_ERROR =
  "Audit timed out before finishing. Please try again.";

async function reconcileStaleProcessing(analysis: Analysis): Promise<Analysis> {
  if (analysis.status !== "processing") return analysis;

  const startedAt = new Date(analysis.createdAt).getTime();
  if (!Number.isFinite(startedAt)) return analysis;

  const age = Date.now() - startedAt;
  if (age < STALE_PROCESSING_MS) return analysis;

  const failed: Analysis = {
    ...analysis,
    status: "failed",
    error: STALE_PROCESSING_ERROR,
    completedAt: new Date().toISOString(),
    durationMs: age,
  };

  try {
    await saveAnalysis(failed);
    console.error(
      JSON.stringify({
        level: "error",
        source: "revel",
        event: "analysis_failed",
        reason: "stale_processing",
        id: analysis.id,
        ageMs: age,
      })
    );
  } catch {
    // Still report the terminal state; the next read retries the write.
  }
  return failed;
}

export async function getAnalysis(id: string): Promise<Analysis | null> {
  const analysis = await readAnalysis(id);
  return analysis ? reconcileStaleProcessing(analysis) : null;
}

async function readAnalysis(id: string): Promise<Analysis | null> {
  const canMirror = mirrorFileStore();

  const [file, primary] = await Promise.all([
    canMirror || useFileStore()
      ? getAnalysisFromFile(id)
      : Promise.resolve(null),
    usePrisma()
      ? getAnalysisFromPrisma(id)
      : useSupabase()
        ? getAnalysisFromSupabase(id)
        : Promise.resolve(null),
  ]);

  if (!primary && !file) return null;
  if (!primary) return file;
  if (!file) return primary;

  const report = file.report ?? primary.report;
  const status = report
    ? "completed"
    : primary.status === "failed" || file.status === "failed"
      ? "failed"
      : (primary.status ?? file.status);

  return {
    ...primary,
    report,
    status,
    score: file.score ?? primary.score,
    error: primary.error ?? file.error,
  };
}

export async function getAllAnalyses(
  userId?: string | null
): Promise<Analysis[]> {
  if (usePrisma()) {
    return getAllAnalysesFromPrisma(userId);
  }

  let remote: Analysis[] = [];

  if (useSupabase()) {
    try {
      remote = await getAllAnalysesFromSupabase(userId);
    } catch {
      remote = [];
    }
  }

  if (mirrorFileStore()) {
    const local = await getAllAnalysesFromFile(userId);
    if (!remote.length) return local;

    const merged = new Map<string, Analysis>();
    for (const item of remote) merged.set(item.id, item);
    for (const item of local) {
      const existing = merged.get(item.id);
      if (!existing || (item.report && !existing.report)) {
        merged.set(item.id, { ...existing, ...item });
      }
    }
    return [...merged.values()].sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  if (remote.length > 0) return remote;

  return getAllAnalysesFromFile(userId);
}

export async function saveAnalysis(analysis: Analysis): Promise<void> {
  if (usePrisma()) {
    await saveAnalysisToPrisma(analysis);
    return;
  }

  const canMirror = mirrorFileStore();

  if (canMirror) {
    await saveAnalysisToFile(analysis);
  }

  if (useSupabase()) {
    try {
      await saveAnalysisToSupabase(analysis);
    } catch (error) {
      if (!canMirror) throw error;

      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `[Revel] Supabase save failed — kept local file mirror (${message})`
      );
    }
    return;
  }

  if (useFileStore()) {
    if (!canMirror) {
      await saveAnalysisToFile(analysis);
    }
    return;
  }

  throw new Error("No analysis storage is configured.");
}

export async function deleteAnalysis(
  id: string,
  userId?: string
): Promise<boolean> {
  if (userId) {
    const analysis = await getAnalysis(id);
    if (!analysis || analysis.userId !== userId) {
      return false;
    }
  }

  let deleted = false;

  if (usePrisma()) {
    deleted = await deleteAnalysisFromPrisma(id);
  } else if (useSupabase()) {
    deleted = await deleteAnalysisFromSupabase(id);
  }

  if (useFileStore()) {
    const fileDeleted = await deleteAnalysisFromFile(id);
    return deleted || fileDeleted;
  }

  return deleted;
}