import { z } from "zod";
import {
  extractClaimedQuotes,
  findVisualClaims,
} from "@/lib/audit/claim-rules";
import {
  MIN_VERIFIABLE_QUOTE_LENGTH,
  type AuditEvidenceStore,
} from "@/lib/audit/evidence";
import {
  REPORT_SCHEMA_VERSION,
  type ActionTask,
  type AnalysisReport,
  type Blindspot,
  type BlueprintStep,
  type Category,
  type FindingEvidence,
  type Impact,
  type Priority,
} from "@/types/analysis";

const priority = z.enum(["critical", "high", "medium", "low"]);
const category = z.enum(["product", "ux", "messaging", "competition"]);
const impact = z.enum(["high", "medium", "low"]);
const claimBasis = z.enum(["measured", "observed", "inferred"]);

const findingEvidenceSchema = z.object({
  basis: claimBasis,
  quote: z.string().optional(),
  sourceUrl: z.string().optional(),
  note: z.string().optional(),
});

export const analysisReportSchema = z.object({
  schemaVersion: z.number().optional(),
  score: z.number().min(0).max(100),
  summary: z.string().min(20),
  blindspots: z
    .array(
      z.object({
        id: z.string(),
        title: z.string(),
        priority,
        category,
        description: z.string(),
        suggestedFix: z.string(),
        evidence: z.array(findingEvidenceSchema).optional(),
      })
    )
    .min(1),
  blueprint: z
    .array(
      z.object({
        id: z.string(),
        step: z.number(),
        title: z.string(),
        estimatedEffort: z.string(),
        expectedImpact: impact,
        description: z.string(),
      })
    )
    .min(1),
  actions: z
    .array(
      z.object({
        id: z.string(),
        title: z.string(),
        description: z.string(),
        priority,
        estimatedEffort: z.string(),
        expectedOutcome: z.string(),
      })
    )
    .min(1),
});

/**
 * Minimums express "a report must say something", not a quota.
 *
 * These were 4 blindspots / 3 steps / 5 actions, combined with a hard
 * "≥1 high or critical" and "≥2 categories" rule. On a genuinely good site
 * that forced the model to invent filler and to escalate severity to pass
 * validation. A site with one real problem may now report one real problem.
 */
export const MIN_BLINDSPOTS = 1;
export const MIN_BLUEPRINT_STEPS = 1;
export const MIN_ACTIONS = 1;

/** Below this many findings the report must disclose that coverage was light. */
export const SPARSE_FINDING_THRESHOLD = 3;

/** Placeholder the normalizer used to inject — never treat as a real recommendation. */
export const GENERIC_SUGGESTED_FIX =
  "Review this area and implement a concrete fix this week.";

export function parseAnalysisReport(raw: unknown): AnalysisReport {
  return analysisReportSchema.parse(raw) as AnalysisReport;
}

/**
 * Structural well-formedness: every finding carries real content.
 *
 * This deliberately says nothing about *how many* findings exist beyond
 * "at least one", and nothing about severity mix. Evidence support is checked
 * separately by `validateReportEvidence`, which needs the evidence store.
 */
export function isCompleteReport(report: AnalysisReport): boolean {
  return reportQualityErrors(report).length === 0;
}

export function reportQualityErrors(report: AnalysisReport): string[] {
  const errors: string[] = [];

  const qualityBlindspots = report.blindspots.filter(isSubstantiveBlindspot);
  const qualityBlueprint = report.blueprint.filter(isSubstantiveBlueprint);
  const qualityActions = report.actions.filter(isSubstantiveAction);

  if (qualityBlindspots.length < MIN_BLINDSPOTS) {
    errors.push(
      `Need ≥${MIN_BLINDSPOTS} substantive blindspot (unique description ≥50 chars + specific suggestedFix ≥30 chars). Got ${qualityBlindspots.length} of ${report.blindspots.length} submitted.`
    );
  }
  if (qualityBlueprint.length < MIN_BLUEPRINT_STEPS) {
    errors.push(
      `Need ≥${MIN_BLUEPRINT_STEPS} substantive blueprint step. Got ${qualityBlueprint.length}.`
    );
  }
  if (qualityActions.length < MIN_ACTIONS) {
    errors.push(
      `Need ≥${MIN_ACTIONS} substantive action. Got ${qualityActions.length}.`
    );
  }
  if (report.summary.trim().length < 60) {
    errors.push(
      `Summary must be ≥60 chars and name the product/domain. Got ${report.summary.trim().length}.`
    );
  }

  return errors;
}

