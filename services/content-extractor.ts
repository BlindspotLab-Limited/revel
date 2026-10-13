import * as cheerio from "cheerio";
import type { PageEvidence } from "@/lib/audit/evidence";
import { formatFetchError, resilientFetch } from "@/lib/resilient-fetch";

const INTERESTING_PATH =
  /pricing|price|plans|about|features|product|solutions|customers|demo|signup|sign-up|contact/i;

const FETCH_HEADERS = {
  "User-Agent": "Mozilla/5.0 (compatible; RevelBot/1.0; +https://tryrevel.xyz)",
  Accept: "text/html,application/xhtml+xml",
};

const BODY_LIMIT = 12000;

/**
 * Fetch one page and return structured evidence.
 *
 * Never throws for an unreachable page: a failed fetch is itself evidence and
 * must be recorded as such, so downstream code can tell "we looked and it was
 * absent" apart from "we could not look". Callers that want an exception can
 * use `extractWebsiteContent`.
 */
export async function fetchPageEvidence(url: string): Promise<PageEvidence> {
  const base = {
    url,
    h1s: [] as string[],
    h2s: [] as string[],
    ctas: [] as string[],
    navLabels: [] as string[],
    footerLabels: [] as string[],
    bodyText: "",
    bodyTruncated: false,
    renderedEvidence: false as const,
  };

  try {
    const response = await resilientFetch(url, {
      context: `Fetch website ${url}`,
      retries: 2,
      headers: FETCH_HEADERS,
      ssrfGuard: true,
    });

    if (!response.ok) {
      return {
        ...base,
        fetchedAt: new Date().toISOString(),
        outcome: "http_error",
        httpStatus: response.status,
        error: `Could not access website (HTTP ${response.status})`,
      };
    }

    const html = await response.text();
    return {
      ...base,
      ...parseHtml(html),
      url,
      fetchedAt: new Date().toISOString(),
      outcome: "ok",
      httpStatus: response.status,
      renderedEvidence: false,
    };
  } catch (error) {
    return {
      ...base,
      fetchedAt: new Date().toISOString(),
      outcome: "network_error",
      error: formatFetchError(error, `Fetch website ${url}`),
    };
  }
}

/**
 * Structured extraction from raw HTML.
 *
 * Order matters: nav and footer link labels are read *before* those elements
 * are stripped. The previous implementation removed `nav`/`footer` first and
 * then queried `nav a`, so navigation evidence was always empty.
 */
export function parseHtml(html: string): Omit<
  PageEvidence,
  "url" | "fetchedAt" | "outcome" | "httpStatus" | "error" | "renderedEvidence"
> {
  const $ = cheerio.load(html);

  const textList = (selector: string, maxLength: number, limit: number) =>
    $(selector)
      .map((_, el) => $(el).text().replace(/\s+/g, " ").trim())
      .get()
      .filter((text) => text.length > 0 && text.length < maxLength)
      .slice(0, limit);

  // --- Collected while nav/footer are still in the DOM ---
  const navLabels = [...new Set(textList("nav a, header a", 40, 24))];
  const footerLabels = [...new Set(textList("footer a", 40, 24))];
  const ctas = [
    ...new Set(
      textList("button, a[class*='btn'], a[class*='cta'], [role='button']", 50, 16)
    ),
  ];

  const title = $("title").first().text().replace(/\s+/g, " ").trim();
  const metaDescription = $('meta[name="description"]')
    .attr("content")
    ?.replace(/\s+/g, " ")
    .trim();
  const h1s = textList("h1", 200, 10);
  const h2s = textList("h2", 200, 12);

  // --- Now safe to strip chrome for the body-text pass ---
  $("script, style, noscript, svg, iframe, nav, footer").remove();

  const rawBody = $("main, article, [role='main'], body")
    .first()
    .text()
    .replace(/\s+/g, " ")
    .trim();

  return {
    title: title || undefined,
    metaDescription: metaDescription || undefined,
    h1s,
    h2s,
    ctas,
    navLabels,
    footerLabels,
    bodyText: rawBody.slice(0, BODY_LIMIT),
    bodyTruncated: rawBody.length > BODY_LIMIT,
  };
}

