/**
 * Evidence collected for one audit run.
 *
 * This module is deliberately runtime-neutral: it holds data structures only,
 * no Node-only APIs. `lib/report-schema.ts` imports it and is itself imported by
 * client components, so pulling `node:async_hooks` in here would drag
 * AsyncLocalStorage into the browser bundle and fail the production build.
 * The per-request store lives in `evidence-context.ts` (server only).
 *
 * Revel's extraction is text-only (cheerio over raw HTML, no browser). Nothing
 * here can support a claim about spacing, contrast, mobile layout, or visual
 * hierarchy — `renderedEvidence` is permanently false until a real renderer
 * exists. Findings that need pixels must be withheld, not guessed.
 */

export type FetchOutcome =
  | "ok"
  | "http_error"
  | "network_error"
  | "blocked";

export interface PageEvidence {
  url: string;
  /** ISO timestamp of when the fetch completed (success or failure). */
  fetchedAt: string;
  outcome: FetchOutcome;
  httpStatus?: number;
  /** Fetch/extraction failure detail. Present when outcome !== "ok". */
  error?: string;
  title?: string;
  metaDescription?: string;
  h1s: string[];
  h2s: string[];
  ctas: string[];
  /** Nav link labels, captured BEFORE nav/footer are stripped from the DOM. */
  navLabels: string[];
  footerLabels: string[];
  bodyText: string;
  bodyTruncated: boolean;
  /**
   * Always false: extraction never rasterises or lays out the page, so no
   * visual property was observed. Gating flag for visual-claim validation.
   */
  renderedEvidence: false;
}

export interface CoverageSummary {
  pagesAttempted: number;
  pagesFetched: number;
  pagesFailed: number;
  /** URLs that returned usable content. */
  sources: string[];
  /** Attempted URLs that did not, with the reason. */
  failures: Array<{ url: string; outcome: FetchOutcome; error?: string }>;
  firstFetchedAt?: string;
  lastFetchedAt?: string;
  /** No renderer in the pipeline — visual checks cannot run. */
  visualEvidenceAvailable: false;
}

/** Collapse whitespace + case so quote matching tolerates reflowed HTML text. */
export function normalizeForMatch(text: string): string {
  return text
    .replace(/[‘’‛′]/g, "'")
    .replace(/[“”‟″]/g, '"')
    .replace(/[–—−]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Shortest quote we bother verifying — below this, matches are meaningless. */
export const MIN_VERIFIABLE_QUOTE_LENGTH = 12;

export class AuditEvidenceStore {
  private readonly pages: PageEvidence[] = [];
  /** Normalized haystack of every successfully fetched page, for quote checks. */
  private haystack = "";

  record(evidence: PageEvidence): void {
    this.pages.push(evidence);

    if (evidence.outcome !== "ok") return;

    this.haystack += ` ${normalizeForMatch(
      [
        evidence.title ?? "",
        evidence.metaDescription ?? "",
        ...evidence.h1s,
        ...evidence.h2s,
        ...evidence.ctas,
        ...evidence.navLabels,
        ...evidence.footerLabels,
        evidence.bodyText,
      ].join(" ")
    )}`;
  }

  all(): readonly PageEvidence[] {
    return this.pages;
  }

  fetched(): PageEvidence[] {
    return this.pages.filter((page) => page.outcome === "ok");
  }

  failed(): PageEvidence[] {
    return this.pages.filter((page) => page.outcome !== "ok");
  }

  /** True when at least one page produced usable text. */
  hasUsableEvidence(): boolean {
    return this.pages.some(
      (page) => page.outcome === "ok" && page.bodyText.trim().length > 0
    );
  }

  /**
   * Was this URL attempted and did it fail? Used to stop the model turning a
   * fetch failure into a "verified missing feature".
   */
  fetchFailedFor(url: string): PageEvidence | undefined {
    return this.pages.find(
      (page) => page.url === url && page.outcome !== "ok"
    );
  }

  /** Substring check against all successfully fetched text. */
  containsQuote(quote: string): boolean {
    return this.verifyQuote(quote) === "verified";
  }

  /**
   * Why a quote did or did not verify.
   *
   * `containsQuote` collapses "too short to check" and "not on the page" into
   * a single false, which hid a real defect: a short quote skipped rejection
   * *and* skipped promotion, so the model's own `basis` survived unchallenged
   * and an unverifiable string could ship labelled "measured".
   *
   * - verified   : found in text we actually fetched
   * - too_short  : below the length at which a substring match means anything
   * - not_found  : long enough to check, and absent — i.e. fabricated
   */
  verifyQuote(quote: string): "verified" | "too_short" | "not_found" {
    const needle = normalizeForMatch(quote);
    if (needle.length < MIN_VERIFIABLE_QUOTE_LENGTH) return "too_short";
    return this.haystack.includes(needle) ? "verified" : "not_found";
  }

  coverage(): CoverageSummary {
    const fetched = this.fetched();
    const failed = this.failed();
    const timestamps = this.pages
      .map((page) => page.fetchedAt)
      .filter(Boolean)
      .sort();

    return {
      pagesAttempted: this.pages.length,
      pagesFetched: fetched.length,
      pagesFailed: failed.length,
      sources: fetched.map((page) => page.url),
      failures: failed.map((page) => ({
        url: page.url,
        outcome: page.outcome,
        error: page.error,
      })),
      firstFetchedAt: timestamps[0],
      lastFetchedAt: timestamps[timestamps.length - 1],
      visualEvidenceAvailable: false,
    };
  }
}