export function reportCompletenessError(report: AnalysisReport): string {
  const errors = reportQualityErrors(report);
  if (errors.length === 0) return "";

  return [
    "Incomplete audit JSON.",
    ...errors,
    `Each blindspot must state why it matters, what happens if ignored, and a concrete fix.`,
    `Report only problems you actually found — do not pad to a count and do not inflate severity.`,
    `Do NOT use placeholder fixes like "${GENERIC_SUGGESTED_FIX}". Resubmit full report_json.`,
  ].join(" ");
}

export interface EvidenceValidationResult {
  ok: boolean;
  /** Blocking problems — report must be resubmitted. */
  errors: string[];
  /** Findings removed because they were unsupported. */
  droppedFindingIds: string[];
  /** Non-blocking notes surfaced in report limitations. */
  warnings: string[];
}

/**
 * Validate every finding against the evidence actually collected.
 *
 * Three independent gates:
 *  1. Quoted text must appear in a page we fetched. A fabricated quote is the
 *     single most damaging failure mode for an audit product.
 *  2. Visual/rendered claims are inadmissible — extraction is text-only.
 *  3. A finding may not assert absence for a URL whose fetch failed.
 */
export function validateReportEvidence(
  report: AnalysisReport,
  store: AuditEvidenceStore
): EvidenceValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const droppedFindingIds: string[] = [];

  const failedUrls = store.failed().map((page) => page.url);

  for (const finding of report.blindspots) {
    const fields = {
      title: finding.title,
      description: finding.description,
      suggestedFix: finding.suggestedFix,
    };

    // --- Gate 2: visual claims without a renderer ---
    const visualHits = findVisualClaims(fields);
    if (visualHits.length > 0) {
      droppedFindingIds.push(finding.id);
      errors.push(
        `Blindspot "${finding.id}" asserts a visual/rendered property (${[
          ...new Set(visualHits.map((hit) => hit.rule)),
        ].join(
          ", "
        )}) but Revel collected no rendered evidence. Remove the finding or restate it as a text-based fact.`
      );
      continue;
    }

    // --- Gate 1: quoted text must exist in collected evidence ---
    const claimedQuotes = [
      ...extractClaimedQuotes(finding.description),
      ...(finding.evidence ?? [])
        .map((item) => item.quote)
        .filter((quote): quote is string => Boolean(quote)),
    ];

    const unverified = claimedQuotes.filter(
      (quote) => store.verifyQuote(quote) === "not_found"
    );

    if (unverified.length > 0) {
      droppedFindingIds.push(finding.id);
      errors.push(
        `Blindspot "${finding.id}" quotes text that does not appear on any fetched page: ${unverified
          .slice(0, 2)
          .map((quote) => `"${quote.slice(0, 60)}"`)
          .join(
            ", "
          )}. Quote the page verbatim or drop the quotation marks.`
      );
      continue;
    }

    const shortQuotes = claimedQuotes.filter(
      (quote) => store.verifyQuote(quote) === "too_short"
    );
    if (shortQuotes.length > 0) {
      warnings.push(
        `Blindspot "${finding.id}" contains quotes too short to verify (under ${MIN_VERIFIABLE_QUOTE_LENGTH} characters); recorded as inferred, not measured.`
      );
    }

    // --- Gate 3: absence claims about pages that never loaded ---
    const citedFailedUrl = failedUrls.find((url) =>
      [finding.description, finding.suggestedFix, ...(finding.evidence ?? []).map((e) => e.sourceUrl ?? "")].some(
        (text) => text?.includes(url)
      )
    );
    if (citedFailedUrl && /\b(no|missing|absent|lacks?|without|does not have)\b/i.test(finding.description)) {
      droppedFindingIds.push(finding.id);
      errors.push(
        `Blindspot "${finding.id}" claims something is missing but cites ${citedFailedUrl}, which failed to fetch. A failed fetch is not evidence of absence.`
      );
      continue;
    }

    // Evidence metadata is required for new submissions.
    if (!finding.evidence || finding.evidence.length === 0) {
      warnings.push(
        `Blindspot "${finding.id}" has no evidence metadata; basis recorded as inferred.`
      );
    }
  }

  if (!store.hasUsableEvidence()) {
    errors.push(
      "No page content was retrieved for this audit. A report cannot be produced from the domain name alone."
    );
  }

  return {
    ok: errors.length === 0,
    errors,
    droppedFindingIds,
    warnings,
  };
}

