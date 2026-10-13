import assert from "node:assert/strict";
import {
  extractClaimedQuotes,
  findVisualClaims,
} from "@/lib/audit/claim-rules";
import { AuditEvidenceStore, type PageEvidence } from "@/lib/audit/evidence";
import { validateReportEvidence } from "@/lib/report-schema";
import type { AnalysisReport, Blindspot } from "@/types/analysis";

function page(overrides: Partial<PageEvidence> = {}): PageEvidence {
  return {
    url: "https://acme.test",
    fetchedAt: new Date().toISOString(),
    outcome: "ok",
    httpStatus: 200,
    h1s: [],
    h2s: [],
    ctas: [],
    navLabels: [],
    footerLabels: [],
    bodyText: "",
    bodyTruncated: false,
    renderedEvidence: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Visual claims are inadmissible — nothing is ever rendered.
// ---------------------------------------------------------------------------
const visualExamples = [
  "Mobile navigation is cramped and hard to tap",
  "Multiple buttons of equal visual weight create decision paralysis",
  "No customer logos visible above the fold",
  "Text contrast is too low against the background",
  "Ensure touch targets are at least 44px",
  "The hero image looks dated",
  "There is too much whitespace between sections",
  "Font size is too small for body copy",
];
for (const text of visualExamples) {
  assert.ok(
    findVisualClaims({ description: text }).length > 0,
    `expected a visual-claim hit for: ${text}`
  );
}

// Text-grounded statements must NOT be flagged.
const textualExamples = [
  'The H1 reads "Get paid on time" but never names who it is for',
  "There is no Pricing link in the nav (checked https://acme.test)",
  "The page has no testimonial or customer-name copy anywhere in the body text",
  "CTA label is 'Submit', which does not describe the outcome",
  "Meta description is missing entirely",
];
for (const text of textualExamples) {
  assert.deepEqual(
    findVisualClaims({ description: text }),
    [],
    `expected no visual-claim hit for: ${text}`
  );
}

// ---------------------------------------------------------------------------
// Quote extraction
// ---------------------------------------------------------------------------
assert.deepEqual(
  extractClaimedQuotes('The hero says "Get paid on time" and nothing else'),
  ["Get paid on time"]
);
assert.deepEqual(
  extractClaimedQuotes("The hero says “Ship faster today” here"),
  ["Ship faster today"]
);
assert.deepEqual(extractClaimedQuotes("No quotes at all here"), []);

// ---------------------------------------------------------------------------
// End-to-end evidence validation
// ---------------------------------------------------------------------------
function blindspot(overrides: Partial<Blindspot> = {}): Blindspot {
  return {
    id: "bs-1",
    title: "Hero never states the job-to-be-done",
    priority: "high",
    category: "messaging",
    description:
      'The hero H1 reads "Get paid on time" but never names the audience, so visitors cannot self-qualify quickly.',
    suggestedFix:
      "Rewrite the H1 to name the audience and the outcome in a single sentence, then add a one-line subhead.",
    ...overrides,
  };
}

function report(blindspots: Blindspot[]): AnalysisReport {
  return {
    score: 60,
    summary:
      "acme.test positions itself as invoicing software but the homepage copy never names the audience or the pricing model anywhere.",
    blindspots,
    blueprint: [
      {
        id: "bp-1",
        step: 1,
        title: "Rewrite the hero headline",
        estimatedEffort: "30 minutes",
        expectedImpact: "high",
        description:
          "Name the audience and the outcome in the H1 so a first-time visitor can self-qualify.",
      },
    ],
    actions: [
      {
        id: "act-1",
        title: "Draft three hero headline variants",
        description:
          "Write three H1 options that each name the audience and the outcome.",
        priority: "high",
        estimatedEffort: "30 minutes",
        expectedOutcome: "Clearer positioning for first-time visitors",
      },
    ],
  };
}

const store = new AuditEvidenceStore();
store.record(
  page({
    h1s: ["Get paid on time"],
    navLabels: ["Docs", "About"],
    bodyText: "Automatic reminders chase late invoices for you.",
  })
);

// A verified quote passes.
const okResult = validateReportEvidence(report([blindspot()]), store);
assert.equal(okResult.ok, true, okResult.errors.join(" | "));

// A fabricated quote is rejected.
const fabricated = validateReportEvidence(
  report([
    blindspot({
      description:
        'The homepage claims "Trusted by over 10,000 teams worldwide" with no supporting proof anywhere.',
    }),
  ]),
  store
);
assert.equal(fabricated.ok, false);
assert.ok(fabricated.errors[0].includes("does not appear on any fetched page"));
assert.deepEqual(fabricated.droppedFindingIds, ["bs-1"]);

// A visual claim is rejected even with no quote at all.
const visual = validateReportEvidence(
  report([
    blindspot({
      description:
        "Mobile navigation is cramped and the touch targets are far below the recommended size for thumbs.",
    }),
  ]),
  store
);
assert.equal(visual.ok, false);
assert.ok(visual.errors[0].includes("visual/rendered property"));

// An absence claim about a page that failed to fetch is rejected.
const withFailure = new AuditEvidenceStore();
withFailure.record(page({ h1s: ["Get paid on time"], bodyText: "Some copy." }));
withFailure.record(
  page({
    url: "https://acme.test/pricing",
    outcome: "http_error",
    httpStatus: 500,
    error: "Could not access website (HTTP 500)",
  })
);

const absence = validateReportEvidence(
  report([
    blindspot({
      description:
        "There is no pricing table at https://acme.test/pricing, so buyers cannot evaluate cost before signing up.",
    }),
  ]),
  withFailure
);
assert.equal(absence.ok, false);
assert.ok(absence.errors[0].includes("failed to fetch"));

// No usable evidence at all → cannot produce a report.
const empty = new AuditEvidenceStore();
empty.record(
  page({ outcome: "network_error", error: "timeout", bodyText: "" })
);
const noEvidence = validateReportEvidence(report([blindspot()]), empty);
assert.equal(noEvidence.ok, false);
assert.ok(
  noEvidence.errors.some((error) =>
    error.includes("No page content was retrieved")
  )
);

console.log("claim-rules tests passed");
