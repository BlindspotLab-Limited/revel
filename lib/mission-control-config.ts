import { isPrismaEnabled } from "@/lib/prisma";

export type ExportFormat =
  | "markdown"
  | "json"
  | "github"
  | "linear"
  | "notion";

export function getActiveStorageBackend():
  | "prisma"
  | "supabase"
  | "file"
  | "none" {
  // Hyperdrive on Cloudflare Workers; DATABASE_URL + DIRECT_URL on Node.
  const prismaEnabled = isPrismaEnabled();

  if (prismaEnabled && process.env.NODE_ENV === "production") {
    return "prisma";
  }

  if (process.env.SUPABASE_URL) {
    return "supabase";
  }

  // No local JSON store in production (see services/store.ts).
  if (process.env.NODE_ENV === "production") {
    return "none";
  }

  return prismaEnabled || process.env.SUPABASE_URL ? "supabase" : "file";
}

/**
 * Server-level export feature availability.
 * Cloud exports (Linear / Notion / Gist) require per-user OAuth — capability
 * is refined per session in GET /api/export.
 */
export function getExportCapabilities() {
  return {
    markdown: true,
    json: true,
    github: true,
    /** Enabled when user has connected Linear (checked at request time). */
    linear: true,
    notion: true,
    githubGist: true,
  };
}