/** Default basis when the model omitted evidence metadata. */
export function ensureFindingEvidence(
  finding: Blindspot,
  store: AuditEvidenceStore
): FindingEvidence[] {
  if (finding.evidence && finding.evidence.length > 0) {
    return finding.evidence.map((item) => {
      // "measured" is a claim about OUR verification, never the model's
      // self-assessment. It is earned only by a quote we confirmed against
      // fetched text; anything else is downgraded and the reason recorded.
      if (!item.quote) {
        return {
          ...item,
          basis: item.basis === "measured" ? "inferred" : item.basis,
          ...(item.basis === "measured"
            ? { note: "Claimed as measured but carried no quote to verify." }
            : {}),
        } satisfies FindingEvidence;
      }

      const verdict = store.verifyQuote(item.quote);

      if (verdict === "verified") {
        return { ...item, basis: "measured" } satisfies FindingEvidence;
      }

      return {
        ...item,
        basis: "inferred",
        note:
          verdict === "too_short"
            ? `Quote too short to verify (under ${MIN_VERIFIABLE_QUOTE_LENGTH} characters); not verified against fetched pages.`
            : "Quote was not verified against fetched pages.",
      } satisfies FindingEvidence;
    });
  }

  const quotes = extractClaimedQuotes(finding.description).filter((quote) =>
    store.containsQuote(quote)
  );

  if (quotes.length > 0) {
    return quotes.map((quote) => ({
      basis: "measured" as const,
      quote,
      sourceUrl: store.fetched()[0]?.url,
    }));
  }

  return [
    {
      basis: "inferred" as const,
      note: "No verifiable page quote attached to this finding.",
    },
  ];
}

function isSubstantiveBlindspot(item: Blindspot): boolean {
  const title = item.title.trim();
  const description = item.description.trim();
  const fix = item.suggestedFix.trim();
  if (title.length < 8) return false;
  if (description.length < 50) return false;
  if (fix.length < 30) return false;
  if (fix === GENERIC_SUGGESTED_FIX) return false;
  if (/review this area/i.test(fix)) return false;
  if (description.toLowerCase() === title.toLowerCase()) return false;
  // Title repeated as the whole description with almost no extra detail
  if (
    description.toLowerCase().startsWith(title.toLowerCase()) &&
    description.length < title.length + 40
  ) {
    return false;
  }
  return true;
}

function isSubstantiveBlueprint(item: BlueprintStep): boolean {
  const title = item.title.trim();
  const description = item.description.trim();
  if (title.length < 8 || description.length < 40) return false;
  if (description.toLowerCase() === title.toLowerCase()) return false;
  return true;
}

function isSubstantiveAction(item: ActionTask): boolean {
  const title = item.title.trim();
  const description = item.description.trim();
  const outcome = item.expectedOutcome.trim();
  if (title.length < 8 || description.length < 30 || outcome.length < 15) {
    return false;
  }
  if (description.toLowerCase() === title.toLowerCase()) return false;
  return true;
}

