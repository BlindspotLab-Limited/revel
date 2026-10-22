import { NextResponse } from "next/server";
import { getCurrentUserIsAdmin } from "@/lib/auth";
import {
  getAgentProvider,
  getAnalysisMode,
  getAgentMaxSteps,
  getGeminiModel,
  getGeminiModels,
  getGroqModel,
  getGroqModels,
  isGeminiAgentEnabled,
  isGroqAgentEnabled,
} from "@/lib/analysis-provider";
import {
  getActiveStorageBackend,
  getExportCapabilities,
} from "@/lib/mission-control-config";
import {
  getDatabaseConnectionKind,
  getPrisma,
  isPrismaEnabled,
} from "@/lib/prisma";
import {
  getCloudflareEnv,
  isCloudflareWorkersRuntime,
} from "@/lib/runtime/cloudflare";
import { isSupabaseEnabled } from "@/lib/supabase";

async function checkAnalysisTables(): Promise<{
  analyses: boolean;
  reports: boolean;
}> {
  const prisma = getPrisma();
  if (!prisma) {
    return { analyses: false, reports: false };
  }

  try {
    const rows = await prisma.$queryRaw<{ table_name: string }[]>`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('analyses', 'reports')
    `;
    const names = new Set(rows.map((row) => row.table_name));
    return {
      analyses: names.has("analyses"),
      reports: names.has("reports"),
    };
  } catch {
    return { analyses: false, reports: false };
  }
}

export async function GET() {
  const storage = getActiveStorageBackend();
  // On Workers audits need the durable Workflow binding to run at all.
  const auditExecutionReady =
    !isCloudflareWorkersRuntime() || Boolean(getCloudflareEnv()?.AUDIT_WORKFLOW);
  const tables =
    storage === "prisma" ? await checkAnalysisTables() : { analyses: null, reports: null };

  const schemaReady =
    storage !== "prisma" ||
    (tables.analyses === true && tables.reports === true);

  const isAdmin = await getCurrentUserIsAdmin();
  if (process.env.NODE_ENV === "production" && !isAdmin) {
    return NextResponse.json({
      ok: storage !== "none" && schemaReady && auditExecutionReady,
    });
  }

  return NextResponse.json({
    ok: storage !== "none" && schemaReady && auditExecutionReady,
    storage,
    schemaReady,
    tables,
    analysis_mode: getAnalysisMode(),
    analysis_provider: getAgentProvider(),
    groq: isGroqAgentEnabled(),
    groq_model: getGroqModel(),
    groq_models: getGroqModels(),
    groq_model_fallback: process.env.GROQ_MODEL_FALLBACK ?? null,
    gemini: isGeminiAgentEnabled(),
    gemini_model: getGeminiModel(),
    gemini_models: getGeminiModels(),
    gemini_model_fallback: process.env.GEMINI_MODEL_FALLBACK ?? null,
    agent_max_steps: getAgentMaxSteps(),
    openrouter: Boolean(process.env.OPENROUTER_API_KEY),
    openrouter_model: process.env.OPENROUTER_MODEL ?? "google/gemini-2.5-flash",
    openrouter_fallbacks: process.env.OPENROUTER_MODEL_FALLBACK ?? null,
    database: isPrismaEnabled(),
    supabase: isSupabaseEnabled(),
    runtime: isCloudflareWorkersRuntime() ? "cloudflare-workers" : "nodejs",
    database_connection: getDatabaseConnectionKind(),
    audit_workflow: isCloudflareWorkersRuntime()
      ? Boolean(getCloudflareEnv()?.AUDIT_WORKFLOW)
      : null,
    exports: getExportCapabilities(),
    migrateHint:
      storage === "prisma" && !schemaReady
        ? "Run supabase/schema.sql in the Supabase SQL Editor, or npm run db:schema (local 5432 often blocked — use the dashboard)."
        : null,
  });
}