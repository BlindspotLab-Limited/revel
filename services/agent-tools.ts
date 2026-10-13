import { ZodError } from "zod";
import {
  AUDIT_LIMITATIONS,
  buildCheckStatuses,
} from "@/lib/audit/capabilities";
import { getEvidenceStore } from "@/lib/audit/evidence-context";
import {
  ensureFindingEvidence,
  finalizeReport,
  isCompleteReport,
  normalizeAnalysisReport,
  parseAnalysisReport,
  reportCompletenessError,
  validateReportEvidence,
} from "@/lib/report-schema";
import type { AnalysisReport, ReportCoverage } from "@/types/analysis";
import {
  discoverInternalLinks,
  evidenceToPromptText,
  fetchPageEvidence,
} from "@/services/content-extractor";

export type AgentToolName =
  | "fetch_url"
  | "discover_internal_links"
  | "submit_analysis_report";

export const AGENT_TOOL_DECLARATIONS = [
  {
    name: "fetch_url",
    description:
      "Fetch and extract readable text from a public webpage. Returns the source URL, a fetch timestamp, the HTTP outcome, and the extracted text (title, meta description, headings, CTA labels, nav labels, body copy). Extraction is text-only: no layout, colour or mobile rendering is observed. If the fetch fails, the result says so and contains no content — that is not evidence that anything is missing from the page.",
    parameters: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "Absolute URL to fetch",
        },
      },
      required: ["url"],
    },
  },
  {
    name: "discover_internal_links",
    description:
      "List same-origin internal links from a page. Prioritizes pricing, about, features, and similar paths.",
    parameters: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "Base URL to scan for internal links",
        },
        limit: {
          type: "number",
          description: "Maximum links to return (default 12)",
        },
      },
      required: ["url"],
    },
  },
  {
    name: "submit_analysis_report",
    description:
      "Submit the final structured product audit as JSON. Report only the problems you actually found on the pages you fetched — there is no minimum count and no requirement for a high/critical finding. Every quoted phrase is verified against the fetched pages and a report containing an unverifiable quote is rejected.",
    parameters: {
      type: "object",
      properties: {
        report_json: {
          type: "string",
          description:
            "Stringified JSON with score, summary, blindspots, blueprint, actions. Each blindspot may carry evidence: [{ basis: 'measured'|'observed'|'inferred', quote, sourceUrl }].",
        },
      },
      required: ["report_json"],
    },
  },
];

