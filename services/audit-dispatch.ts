import { after } from "next/server";
import { getActivityContext } from "@/lib/activity-context";
import type { AuditJob } from "@/lib/audit/job";
import { logServerError } from "@/lib/safe-client-error";
import {
  getCloudflareEnv,
  isCloudflareWorkersRuntime,
} from "@/lib/runtime/cloudflare";
import { markAnalysisFailed, runAnalysis } from "@/services/analysis-runner";

/**
 * Hand a freshly created "processing" analysis to background execution.
 *
 * - Cloudflare Workers: a durable Cloudflare Workflow instance whose id IS
 *   the analysis id. Workflows survive client disconnects and isolate
 *   restarts, retry with bounds, and refuse a second instance with the same
 *   id — so one analysis can never be executed twice by dispatch.
 * - Node.js (`next dev`, `next start`, stdio MCP): `after()` as before, or
 *   fire-and-forget outside a request scope.
 *
 * Throws when durable execution is unavailable on Workers, so the caller
 * fails the request instead of leaving a record stuck in "processing".
 */
export async function dispatchAnalysis(
  job: Omit<AuditJob, "activity">
): Promise<void> {
  const activity = getActivityContext();
  const fullJob: AuditJob = {
    ...job,
    activity: activity
      ? { source: activity.source, userId: activity.userId, paid: activity.paid }
      : undefined,
  };

  if (isCloudflareWorkersRuntime()) {
    await dispatchToWorkflow(fullJob);
    return;
  }

  const task = async () => {
    try {
      await runAnalysis(job.analysisId, job.website, job.userId);
    } catch (error) {
      await markAnalysisFailed(job.analysisId, error, {
        website: job.website,
        userId: job.userId,
      });
    }
  };

  try {
    after(task);
  } catch {
    void task();
  }
}

async function dispatchToWorkflow(job: AuditJob): Promise<void> {
  const workflow = getCloudflareEnv()?.AUDIT_WORKFLOW;
  if (!workflow) {
    const error = new Error(
      "Audit execution is unavailable: the AUDIT_WORKFLOW binding is not configured."
    );
    await markAnalysisFailed(job.analysisId, error, {
      website: job.website,
      userId: job.userId,
    });
    throw error;
  }

  try {
    await workflow.create({ id: job.analysisId, params: job });
  } catch (error) {
    // Same id already exists → this analysis was already dispatched.
    // Treat as success: running it again would duplicate provider spend.
    if (await workflowInstanceExists(job.analysisId)) {
      logServerError("audit_workflow_duplicate_dispatch", error, {
        analysisId: job.analysisId,
      });
      return;
    }

    await markAnalysisFailed(job.analysisId, error, {
      website: job.website,
      userId: job.userId,
    });
    throw error;
  }
}

async function workflowInstanceExists(id: string): Promise<boolean> {
  try {
    await getCloudflareEnv()?.AUDIT_WORKFLOW?.get(id);
    return true;
  } catch {
    return false;
  }
}