/** Always returns arrays — never throws on partial/malformed LLM output. */
export function normalizeAnalysisReport(raw: unknown): AnalysisReport {
  const source = unwrapReportSource(raw);

  const blindspots = pickFieldArray(source, [
    "blindspots",
    "blind_spots",
    "blindSpots",
    "findings",
    "issues",
    "problems",
    "gaps",
  ])
    .map((item, index) => normalizeBlindspot(item, index))
    .filter((item): item is Blindspot => item !== null);

  const blueprint = pickFieldArray(source, [
    "blueprint",
    "roadmap",
    "steps",
    "plan",
  ])
    .flatMap((item, index) => normalizeBlueprintSteps(item, index))
    .map((step, index) => ({ ...step, step: step.step || index + 1 }))
    .sort((a, b) => a.step - b.step);

  let actions = pickFieldArray(source, [
    "actions",
    "action_queue",
    "actionQueue",
    "tasks",
    "recommendations",
  ])
    .map((item, index) => normalizeAction(item, index))
    .filter((item): item is ActionTask => item !== null);

  // Recover Action Queue from real findings only — never invent a lone default row
  // that would make empty audits look "complete".
  if (actions.length === 0 && (blindspots.length > 0 || blueprint.length > 0)) {
    actions = synthesizeActions(blindspots, blueprint);
  }

  const scoreRaw = source.score;
  const score =
    typeof scoreRaw === "number" && Number.isFinite(scoreRaw)
      ? Math.max(0, Math.min(100, Math.round(scoreRaw)))
      : typeof scoreRaw === "string" && scoreRaw.trim() && !Number.isNaN(Number(scoreRaw))
        ? Math.max(0, Math.min(100, Math.round(Number(scoreRaw))))
        : 50;

  const summary =
    typeof source.summary === "string" && source.summary.trim()
      ? source.summary.trim()
      : typeof source.overview === "string" && source.overview.trim()
        ? source.overview.trim()
        : typeof source.executiveSummary === "string" &&
            source.executiveSummary.trim()
          ? source.executiveSummary.trim()
          : "Analysis completed. Review blindspots and the blueprint for prioritized next steps.";

  const schemaVersion =
    typeof source.schemaVersion === "number" ? source.schemaVersion : undefined;

  return {
    ...(schemaVersion ? { schemaVersion } : {}),
    score,
    summary,
    blindspots,
    blueprint,
    actions,
  };
}

/** Stamp the current schema version and coverage onto an accepted report. */
export function finalizeReport(
  report: AnalysisReport,
  coverage: AnalysisReport["coverage"]
): AnalysisReport {
  return {
    ...report,
    schemaVersion: REPORT_SCHEMA_VERSION,
    ...(coverage ? { coverage } : {}),
  };
}

function unwrapReportSource(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }

  let current = raw as Record<string, unknown>;

  for (const key of ["report", "analysis", "result", "data", "payload"]) {
    const nested = current[key];
    if (
      nested &&
      typeof nested === "object" &&
      !Array.isArray(nested) &&
      (Array.isArray((nested as Record<string, unknown>).blindspots) ||
        Array.isArray((nested as Record<string, unknown>).blind_spots) ||
        Array.isArray((nested as Record<string, unknown>).findings) ||
        typeof (nested as Record<string, unknown>).score === "number" ||
        typeof (nested as Record<string, unknown>).summary === "string")
    ) {
      current = nested as Record<string, unknown>;
      break;
    }
  }

  return current;
}

function pickFieldArray(
  source: Record<string, unknown>,
  keys: string[]
): Record<string, unknown>[] {
  for (const key of keys) {
    if (!(key in source)) continue;
    const arr = asObjectArray(source[key]);
    if (arr.length > 0) return arr;
  }
  return [];
}

function asObjectArray(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    // Title-only strings are not real findings — ignore so quality gates reject
    if (value.every((item) => typeof item === "string")) {
      return [];
    }

    return value.filter(
      (item): item is Record<string, unknown> =>
        !!item && typeof item === "object" && !Array.isArray(item)
    );
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["items", "data", "list", "results"]) {
      if (Array.isArray(record[key])) {
        return asObjectArray(record[key]);
      }
    }
  }

  return [];
}

