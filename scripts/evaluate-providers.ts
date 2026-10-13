/**
 * Live provider evaluation harness.
 *
 * Runs a real audit against real public websites and reports, per provider:
 * factual support, specificity, completeness, latency, token usage and failures.
 *
 * This is a LIVE test — it makes paid/metered API calls. It does not write to
 * the database unless one is configured; usage recording degrades to a no-op.
 *
 *   npx tsx scripts/evaluate-providers.ts                     # default sites
 *   npx tsx scripts/evaluate-providers.ts groq nvidia         # pick providers
 *   REVEL_EVAL_SITES=https://a.com,https://b.com npx tsx ...  # pick sites
 */
import { config } from "dotenv";

// The project keeps local credentials in .env.local, not .env.
config({ path: ".env.local" });
config({ path: ".env" });
import { AuditEvidenceStore } from "@/lib/audit/evidence";
import { runWithEvidenceStore } from "@/lib/audit/evidence-context";
import { findVisualClaims } from "@/lib/audit/claim-rules";
import { runWithAuditUsageContext } from "@/lib/ai-usage/recorder";
import { runGroqAgent } from "@/services/groq-agent";
import { runNvidiaAgent } from "@/services/nvidia-agent";
import { runGeminiAgent } from "@/services/gemini-agent";
import type { AnalysisReport } from "@/types/analysis";

const DEFAULT_SITES = [
  "https://example.com", // minimal — should produce FEW findings
  "https://vercel.com", // large marketing site
  "https://news.ycombinator.com", // text-dense, non-marketing
];

type ProviderName = "groq" | "nvidia" | "gemini";

const RUNNERS: Record<ProviderName, (url: string) => Promise<AnalysisReport>> = {
  groq: runGroqAgent,
  nvidia: runNvidiaAgent,
  gemini: runGeminiAgent,
};

function keyFor(provider: ProviderName): string | undefined {
  if (provider === "groq") return process.env.GROQ_API_KEY;
  if (provider === "nvidia") return process.env.NVIDIA_API_KEY;
  return process.env.GEMINI_API_KEY;
}

interface Result {
  provider: ProviderName;
  site: string;
  ok: boolean;
  latencyMs: number;
  error?: string;
  findings?: number;
  measured?: number;
  observed?: number;
  inferred?: number;
  verifiedQuotes?: number;
  unverifiedQuotes?: number;
  visualClaims?: number;
  pagesFetched?: number;
  pagesFailed?: number;
  score?: number;
  schemaVersion?: number;
}

async function evaluate(
  provider: ProviderName,
  site: string
): Promise<Result> {
  const store = new AuditEvidenceStore();
  const startedAt = Date.now();

  try {
    const report = await runWithAuditUsageContext(
      { website: site },
      () => runWithEvidenceStore(store, () => RUNNERS[provider](site))
    );

    const latencyMs = Date.now() - startedAt;
    const coverage = store.coverage();

    let measured = 0;
    let observed = 0;
    let inferred = 0;
    let verifiedQuotes = 0;
    let unverifiedQuotes = 0;
    let visualClaims = 0;

    for (const finding of report.blindspots) {
      for (const item of finding.evidence ?? []) {
        if (item.basis === "measured") measured++;
        else if (item.basis === "observed") observed++;
        else inferred++;

        if (item.quote) {
          if (store.containsQuote(item.quote)) verifiedQuotes++;
          else unverifiedQuotes++;
        }
      }
      visualClaims += findVisualClaims({
        title: finding.title,
        description: finding.description,
        suggestedFix: finding.suggestedFix,
      }).length;
    }

    return {
      provider,
      site,
      ok: true,
      latencyMs,
      findings: report.blindspots.length,
      measured,
      observed,
      inferred,
      verifiedQuotes,
      unverifiedQuotes,
      visualClaims,
      pagesFetched: coverage.pagesFetched,
      pagesFailed: coverage.pagesFailed,
      score: report.score,
      schemaVersion: report.schemaVersion,
    };
  } catch (error) {
    return {
      provider,
      site,
      ok: false,
      latencyMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
      pagesFetched: store.coverage().pagesFetched,
      pagesFailed: store.coverage().pagesFailed,
    };
  }
}

async function main() {
  const requested = process.argv.slice(2).filter((a) => !a.startsWith("-"));
  const providers = (
    requested.length > 0 ? requested : ["groq"]
  ) as ProviderName[];

  const sites = process.env.REVEL_EVAL_SITES
    ? process.env.REVEL_EVAL_SITES.split(",").map((s) => s.trim())
    : DEFAULT_SITES;

  console.log("Revel live provider evaluation");
  console.log("Providers:", providers.join(", "));
  console.log("Sites:", sites.join(", "));
  console.log("");

  const results: Result[] = [];

  for (const provider of providers) {
    if (!keyFor(provider)) {
      console.log(`SKIP ${provider}: no API key configured`);
      continue;
    }
    for (const site of sites) {
      process.stdout.write(`run ${provider} ${site} ... `);
      const result = await evaluate(provider, site);
      results.push(result);
      console.log(
        result.ok
          ? `ok ${result.latencyMs}ms findings=${result.findings} measured=${result.measured} inferred=${result.inferred} unverifiedQuotes=${result.unverifiedQuotes} visualClaims=${result.visualClaims} pages=${result.pagesFetched}/${(result.pagesFetched ?? 0) + (result.pagesFailed ?? 0)}`
          : `FAILED ${result.latencyMs}ms — ${result.error?.slice(0, 160)}`
      );
    }
  }

  console.log("\n--- summary ---");
  console.table(
    results.map((r) => ({
      provider: r.provider,
      site: r.site.replace(/^https?:\/\//, "").slice(0, 28),
      ok: r.ok,
      ms: r.latencyMs,
      score: r.score ?? "",
      findings: r.findings ?? "",
      measured: r.measured ?? "",
      inferred: r.inferred ?? "",
      badQuotes: r.unverifiedQuotes ?? "",
      visual: r.visualClaims ?? "",
      pages: r.ok ? `${r.pagesFetched}/${(r.pagesFetched ?? 0) + (r.pagesFailed ?? 0)}` : "",
      schema: r.schemaVersion ?? "",
    }))
  );

  const badQuotes = results.reduce((n, r) => n + (r.unverifiedQuotes ?? 0), 0);
  const visual = results.reduce((n, r) => n + (r.visualClaims ?? 0), 0);
  console.log(
    `\nIntegrity gates — unverified quotes in accepted reports: ${badQuotes} (must be 0); visual claims: ${visual} (must be 0)`
  );
  process.exit(badQuotes === 0 && visual === 0 ? 0 : 1);
}

void main();
