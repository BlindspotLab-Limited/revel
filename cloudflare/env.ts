import type { AuditJob } from "../lib/audit/job";

/**
 * Bindings and secrets the custom Worker entry and the Workflow read
 * directly. The Next.js app reads its bindings through
 * lib/runtime/cloudflare.ts instead.
 */
export interface RevelWorkerEnv {
  WORKER_SELF_REFERENCE?: Fetcher;
  AUDIT_WORKFLOW?: Workflow<AuditJob>;
  HYPERDRIVE?: Hyperdrive;
  AUTH_SECRET?: string;
  NEXTAUTH_SECRET?: string;
  CRON_SECRET?: string;
  INDEXNOW_DISABLED?: string;
}
