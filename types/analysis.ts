export type Priority = "critical" | "high" | "medium" | "low";
export type Category = "product" | "ux" | "messaging" | "competition";
/**
 * "partial" = the audit produced a usable report but coverage was incomplete
 * (some pages failed to fetch). It is reported separately from "completed" so
 * the completion-rate denominator stays honest.
 */
export type AnalysisStatus =
  | "pending"
  | "processing"
  | "completed"
  | "partial"
  | "failed";
export type Impact = "high" | "medium" | "low";

/**
 * How a claim is supported.
 * - measured: read directly out of the fetched markup (an exact string, a
 *   present/absent element) — a fact about the page as retrieved.
 * - observed: a reading of the retrieved text that others could reproduce.
 * - inferred: judgement or benchmark comparison, not grounded in a quote.
 */
export type ClaimBasis = "measured" | "observed" | "inferred";

export interface FindingEvidence {
  basis: ClaimBasis;
  /** Verbatim page text. Validated against collected evidence. */
  quote?: string;
  /** URL the quote/observation came from. */
  sourceUrl?: string;
  note?: string;
}

export interface Blindspot {
  id: string;
  title: string;
  priority: Priority;
  category: Category;
  description: string;
  suggestedFix: string;
  /** Present from schemaVersion 2. Absent on legacy stored reports. */
  evidence?: FindingEvidence[];
}

export interface BlueprintStep {
  id: string;
  step: number;
  title: string;
  estimatedEffort: string;
  expectedImpact: Impact;
  description: string;
}

export interface ActionTask {
  id: string;
  title: string;
  description: string;
  priority: Priority;
  estimatedEffort: string;
  expectedOutcome: string;
}

/** One capability Revel advertises, and whether it actually ran. */
export interface CheckStatus {
  id: string;
  label: string;
  status: "ran" | "partial" | "skipped" | "unsupported";
  detail?: string;
}

/**
 * What the audit actually looked at. Written for every schemaVersion 2 report
 * so partial coverage and unverified checks are visible to the reader rather
 * than implied by silence.
 */
export interface ReportCoverage {
  pagesAttempted: number;
  pagesFetched: number;
  pagesFailed: number;
  sources: string[];
  failures: Array<{ url: string; outcome: string; error?: string }>;
  firstFetchedAt?: string;
  lastFetchedAt?: string;
  /** Always false today: extraction is text-only, nothing is rendered. */
  visualEvidenceAvailable: boolean;
  checks: CheckStatus[];
  /** Human-readable scope limits shown with the report. */
  limitations: string[];
}

/** Current report schema. Legacy stored reports are version 1 (field absent). */
export const REPORT_SCHEMA_VERSION = 2;

export interface AnalysisReport {
  /** 2 for reports written by the current pipeline; absent/1 for legacy. */
  schemaVersion?: number;
  score: number;
  summary: string;
  blindspots: Blindspot[];
  blueprint: BlueprintStep[];
  actions: ActionTask[];
  /** Present from schemaVersion 2. */
  coverage?: ReportCoverage;
}

export interface Analysis {
  id: string;
  userId?: string;
  website: string;
  status: AnalysisStatus;
  score?: number;
  createdAt: string;
  /** Set when the run reaches a terminal state. */
  completedAt?: string;
  /** Wall-clock run duration, for median/p95 reporting. */
  durationMs?: number;
  report?: AnalysisReport;
  error?: string;
}

export type AnalysisStage =
  | "product"
  | "ux"
  | "messaging"
  | "competitors"
  | "blueprint";

export interface AnalysisProgress {
  stages: {
    id: AnalysisStage;
    label: string;
    status: "pending" | "active" | "completed";
  }[];
}