/**
 * Render evidence as prompt text, with provenance attached so the model can
 * cite a source and cannot mistake a failed fetch for an empty page.
 */
export function evidenceToPromptText(evidence: PageEvidence): string {
  if (evidence.outcome !== "ok") {
    return [
      `Source: ${evidence.url}`,
      `Fetched at: ${evidence.fetchedAt}`,
      `Fetch outcome: ${evidence.outcome}${
        evidence.httpStatus ? ` (HTTP ${evidence.httpStatus})` : ""
      }`,
      `Error: ${evidence.error ?? "unknown"}`,
      `NO CONTENT WAS RETRIEVED. You did not observe this page. Do not state or imply that any feature, section, or link is missing from it.`,
    ].join("\n");
  }

  const parts: string[] = [
    `Source: ${evidence.url}`,
    `Fetched at: ${evidence.fetchedAt}`,
    `Fetch outcome: ok (HTTP ${evidence.httpStatus ?? 200})`,
    `Visual/rendered evidence: NONE (text-only extraction)`,
  ];

  if (evidence.title) parts.push(`Title: ${evidence.title}`);
  if (evidence.metaDescription)
    parts.push(`Description: ${evidence.metaDescription}`);
  if (evidence.h1s.length) parts.push(`Headlines: ${evidence.h1s.join(" | ")}`);
  if (evidence.h2s.length)
    parts.push(`Subheadings: ${evidence.h2s.join(" | ")}`);
  if (evidence.ctas.length) parts.push(`CTAs: ${evidence.ctas.join(" | ")}`);
  if (evidence.navLabels.length)
    parts.push(`Nav: ${evidence.navLabels.join(" | ")}`);
  else parts.push(`Nav: (no nav/header links found in markup)`);
  if (evidence.footerLabels.length)
    parts.push(`Footer: ${evidence.footerLabels.join(" | ")}`);
  if (evidence.bodyText)
    parts.push(
      `Content${evidence.bodyTruncated ? " (truncated)" : ""}: ${evidence.bodyText}`
    );

  return parts.join("\n\n");
}

/**
 * Throwing wrapper kept for the legacy single-shot path.
 * Prefer `fetchPageEvidence` so fetch outcomes stay inspectable.
 */
export async function extractWebsiteContent(url: string): Promise<string> {
  const evidence = await fetchPageEvidence(url);

  if (evidence.outcome !== "ok") {
    throw new Error(evidence.error ?? `Fetch website ${url}: request failed`);
  }

  return evidenceToPromptText(evidence);
}

export async function discoverInternalLinks(
  baseUrl: string,
  limit = 12
): Promise<string[]> {
  try {
    const response = await resilientFetch(baseUrl, {
      context: `Discover links on ${baseUrl}`,
      retries: 2,
      headers: FETCH_HEADERS,
      ssrfGuard: true,
    });

    if (!response.ok) {
      throw new Error(`Could not access website (HTTP ${response.status})`);
    }

    const html = await response.text();
    const $ = cheerio.load(html);
    const origin = new URL(baseUrl).origin;
    const seen = new Set<string>();
    const links: string[] = [];

    $("a[href]").each((_, el) => {
      const href = $(el).attr("href")?.trim();
      if (!href || href.startsWith("#") || href.startsWith("mailto:")) return;

      try {
        const absolute = new URL(href, baseUrl);
        if (absolute.origin !== origin) return;
        const path = absolute.pathname;
        if (path === "/" || path.length < 2) return;
        const normalized = `${origin}${path}`.replace(/\/$/, "") || origin;
        if (seen.has(normalized)) return;
        seen.add(normalized);
        links.push(normalized);
      } catch {
        // skip invalid href
      }
    });

    const prioritized = [
      ...links.filter((url) => INTERESTING_PATH.test(new URL(url).pathname)),
      ...links.filter((url) => !INTERESTING_PATH.test(new URL(url).pathname)),
    ];

    return prioritized.slice(0, limit);
  } catch (error) {
    throw new Error(formatFetchError(error, `Discover links on ${baseUrl}`));
  }
}