function pickString(
  item: Record<string, unknown>,
  keys: string[],
  fallback = ""
): string {
  for (const key of keys) {
    const value = item[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  // Recover values when LLM corrupts keys, e.g.
  // "estimatedEffort\": \"1 hour\", \"description\": ": "actual description"
  for (const [key, value] of Object.entries(item)) {
    if (typeof value !== "string" || !value.trim()) continue;
    const lower = key.toLowerCase();
    if (keys.some((wanted) => lower.includes(wanted.toLowerCase()))) {
      return value.trim();
    }
  }

  return fallback;
}

function pickNumber(item: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = item[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() && !Number.isNaN(Number(value))) {
      return Number(value);
    }
  }
  return null;
}

function normalizePriority(value: unknown, fallback: Priority = "medium"): Priority {
  if (typeof value === "string") {
    const v = value.toLowerCase().trim();
    if (v === "critical" || v === "high" || v === "medium" || v === "low") {
      return v;
    }
  }
  return fallback;
}

function normalizeCategory(value: unknown, fallback: Category = "product"): Category {
  if (typeof value === "string") {
    const v = value.toLowerCase().trim();
    if (v === "product" || v === "ux" || v === "messaging" || v === "competition") {
      return v;
    }
  }
  return fallback;
}

function normalizeImpact(value: unknown, fallback: Impact = "medium"): Impact {
  if (typeof value === "string") {
    const v = value.toLowerCase().trim();
    if (v === "high" || v === "medium" || v === "low") {
      return v;
    }
  }
  return fallback;
}

function normalizeClaimBasis(value: unknown): FindingEvidence["basis"] {
  if (typeof value === "string") {
    const v = value.toLowerCase().trim();
    if (v === "measured" || v === "observed" || v === "inferred") return v;
  }
  return "inferred";
}

function normalizeEvidenceList(value: unknown): FindingEvidence[] | undefined {
  const rows = asObjectArray(value);
  if (rows.length === 0) return undefined;

  const evidence = rows
    .map((row) => {
      const quote = pickString(row, ["quote", "text", "excerpt"], "");
      const sourceUrl = pickString(row, ["sourceUrl", "source_url", "url"], "");
      const note = pickString(row, ["note", "detail", "reason"], "");
      if (!quote && !sourceUrl && !note) return null;
      return {
        basis: normalizeClaimBasis(row.basis ?? row.type ?? row.kind),
        ...(quote ? { quote } : {}),
        ...(sourceUrl ? { sourceUrl } : {}),
        ...(note ? { note } : {}),
      } satisfies FindingEvidence;
    })
    .filter((item): item is FindingEvidence => item !== null);

  return evidence.length > 0 ? evidence : undefined;
}

function normalizeBlindspot(
  item: Record<string, unknown>,
  index: number
): Blindspot | null {
  const title = pickString(item, ["title", "name", "issue"], "");
  if (!title) return null;

  // No silent title/default fill — thin model rows stay thin and fail quality gates
  const description = pickString(
    item,
    ["description", "detail", "details", "body", "why", "impact"],
    ""
  );
  const suggestedFix = pickString(
    item,
    ["suggestedFix", "suggested_fix", "fix", "recommendation", "solution"],
    ""
  );

  if (!description || !suggestedFix) return null;
  if (description.toLowerCase() === title.toLowerCase()) return null;
  if (suggestedFix === GENERIC_SUGGESTED_FIX) return null;

  const evidence = normalizeEvidenceList(
    item.evidence ?? item.supporting_evidence ?? item.supportingEvidence
  );

  return {
    id: pickString(item, ["id"], `bs-${index + 1}`),
    title,
    priority: normalizePriority(item.priority),
    category: normalizeCategory(item.category),
    description,
    suggestedFix,
    ...(evidence ? { evidence } : {}),
  };
}

function looksCorrupted(text: string): boolean {
  return /\\"|\"\s*:|\{|\}\s*,|estimatedEffort\\/.test(text);
}

function extractQuotedField(blob: string, field: string): string | null {
  // Match "field": "value" including escaped-quote variants from broken LLM JSON
  const patterns = [
    new RegExp(`"${field}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`, "i"),
    new RegExp(`${field}\\\\?"\\s*:\\s*\\\\?"([^"\\\\]+)`, "i"),
  ];
  for (const re of patterns) {
    const match = blob.match(re);
    if (match?.[1]) {
      return match[1].replace(/\\"/g, '"').replace(/\\n/g, " ").trim();
    }
  }
  return null;
}

function stepsFromBlob(blob: string, index: number): BlueprintStep[] {
  if (!blob || blob.length < 8) return [];

  // Split on object boundaries if multiple steps were glued into one string
  const chunks = blob.includes('"title"')
    ? blob.split(/(?=\s*"id"\s*:|"id\\?"\s*:)/g).filter((c) => c.trim())
    : [blob];

  const steps: BlueprintStep[] = [];
  chunks.forEach((chunk, chunkIndex) => {
    const title = extractQuotedField(chunk, "title");
    if (!title || looksCorrupted(title)) return;

    const stepNum =
      Number(extractQuotedField(chunk, "step")) ||
      index + chunkIndex + 1;
    const id =
      extractQuotedField(chunk, "id") || `bp-recovered-${index}-${chunkIndex}`;
    const description =
      extractQuotedField(chunk, "description") || title;
    const estimatedEffort =
      extractQuotedField(chunk, "estimatedEffort") || "1 hour";
    const expectedImpact = normalizeImpact(
      extractQuotedField(chunk, "expectedImpact")
    );

    steps.push({
      id,
      step: Number.isFinite(stepNum) ? stepNum : index + chunkIndex + 1,
      title,
      estimatedEffort,
      expectedImpact,
      description,
    });
  });

  return steps;
}

function normalizeBlueprintSteps(
  item: Record<string, unknown>,
  index: number
): BlueprintStep[] {
  const title = pickString(item, ["title", "name"], "");
  const description = pickString(
    item,
    ["description", "detail", "details", "body"],
    ""
  );
  const estimatedEffort = pickString(
    item,
    ["estimatedEffort", "estimated_effort", "effort", "eta"],
    "1 hour"
  );
  const expectedImpact = normalizeImpact(
    item.expectedImpact ?? item.expected_impact ?? item.impact
  );

  // Clean row: title present and not garbage
  if (title && !looksCorrupted(title)) {
    return [
      {
        id: pickString(item, ["id"], `bp-${index + 1}`),
        step: pickNumber(item, ["step", "order", "index", "position"]) ?? index + 1,
        title,
        estimatedEffort: looksCorrupted(estimatedEffort) ? "1 hour" : estimatedEffort,
        expectedImpact,
        description:
          description && !looksCorrupted(description) ? description : title,
      },
    ];
  }

  // Corrupted row: recover every embedded step from keys + values
  const blob = Object.entries(item)
    .map(([k, v]) => `${k} ${typeof v === "string" ? v : JSON.stringify(v) ?? ""}`)
    .join(" ");

  const recovered = stepsFromBlob(blob, index);
  if (recovered.length > 0) return recovered;

  return [];
}

function normalizeAction(
  item: Record<string, unknown>,
  index: number
): ActionTask | null {
  const title = pickString(item, ["title", "name", "task"], "");
  if (!title) return null;

  return {
    id: pickString(item, ["id"], `act-${index + 1}`),
    title,
    description: pickString(
      item,
      ["description", "detail", "details", "body"],
      title
    ),
    priority: normalizePriority(item.priority),
    estimatedEffort: pickString(
      item,
      ["estimatedEffort", "estimated_effort", "effort", "eta"],
      "1 hour"
    ),
    expectedOutcome: pickString(
      item,
      ["expectedOutcome", "expected_outcome", "outcome", "result"],
      "Measurable product improvement"
    ),
  };
}

/** Build Action Queue when the model omits `actions` entirely. */
function synthesizeActions(
  blindspots: Blindspot[],
  blueprint: BlueprintStep[]
): ActionTask[] {
  const fromBlueprint = blueprint.map((step, index) => ({
    id: `synth-bp-${step.id || index + 1}`,
    title: step.title,
    description: step.description,
    priority:
      step.expectedImpact === "high"
        ? ("high" as const)
        : step.expectedImpact === "low"
          ? ("low" as const)
          : ("medium" as const),
    estimatedEffort: step.estimatedEffort || "1 hour",
    expectedOutcome: `${step.expectedImpact} impact improvement`,
  }));

  const fromBlindspots = blindspots.slice(0, 8).map((bs, index) => ({
    id: `synth-bs-${bs.id || index + 1}`,
    title: bs.title,
    description: bs.suggestedFix || bs.description,
    priority: bs.priority,
    estimatedEffort: "1 hour",
    expectedOutcome: "Reduce this blindspot and improve product clarity",
  }));

  return [...fromBlueprint, ...fromBlindspots];
}
