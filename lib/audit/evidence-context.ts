import { AsyncLocalStorage } from "node:async_hooks";
import type { AuditEvidenceStore } from "@/lib/audit/evidence";

/**
 * Per-audit evidence store, scoped with AsyncLocalStorage.
 *
 * SERVER ONLY — `node:async_hooks` cannot be bundled for the browser. Kept
 * apart from `evidence.ts` so that module stays importable from client
 * components (via `lib/report-schema.ts`).
 *
 * Mirrors the `runWithActivityContext` pattern in `lib/activity-context.ts`,
 * so tool execution can record evidence without threading a parameter through
 * every call frame.
 */
const storage = new AsyncLocalStorage<AuditEvidenceStore>();

export function runWithEvidenceStore<T>(
  store: AuditEvidenceStore,
  fn: () => Promise<T>
): Promise<T> {
  return storage.run(store, fn);
}

export function getEvidenceStore(): AuditEvidenceStore | undefined {
  return storage.getStore();
}