export function getOpenAIAgentTools() {
  return AGENT_TOOL_DECLARATIONS.map((tool) => ({
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

export interface AgentToolResult {
  response: Record<string, unknown>;
  report?: AnalysisReport;
}

function parseSubmitPayload(args: Record<string, unknown>): unknown {
  if (typeof args.report_json === "string") {
    try {
      return JSON.parse(args.report_json);
    } catch {
      throw new Error("report_json is not valid JSON");
    }
  }

  if (typeof args.score === "number") {
    return args;
  }

  throw new Error("submit_analysis_report requires report_json");
}

export function isAgentToolName(name: string): name is AgentToolName {
  return (
    name === "fetch_url" ||
    name === "discover_internal_links" ||
    name === "submit_analysis_report"
  );
}

/** Coverage block written onto every accepted report. */
export function buildReportCoverage(): ReportCoverage | undefined {
  const store = getEvidenceStore();
  if (!store) return undefined;

  const coverage = store.coverage();

  return {
    pagesAttempted: coverage.pagesAttempted,
    pagesFetched: coverage.pagesFetched,
    pagesFailed: coverage.pagesFailed,
    sources: coverage.sources,
    failures: coverage.failures,
    firstFetchedAt: coverage.firstFetchedAt,
    lastFetchedAt: coverage.lastFetchedAt,
    visualEvidenceAvailable: false,
    checks: buildCheckStatuses(store),
    limitations: [...AUDIT_LIMITATIONS],
  };
}

export async function executeAgentTool(
  name: AgentToolName,
  args: Record<string, unknown>
): Promise<AgentToolResult> {
  switch (name) {
    case "fetch_url": {
      const url = String(args.url ?? "").trim();
      if (!url) {
        return { response: { error: "url is required" } };
      }

      const evidence = await fetchPageEvidence(url);
      getEvidenceStore()?.record(evidence);

      if (evidence.outcome !== "ok") {
        return {
          response: {
            url,
            fetchedAt: evidence.fetchedAt,
            outcome: evidence.outcome,
            ...(evidence.httpStatus ? { httpStatus: evidence.httpStatus } : {}),
            error: evidence.error ?? "Fetch failed",
            contentRetrieved: false,
            note: "No content was retrieved. Do not treat this as evidence that any feature, section or link is absent.",
          },
        };
      }

      return {
        response: {
          url,
          fetchedAt: evidence.fetchedAt,
          outcome: "ok",
          httpStatus: evidence.httpStatus,
          contentRetrieved: true,
          renderedEvidence: false,
          truncated: evidence.bodyTruncated,
          content: evidenceToPromptText(evidence),
        },
      };
    }

    case "discover_internal_links": {
      const url = String(args.url ?? "").trim();
      if (!url) {
        return { response: { error: "url is required" } };
      }

      const limit =
        typeof args.limit === "number" && args.limit > 0
          ? Math.min(args.limit, 20)
          : 12;

      try {
        const links = await discoverInternalLinks(url, limit);
        return {
          response: {
            url,
            links,
            count: links.length,
            discoveredAt: new Date().toISOString(),
          },
        };
      } catch (error) {
        return {
          response: {
            url,
            discoveredAt: new Date().toISOString(),
            error: error instanceof Error ? error.message : "Discovery failed",
            note: "Link discovery failed. Do not treat this as evidence that the site has no internal pages.",
          },
        };
      }
    }

    case "submit_analysis_report": {
      try {
        const payload = parseSubmitPayload(args);

        let report: AnalysisReport;
        let repaired = false;

        try {
          report = parseAnalysisReport(payload);
        } catch (strictError) {
          report = normalizeAnalysisReport(payload);
          repaired = true;
          if (!isCompleteReport(report)) {
            return {
              response: {
                accepted: false,
                error:
                  reportCompletenessError(report) +
                  (strictError instanceof ZodError
                    ? ` Schema: ${strictError.issues
                        .slice(0, 3)
                        .map((issue) => issue.message)
                        .join("; ")}`
                    : ""),
              },
            };
          }
        }

        if (!isCompleteReport(report)) {
          return {
            response: {
              accepted: false,
              error: reportCompletenessError(report),
            },
          };
        }

        const store = getEvidenceStore();

        // Without a store we cannot verify any claim, so we must not accept.
        if (!store) {
          return {
            response: {
              accepted: false,
              error:
                "No evidence store is attached to this audit run, so quoted text cannot be verified. Report rejected.",
            },
          };
        }

        const validation = validateReportEvidence(report, store);
        if (!validation.ok) {
          return {
            response: {
              accepted: false,
              evidenceRejected: true,
              error: [
                "Report rejected: claims are not supported by collected evidence.",
                ...validation.errors.slice(0, 4),
              ].join(" "),
            },
          };
        }

        const withEvidence: AnalysisReport = {
          ...report,
          blindspots: report.blindspots.map((finding) => ({
            ...finding,
            evidence: ensureFindingEvidence(finding, store),
          })),
        };

        const coverage = buildReportCoverage();
        const finalized = finalizeReport(withEvidence, coverage);

        return {
          response: {
            accepted: true,
            score: finalized.score,
            findings: finalized.blindspots.length,
            pagesFetched: coverage?.pagesFetched ?? 0,
            ...(repaired ? { repaired: true } : {}),
            ...(validation.warnings.length
              ? { warnings: validation.warnings.slice(0, 4) }
              : {}),
          },
          report: finalized,
        };
      } catch (error) {
        const validationError =
          error instanceof ZodError
            ? error.issues
                .slice(0, 4)
                .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
                .join("; ")
            : error instanceof Error
              ? error.message
              : "Report failed schema validation";

        return {
          response: {
            accepted: false,
            error: validationError,
          },
        };
      }
    }

    default:
      return { response: { error: `Unknown tool: ${name}` } };
  }
}
