import assert from "node:assert/strict";
import { AuditEvidenceStore, type PageEvidence } from "@/lib/audit/evidence";
import { ensureFindingEvidence, validateReportEvidence } from "@/lib/report-schema";
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

const store = new AuditEvidenceStore();
store.record(
  page({
    h1s: ["Ship your product faster"],
    ctas: ["Start free"],
    bodyText: "Deploy in seconds with zero configuration required.",
  })
);

function finding(overrides: Partial<Blindspot> = {}): Blindspot {
  return {
    id: "bs-1",
    title: "Headline does not name the audience",
    priority: "high",
    category: "messaging",
    description:
      "The hero headline never names who the product is for, so a first-time visitor cannot self-qualify quickly.",
    suggestedFix:
      "Rewrite the H1 to name the audience and the outcome in a single sentence, then add a supporting subhead.",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// A quote the pipeline could NOT confirm must never be labelled "measured",
// no matter what the model asserted. Short quotes bypass the length guard in
// validation, so the basis downgrade is the only thing standing between an
// unverifiable string and a report that presents it as a measurement.
// ---------------------------------------------------------------------------
const shortUnverifiable = ensureFindingEvidence(
  finding({
    evidence: [{ basis: "measured", quote: "Sign up", sourceUrl: "https://acme.test" }],
  }),
  store
);
assert.equal(shortUnverifiable.length, 1);
assert.notEqual(
  shortUnverifiable[0].basis,
  "measured",
  'an unverifiable quote must not be labelled "measured"'
);
assert.equal(shortUnverifiable[0].basis, "inferred");
assert.ok(
  shortUnverifiable[0].note?.includes("not verified"),
  "the downgrade must be explained in the evidence note"
);

// A short quote that DOES appear on the page is still not trusted as a
// measurement — it is too short to match uniquely — but it is kept.
const shortPresent = ensureFindingEvidence(
  finding({ evidence: [{ basis: "measured", quote: "Deploy" }] }),
  store
);
assert.notEqual(shortPresent[0].basis, "measured");

// A long, genuinely verifiable quote is promoted to "measured".
const verifiable = ensureFindingEvidence(
  finding({
    evidence: [{ basis: "observed", quote: "Ship your product faster" }],
  }),
  store
);
assert.equal(verifiable[0].basis, "measured");

// A model claiming "measured" with no quote at all keeps no measurement claim.
const noQuote = ensureFindingEvidence(
  finding({ evidence: [{ basis: "measured", note: "trust me" }] }),
  store
);
assert.notEqual(
  noQuote[0].basis,
  "measured",
  "a measurement claim with no quote cannot be verified"
);

// ---------------------------------------------------------------------------
// Long fabricated quotes are still rejected outright.
// ---------------------------------------------------------------------------
function report(blindspots: Blindspot[]): AnalysisReport {
  return {
    score: 70,
    summary:
      "acme.test presents a developer tool but the homepage copy never names the audience or the pricing model anywhere on the page.",
    blindspots,
    blueprint: [
      {
        id: "bp-1",
        step: 1,
        title: "Rewrite the hero headline",
        estimatedEffort: "30 minutes",
        expectedImpact: "high",
        description:
          "Name the audience and the outcome in the H1 so a visitor can self-qualify.",
      },
    ],
    actions: [
      {
        id: "act-1",
        title: "Draft three headline variants",
        description: "Write three H1 options naming audience and outcome.",
        priority: "high",
        estimatedEffort: "30 minutes",
        expectedOutcome: "Clearer positioning for first-time visitors",
      },
    ],
  };
}

const fabricated = validateReportEvidence(
  report([
    finding({
      evidence: [
        { basis: "measured", quote: "Trusted by over 10,000 engineering teams" },
      ],
    }),
  ]),
  store
);
assert.equal(fabricated.ok, false, "a long fabricated quote must be rejected");

// A short unverifiable quote does not reject the report, but must be reported
// as a warning so the downgrade is visible rather than silent.
const shortQuoteReport = validateReportEvidence(
  report([finding({ evidence: [{ basis: "measured", quote: "Sign up" }] })]),
  store
);
assert.equal(shortQuoteReport.ok, true);
assert.ok(
  shortQuoteReport.warnings.some((w) => w.includes("too short")),
  "short unverifiable quotes must raise a warning"
);

console.log("quote-basis tests passed");
