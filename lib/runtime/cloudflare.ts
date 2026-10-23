import { getCloudflareContext } from "@opennextjs/cloudflare";

/**
 * Cloudflare Workers runtime access.
 *
 * Revel runs on Cloudflare Workers through the OpenNext adapter, and still
 * runs on plain Node.js for `next dev`, `next start`, tsx scripts and the
 * stdio MCP server. Everything Workers-specific goes through this module so
 * the rest of the codebase never touches `getCloudflareContext` directly and
 * keeps working in Node.
 */

/** Minimal binding shapes Revel relies on (no @cloudflare/workers-types dependency). */
export interface HyperdriveBinding {
  readonly connectionString: string;
}

export interface WorkflowInstanceHandle {
  readonly id: string;
}

export interface WorkflowBinding<Params> {
  create(options?: { id?: string; params?: Params }): Promise<WorkflowInstanceHandle>;
  get(id: string): Promise<WorkflowInstanceHandle>;
}

export interface ServiceBinding {
  fetch(input: Request | string | URL, init?: RequestInit): Promise<Response>;
}

/** Workers Rate Limiting API binding (wrangler.jsonc → ratelimits). */
export interface RateLimitBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface WaitUntilContext {
  waitUntil(promise: Promise<unknown>): void;
}

declare global {
  interface CloudflareEnv {
    /** Hyperdrive config pointing at the existing Supabase Postgres. */
    HYPERDRIVE?: HyperdriveBinding;
    /** Durable audit execution (cloudflare/audit-workflow.ts). */
    AUDIT_WORKFLOW?: WorkflowBinding<import("@/lib/audit/job").AuditJob>;
    /** 5 requests / 60s per key: audit starts and partner applications. */
    AUDIT_RATE_LIMITER?: RateLimitBinding;
    /** 30 requests / 60s per partner. */
    PARTNER_RATE_LIMITER?: RateLimitBinding;
  }
}

/**
 * True inside the Workers runtime (production, `wrangler dev`, preview).
 * `navigator.userAgent` is the documented runtime detection signal.
 */
export function isCloudflareWorkersRuntime(): boolean {
  return (
    typeof navigator !== "undefined" &&
    navigator.userAgent === "Cloudflare-Workers"
  );
}

type RequestScope = {
  env: CloudflareEnv;
  ctx: WaitUntilContext;
};

/**
 * The bindings and execution context of the current Workers request, or
 * null outside Workers / outside a request.
 */
export function getCloudflareRequestScope(): RequestScope | null {
  if (!isCloudflareWorkersRuntime()) return null;

  try {
    const { env, ctx } = getCloudflareContext();
    return { env, ctx: ctx as unknown as WaitUntilContext };
  } catch {
    return null;
  }
}

export function getCloudflareEnv(): CloudflareEnv | null {
  return getCloudflareRequestScope()?.env ?? null;
}

/**
 * Keep best-effort side work (activity events, emails, usage timestamps)
 * alive after the response is sent.
 *
 * On Workers, promises still pending when the response finishes are
 * cancelled unless registered with `ctx.waitUntil`. On Node.js the promise
 * simply runs to completion, as before. Never throws.
 */
export function runInBackground(task: Promise<unknown>): void {
  const guarded = task.catch((error) => {
    console.error(
      "[Revel] background_task_failed",
      error instanceof Error ? error.message : error
    );
  });

  const scope = getCloudflareRequestScope();
  if (scope) {
    scope.ctx.waitUntil(guarded);
  }
}
