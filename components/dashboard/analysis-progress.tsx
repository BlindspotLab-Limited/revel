"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  Check,
  Loader2,
  Map,
  MessageSquare,
  MousePointerClick,
  Package,
  Users,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

const stages: { id: string; label: string; icon: LucideIcon }[] = [
  { id: "product", label: "Product Analysis", icon: Package },
  { id: "ux", label: "UX Review", icon: MousePointerClick },
  { id: "messaging", label: "Messaging Review", icon: MessageSquare },
  { id: "competitors", label: "Competitor Review", icon: Users },
  { id: "blueprint", label: "Generating Blueprint", icon: Map },
];

/** Reach blueprint stage ~60s in — real runs often take 1–3 min on slow networks. */
const STAGE_INTERVAL_MS = 15_000;
const LONG_WAIT_HINT_MS = 90_000;

interface AnalysisProgressProps {
  analysisId: string;
}

export function AnalysisProgress({ analysisId }: AnalysisProgressProps) {
  const [completedStages, setCompletedStages] = useState(0);
  const [status, setStatus] = useState<"processing" | "completed" | "failed">(
    "processing"
  );
  const [failureReason, setFailureReason] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const router = useRouter();

  const onBlueprint =
    completedStages === stages.length - 1 && status === "processing";
  const showLongWaitHint = onBlueprint && elapsedMs >= LONG_WAIT_HINT_MS;

  useEffect(() => {
    const startedAt = Date.now();
    const elapsedInterval = setInterval(() => {
      setElapsedMs(Date.now() - startedAt);
    }, 1000);

    const stageInterval = setInterval(() => {
      setCompletedStages((prev) => {
        if (prev < stages.length - 1) return prev + 1;
        return prev;
      });
    }, STAGE_INTERVAL_MS);

    const pollInterval = setInterval(async () => {
      try {
        const res = await fetch(`/api/report/${analysisId}`);
        const data = await res.json();

        // A partial report (fewer pages than target, or some fetch
        // failures) is still a real, deliverable result — saveAnalysis()
        // always persists a report alongside status "partial"
        // (services/analysis-runner.ts). The report page renders
        // coverage/limitations from the report data itself, not from this
        // status, so a partial result needs no special handling here:
        // redirect exactly as for "completed". Previously there was no
        // branch for "partial" at all, so it matched none of the three
        // conditions below and polled forever, silently discarding a
        // finished, usable report.
        if (
          (data.status === "completed" || data.status === "partial") &&
          data.report
        ) {
          setCompletedStages(stages.length);
          setStatus("completed");
          clearInterval(elapsedInterval);
          clearInterval(stageInterval);
          clearInterval(pollInterval);
          setTimeout(() => {
            router.push(`/mission-control/report/${analysisId}`);
          }, 600);
        } else if (
          (data.status === "completed" || data.status === "partial") &&
          !data.report
        ) {
          setStatus("failed");
          setFailureReason(
            "Analysis finished but the report could not be loaded. Please try again."
          );
          clearInterval(elapsedInterval);
          clearInterval(stageInterval);
          clearInterval(pollInterval);
        } else if (data.status === "failed") {
          setStatus("failed");
          setFailureReason(
            typeof data.error === "string"
              ? data.error
              : "Analysis failed unexpectedly"
          );
          clearInterval(elapsedInterval);
          clearInterval(stageInterval);
          clearInterval(pollInterval);
        }
      } catch {
        // continue polling
      }
    }, 2000);

    return () => {
      clearInterval(elapsedInterval);
      clearInterval(stageInterval);
      clearInterval(pollInterval);
    };
  }, [analysisId, router]);

  if (status === "failed") {
    return (
      <div className="rounded-xl border border-border bg-surface p-8 text-center">
        <p className="text-lg">
          We couldn&apos;t analyze this website right now.
        </p>
        <p className="mt-2 text-muted">
          Please try again in a moment.
        </p>
        {failureReason ? (
          <p className="mt-4 rounded-lg bg-background px-4 py-3 text-left text-sm text-muted">
            {failureReason}
          </p>
        ) : null}
        <a
          href="/mission-control"
          className="mt-6 inline-block text-sm font-medium text-primary hover:underline"
        >
          Try again
        </a>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-surface p-8">
      <h2 className="font-heading text-xl font-semibold">Analyzing...</h2>
      <p className="mt-2 text-sm text-muted">
        Estimated time: 1–3 minutes
      </p>

      <div className="mt-8 space-y-3">
        {stages.map((stage, i) => {
          const isCompleted = i < completedStages;
          const isActive = i === completedStages && status === "processing";
          const StageIcon = stage.icon;

          return (
            <motion.div
              key={stage.id}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.2, delay: i * 0.05 }}
              className={cn(
                "flex items-center gap-3 rounded-lg px-2 py-2 transition-colors",
                isActive && "bg-primary/5"
              )}
            >
              <div
                className={cn(
                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border",
                  isCompleted && "border-primary/20 bg-primary/10 text-primary",
                  isActive && "border-primary/30 bg-primary/10 text-primary",
                  !isCompleted && !isActive && "border-border bg-background text-muted"
                )}
              >
                {isCompleted ? (
                  <Check className="h-4 w-4" />
                ) : isActive ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <StageIcon className="h-4 w-4" />
                )}
              </div>
              <span
                className={cn(
                  "text-sm",
                  isCompleted && "text-foreground",
                  isActive && "font-medium text-foreground",
                  !isCompleted && !isActive && "text-muted"
                )}
              >
                {stage.label}
              </span>
            </motion.div>
          );
        })}
      </div>

      {showLongWaitHint ? (
        <p className="mt-6 rounded-lg border border-border bg-background px-4 py-3 text-sm text-muted">
          Still working — slow network or site fetch retries can extend this step.
          Your blueprint will appear automatically when ready.
        </p>
      ) : null}
    </div>
  );
}