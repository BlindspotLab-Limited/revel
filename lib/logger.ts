type LogEvent =
  | "analysis_started"
  | "analysis_completed"
  | "analysis_partial"
  | "analysis_failed"
  | "export_completed";

export function logEvent(
  event: LogEvent,
  data: Record<string, unknown> = {}
): void {
  const entry = {
    level: event === "analysis_failed" ? "error" : "info",
    source: "revel",
    event,
    timestamp: new Date().toISOString(),
    ...data,
  };

  // Always single-line JSON so Vercel Runtime Logs show full fields (not [Object])
  const line = JSON.stringify(entry);
  if (event === "analysis_failed") {
    console.error(line);
  } else if (process.env.NODE_ENV === "production") {
    console.log(line);
  } else {
    console.log(`[Revel] ${event}`, data);
  }
}