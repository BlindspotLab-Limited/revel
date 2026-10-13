import assert from "node:assert/strict";
import { AuditEvidenceStore, type PageEvidence } from "@/lib/audit/evidence";
import { parseHtml } from "@/services/content-extractor";

function evidence(overrides: Partial<PageEvidence> = {}): PageEvidence {
  return {
    url: "https://example.com",
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
// Regression: navigation labels were extracted AFTER `nav` was removed from
// the DOM, so `$("nav a")` could never match and Nav evidence was always empty.
// ---------------------------------------------------------------------------
const navHtml = `
<html>
  <head><title>Acme Billing</title><meta name="description" content="Invoicing for freelancers" /></head>
  <body>
    <nav><a href="/pricing">Pricing</a><a href="/docs">Docs</a><a href="/about">About</a></nav>
    <main><h1>Get paid on time</h1><h2>Automatic reminders</h2><p>Body copy here.</p></main>
    <footer><a href="/legal">Legal</a></footer>
  </body>
</html>`;

const parsed = parseHtml(navHtml);
assert.deepEqual(parsed.navLabels, ["Pricing", "Docs", "About"]);
assert.deepEqual(parsed.footerLabels, ["Legal"]);
assert.equal(parsed.title, "Acme Billing");
assert.equal(parsed.metaDescription, "Invoicing for freelancers");
assert.deepEqual(parsed.h1s, ["Get paid on time"]);
// Body text must still have nav/footer chrome stripped out.
assert.ok(parsed.bodyText.includes("Body copy here."));
assert.ok(!parsed.bodyText.includes("Legal"));

// ---------------------------------------------------------------------------
// Quote verification
// ---------------------------------------------------------------------------
const store = new AuditEvidenceStore();
store.record(
  evidence({
    url: "https://example.com",
    h1s: ["Get paid on time"],
    navLabels: ["Pricing", "Docs"],
    bodyText: "Automatic reminders chase late invoices for you.",
  })
);

assert.equal(store.containsQuote("Get paid on time"), true);
// Whitespace and case differences must not defeat matching.
assert.equal(store.containsQuote("  get   PAID on time "), true);
assert.equal(store.containsQuote("Automatic reminders chase late invoices"), true);
// Fabricated quote must not verify.
assert.equal(store.containsQuote("Trusted by 10,000 companies"), false);
// Too short to be meaningful → not treated as verified.
assert.equal(store.containsQuote("paid"), false);

assert.equal(store.hasUsableEvidence(), true);
assert.equal(store.coverage().pagesFetched, 1);
assert.equal(store.coverage().pagesFailed, 0);
assert.equal(store.coverage().visualEvidenceAvailable, false);

// ---------------------------------------------------------------------------
// A failed fetch is recorded as evidence of a failure, never as empty content
// ---------------------------------------------------------------------------
const failing = new AuditEvidenceStore();
failing.record(
  evidence({
    url: "https://example.com/pricing",
    outcome: "http_error",
    httpStatus: 503,
    error: "Could not access website (HTTP 503)",
    bodyText: "",
  })
);

assert.equal(failing.hasUsableEvidence(), false);
assert.equal(failing.coverage().pagesFailed, 1);
assert.equal(failing.coverage().pagesFetched, 0);
assert.ok(failing.fetchFailedFor("https://example.com/pricing"));
assert.equal(failing.fetchFailedFor("https://example.com/other"), undefined);
// Nothing from a failed page is quotable.
assert.equal(failing.containsQuote("Could not access website"), false);

const mixed = new AuditEvidenceStore();
mixed.record(evidence({ url: "https://a.test", bodyText: "Homepage copy that is long enough." }));
mixed.record(
  evidence({ url: "https://a.test/pricing", outcome: "network_error", error: "timeout", bodyText: "" })
);
assert.equal(mixed.coverage().pagesAttempted, 2);
assert.equal(mixed.coverage().pagesFetched, 1);
assert.equal(mixed.coverage().pagesFailed, 1);
assert.deepEqual(mixed.coverage().sources, ["https://a.test"]);
assert.equal(mixed.coverage().failures[0]?.url, "https://a.test/pricing");

console.log("evidence tests passed");
