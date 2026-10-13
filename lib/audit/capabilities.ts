import type { CheckStatus } from "@/types/analysis";
import type { AuditEvidenceStore } from "@/lib/audit/evidence";

/**
 * Honest inventory of what a Revel audit does.
 *
 * Revel is a **product, messaging and UX-copy review built from server-rendered
 * HTML text**. It is not a technical SEO audit, a performance audit, or an
 * accessibility audit: there is no browser, no rendering, no Lighthouse, no
 * robots/sitemap parsing and no third-party competitor data in the pipeline.
 *
 * `UNSUPPORTED_CHECKS` exists so those gaps ship *in* the report instead of
 * being left for the reader to assume. If a check is added later, move it out
 * of this list — do not advertise it from marketing copy first.
 */

/** What the audit genuinely claims to be, for report + listing labels. */
export const AUDIT_DISCIPLINE_LABEL =
  "Product, messaging & UX-copy review (text-only)";

export const AUDIT_DISCIPLINE_DESCRIPTION =
  "Fetches public HTML, extracts on-page text (title, meta description, headings, CTA and navigation labels, body copy), and reviews product positioning, messaging clarity and conversion-copy gaps. Findings cite verbatim page text.";

/** Checks that run on every audit, given a successful fetch. */
const SUPPORTED_CHECKS: Array<Omit<CheckStatus, "status" | "detail">> = [
  { id: "html_fetch", label: "Public HTML fetch (with redirect + SSRF guard)" },
  { id: "title_meta", label: "Title and meta description extraction" },
  { id: "headings", label: "H1/H2 heading extraction" },
  { id: "cta_labels", label: "CTA and button label extraction" },
  { id: "nav_labels", label: "Navigation and footer link-label extraction" },
  { id: "internal_links", label: "Same-origin internal link discovery" },
  { id: "messaging_review", label: "Product positioning and messaging review" },
  { id: "copy_review", label: "Conversion-copy and UX-copy review" },
];

/**
 * Capabilities Revel does NOT have. Reported as `unsupported` so no reader
 * infers them from the word "audit".
 */
export const UNSUPPORTED_CHECKS: CheckStatus[] = [
  {
    id: "rendered_layout",
    label: "Rendered layout, spacing and visual hierarchy",
    status: "unsupported",
    detail: "No headless browser in the pipeline; nothing is rendered.",
  },
  {
    id: "colour_contrast",
    label: "Colour contrast / WCAG accessibility",
    status: "unsupported",
    detail: "Requires computed styles from a rendered page.",
  },
  {
    id: "mobile_responsive",
    label: "Mobile and responsive behaviour",
    status: "unsupported",
    detail: "No viewport emulation; no device rendering.",
  },
  {
    id: "performance",
    label: "Page speed / Core Web Vitals",
    status: "unsupported",
    detail: "No performance instrumentation or field data.",
  },
  {
    id: "technical_seo",
    label: "Technical SEO (robots.txt, sitemap, canonical, hreflang, structured data)",
    status: "unsupported",
    detail:
      "Not parsed. Revel reviews product and messaging copy, not crawl directives or markup validity.",
  },
  {
    id: "index_status",
    label: "Search index status and rankings",
    status: "unsupported",
    detail: "No search-console or SERP data source.",
  },
  {
    id: "broken_links",
    label: "Broken link verification",
    status: "unsupported",
    detail: "Internal links are discovered but not individually status-checked.",
  },
  {
    id: "competitor_data",
    label: "Competitor benchmarking from live competitor sites",
    status: "unsupported",
    detail:
      "No competitor page is fetched. Competition-category findings are model inference, not measurement.",
  },
  {
    id: "javascript_content",
    label: "Content rendered only by client-side JavaScript",
    status: "unsupported",
    detail:
      "Extraction reads the server HTML response, so SPA-injected copy may be missing.",
  },
];

/** Scope caveats shown alongside every report. */
export const AUDIT_LIMITATIONS: string[] = [
  "Text-only analysis: no page was rendered, so no claim is made about layout, spacing, colour, contrast or mobile presentation.",
  "Content injected by client-side JavaScript may not appear in the extracted text.",
  "Competition-category findings are inference from this site's own copy; no competitor site was fetched.",
  "This is a product/messaging/UX-copy review, not a technical SEO, performance or accessibility audit.",
];

/**
 * Build the per-audit check list from what actually happened on this run.
 * A check that depends on a fetch is `skipped` when every fetch failed, and
 * `partial` when some pages failed.
 */
export function buildCheckStatuses(store: AuditEvidenceStore): CheckStatus[] {
  const coverage = store.coverage();
  const anyFetched = coverage.pagesFetched > 0;
  const someFailed = coverage.pagesFailed > 0;

  const fetchDependentStatus: CheckStatus["status"] = !anyFetched
    ? "skipped"
    : someFailed
      ? "partial"
      : "ran";

  const detail = !anyFetched
    ? "No page content was retrieved."
    : someFailed
      ? `${coverage.pagesFetched} of ${coverage.pagesAttempted} pages returned content.`
      : undefined;

  return [
    ...SUPPORTED_CHECKS.map((check) => ({
      ...check,
      status: fetchDependentStatus,
      ...(detail ? { detail } : {}),
    })),
    ...UNSUPPORTED_CHECKS,
  ];
}
