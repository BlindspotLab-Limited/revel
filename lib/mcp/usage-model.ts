/**
 * MCP billing unit model — use when setting OKX marketplace pricing.
 *
 * A "billable audit" is one completed website analysis, regardless of how
 * many MCP tool calls the client uses to get there.
 */
export const REVEL_MCP_USAGE = {
  /** One audit = one Groq/OpenRouter agentic run (4–10 LLM steps). */
  billableUnit: "completed_audit" as const,

  flows: {
    recommended: {
      label: "analyze → wait → export",
      mcpToolCalls: {
        minimum: 3,
        typical: 3,
        tools: [
          "revel_analyze_website",
          "revel_wait_for_analysis",
          "revel_export_blueprint",
        ],
      },
      llmCostDrivers: [
        "1× agentic analysis (Groq 4–8 API calls, or OpenRouter fallback)",
      ],
    },
    oneShot: {
      label: "analyze_and_wait",
      mcpToolCalls: {
        minimum: 1,
        typical: 1,
        tools: ["revel_analyze_website_and_wait"],
      },
      llmCostDrivers: [
        "Same 1× agentic analysis as recommended flow",
      ],
    },
    withHealthCheck: {
      label: "health → analyze → wait",
      mcpToolCalls: {
        minimum: 3,
        typical: 3,
        tools: [
          "revel_health",
          "revel_analyze_website",
          "revel_wait_for_analysis",
        ],
      },
      llmCostDrivers: [
        "revel_health is free (no LLM)",
        "1× agentic analysis",
      ],
    },
    pollInsteadOfWait: {
      label: "analyze → get_analysis (poll) → export [recommended for HTTP]",
      mcpToolCalls: {
        minimum: 4,
        typical: "15–20",
        tools: [
          "revel_analyze_website",
          "revel_get_analysis × N",
          "revel_export_blueprint",
        ],
      },
      llmCostDrivers: [
        "revel_get_analysis polls are DB-only (no LLM)",
        "1× agentic analysis",
        "Avoid revel_wait_for_analysis over HTTP — single requests often timeout ~60s",
      ],
    },
  },

  /** Internal agent tools per audit (not exposed as MCP tools). */
  internalAgentToolsPerAudit: {
    typical: "4–6",
    maximum: "10 (AGENT_MAX_STEPS)",
    tools: ["fetch_url", "discover_internal_links", "submit_analysis_report"],
  },

  pricingGuidance: {
    billPer: "completed_audit",
    notPer: "mcp_tool_call",
    rationale:
      "Poll and health tools are cheap; one audit always runs the full agentic pipeline.",
    launchPriceUsd: 0.35,
    suggestedRangeUsd: {
      low: 0.2,
      mid: 0.35,
      high: 0.5,
    },
    note: "$0.35/audit default (env OKX_AUDIT_PRICE_USD). Covers Groq/OpenRouter (~$0.02–0.08), hosting compute, and maintenance. $0.20 is viable only on Groq free tier; $0.50 is safer long-term margin.",
  },
} as const;

export function getMcpUsageSummary() {
  return REVEL_MCP_USAGE;
}