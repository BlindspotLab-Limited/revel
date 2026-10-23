import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import type { AuditJob } from "../lib/audit/job";
import {
  AUDIT_RUN_TOKEN_HEADER,
  signAuditRunToken,
  type AuditRunOperation,
} from "../lib/audit/internal-token";
import type { RevelWorkerEnv } from "./env";

/**
 * Durable audit execution (replaces Vercel's `after()`).
 *
 * One Workflow instance per analysis; the instance id is the analysis id.
 * The step calls back into this same Worker over the WORKER_SELF_REFERENCE
 * service binding (`POST /api/internal/audit-run`), so the audit runs inside
 * the normal Next.js runtime with the unchanged analysis engine, provider
 * cascade (NVIDIA → Groq → OpenRouter → Gemini), evidence verification,
 * report normalisation and per-attempt AI usage accounting.
 *
 * Guarantees:
 * - Survives client disconnects: nothing here depends on the original request.
 * - Bounded: one retry of the run step, an explicit step timeout, and a
 *   final "mark failed" step so an audit always reaches a terminal state.
 * - No duplicate work: the endpoint skips analyses already in a terminal
 *   state, and Workflows reject a second instance with the same id.
 * - No billing side effects: credits and x402 payments are settled before
 *   dispatch and are never touched by this Workflow.
 */

/** Must exceed AUDIT_BUDGET_MS (max 280s) plus fetch/persist overhead. */
const RUN_STEP_TIMEOUT = "10 minutes";

/** Internal origin for self-calls; never resolved over the network. */
const INTERNAL_ORIGIN = "https://revel-audit.internal";

type RunResult = { analysisId: string; status: string; skipped?: boolean };

export class AuditWorkflow extends WorkflowEntrypoint<RevelWorkerEnv, AuditJob> {
  async run(event: WorkflowEvent<AuditJob>, step: WorkflowStep) {
    const job = event.payload;

    try {
      return await step.do(
        "run-audit",
        {
          retries: { limit: 1, delay: "30 seconds", backoff: "constant" },
          timeout: RUN_STEP_TIMEOUT,
        },
        () => this.callApp(job, "run")
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.error(
        JSON.stringify({
          level: "error",
          source: "revel",
          scope: "audit_workflow_run_failed",
          analysisId: job.analysisId,
          error: reason.slice(0, 500),
        })
      );

      return await step.do(
        "mark-failed",
        {
          retries: { limit: 3, delay: "10 seconds", backoff: "exponential" },
          timeout: "1 minute",
        },
        () => this.callApp(job, "fail", "Audit execution failed after retries")
      );
    }
  }

  private async callApp(
    job: AuditJob,
    op: AuditRunOperation,
    reason?: string
  ): Promise<RunResult> {
    const secret = this.env.AUTH_SECRET ?? this.env.NEXTAUTH_SECRET;
    if (!secret) {
      throw new NonRetryableError("AUTH_SECRET is not configured");
    }
    if (!this.env.WORKER_SELF_REFERENCE) {
      throw new NonRetryableError("WORKER_SELF_REFERENCE binding is missing");
    }

    const token = await signAuditRunToken(secret, job.analysisId, op);
    const response = await this.env.WORKER_SELF_REFERENCE.fetch(
      `${INTERNAL_ORIGIN}/api/internal/audit-run?op=${op}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          [AUDIT_RUN_TOKEN_HEADER]: token,
        },
        body: JSON.stringify(reason ? { ...job, reason } : job),
      }
    );

    const text = await response.text();

    if (response.ok) {
      return JSON.parse(text) as RunResult;
    }

    const detail = `audit-run ${op} → HTTP ${response.status}: ${text.slice(0, 300)}`;
    if (response.status >= 400 && response.status < 500) {
      throw new NonRetryableError(detail);
    }
    throw new Error(detail);
  }
}
