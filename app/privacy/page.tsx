import type { Metadata } from "next";
import Link from "next/link";
import { Navbar } from "@/components/landing/navbar";
import { Footer } from "@/components/landing/footer";
import { PageSeo } from "@/components/seo/page-seo";
import { createPageMetadata } from "@/lib/seo/metadata";
import { siteConfig } from "@/lib/site-config";

const title = "Privacy Policy";
const description =
  "How Revel and BlindspotLab collect, use, and protect your data — including OAuth export integrations for Linear, Notion, and GitHub.";

export const metadata: Metadata = createPageMetadata({
  title,
  description,
  path: "/privacy",
  keywords: [
    "privacy policy",
    "data protection",
    "Revel privacy",
    "OAuth integrations",
  ],
});

export default function PrivacyPage() {
  return (
    <>
      <PageSeo title={title} description={description} path="/privacy" />
      <Navbar />
      <main className="mx-auto max-w-2xl px-6 py-32">
        <h1 className="font-heading text-4xl font-semibold">Privacy Policy</h1>
        <p className="mt-4 text-muted">Last updated: October 24, 2026</p>

        <div className="prose-revel mt-12 space-y-8 text-muted">
          <section>
            <h2 className="font-heading text-xl font-semibold text-foreground">
              Overview
            </h2>
            <p className="mt-3 leading-relaxed">
              Revel (&quot;we&quot;, &quot;us&quot;) is operated by BlindspotLab. This
              policy explains what we collect when you use {siteConfig.url},
              Mission Control, Partner API, MCP endpoints, OKX.AI marketplace
              integrations, and optional export connections (Linear, Notion,
              GitHub). We do not sell your personal data. We design exports so
              your reports are not written into a shared BlindspotLab workspace
              that other customers can browse.
            </p>
          </section>

          <section>
            <h2 className="font-heading text-xl font-semibold text-foreground">
              What we collect
            </h2>
            <ul className="mt-3 list-disc space-y-2 pl-5 leading-relaxed">
              <li>
                <strong className="text-foreground">Account data:</strong> email
                address, display name, optional username, profile image (e.g.
                from Google), and authentication identifiers when you sign in.
              </li>
              <li>
                <strong className="text-foreground">Analysis data:</strong>{" "}
                website URLs you submit, generated reports (Reveal Index,
                blindspots, Blueprint, Action Queue), and analysis status —
                stored against your account so you can reopen history.
              </li>
              <li>
                <strong className="text-foreground">Usage data:</strong> audit
                counts, API/MCP call metadata, partner platform identifiers, and
                activity events for rate limiting and admin analytics.
              </li>
              <li>
                <strong className="text-foreground">
                  Export connection metadata:
                </strong>{" "}
                if you connect Linear, Notion, or GitHub, we store encrypted
                OAuth tokens and non-secret labels (e.g. team name, workspace
                name, GitHub login) needed to run exports on your behalf. See{" "}
                <em>Export integrations (OAuth)</em> below.
              </li>
              <li>
                <strong className="text-foreground">Partner applications:</strong>{" "}
                platform name, contact email, domain, and optional notes when you
                apply for Partner API access.
              </li>
              <li>
                <strong className="text-foreground">Payment metadata:</strong>{" "}
                when you use OKX x402 billing, transaction references are
                processed by OKX — we do not store private keys or full wallet
                credentials.
              </li>
              <li>
                <strong className="text-foreground">Technical data:</strong> IP
                address, browser type, and request logs for security and abuse
                prevention (via hosting provider).
              </li>
            </ul>
          </section>

          <section>
            <h2 className="font-heading text-xl font-semibold text-foreground">
              How we use your data
            </h2>
            <p className="mt-3 leading-relaxed">
              We use collected data to run product audits, store your analysis
              history, enforce weekly usage limits, operate the Partner API,
              process marketplace payments, send transactional emails (account
              welcome, password reset, partner approval), run optional exports
              you request into <em>your</em> connected tools, and improve Revel.
              Public website content you submit for analysis is sent to our AI
              providers for processing and retained as part of your report.
            </p>
          </section>

          <section>
            <h2 className="font-heading text-xl font-semibold text-foreground">
              Export integrations (OAuth)
            </h2>
            <p className="mt-3 leading-relaxed">
              Markdown, JSON, and GitHub-flavored Markdown downloads stay on your
              device. Cloud exports to Linear, Notion, or GitHub Gist use{" "}
              <strong className="text-foreground">
                per-user OAuth connections
              </strong>
              : you authorize Revel to act in your account, and we create content
              there. Other Revel users cannot open those exports unless you share
              the link or grant them access in that product.
            </p>
            <p className="mt-3 leading-relaxed">
              When you connect an integration, Revel requests only the access
              needed for export:
            </p>
            <ul className="mt-3 list-disc space-y-2 pl-5 leading-relaxed">
              <li>
                <strong className="text-foreground">Linear:</strong> read and
                write access sufficient to create issues (including{" "}
                <code className="text-foreground">read</code>,{" "}
                <code className="text-foreground">write</code>, and{" "}
                <code className="text-foreground">issues:create</code>). We create
                issues in a team on your Linear workspace from your Action Queue.
              </li>
              <li>
                <strong className="text-foreground">Notion:</strong> OAuth access
                to content you share with the Revel integration. We create a
                Blueprint page under a page or database you make available to the
                integration. We do not publish your Notion workspace publicly.
              </li>
              <li>
                <strong className="text-foreground">GitHub:</strong>{" "}
                <code className="text-foreground">gist</code> scope only, to
                create a <strong className="text-foreground">private</strong>{" "}
                Gist under your GitHub account. Only you can see it unless you
                change visibility or share the URL.
              </li>
            </ul>
            <p className="mt-3 leading-relaxed">
              OAuth access tokens are stored{" "}
              <strong className="text-foreground">encrypted at rest</strong>{" "}
              (AES-256-GCM) using a server-side encryption key. You can disconnect
              an integration at any time under Mission Control → Integrations,
              which deletes the stored tokens for that provider from our
              database. Revoking access in Linear, Notion, or GitHub also stops
              further exports until you reconnect.
            </p>
            <p className="mt-3 leading-relaxed">
              We do not use your Linear, Notion, or GitHub connections to browse
              unrelated data for advertising, sell access tokens, or write
              exports into a shared BlindspotLab database visible to other
              customers.
            </p>
          </section>

          <section>
            <h2 className="font-heading text-xl font-semibold text-foreground">
              Partner API &amp; other integrations
            </h2>
            <p className="mt-3 leading-relaxed">
              Approved partners receive API keys stored as hashed values on our
              servers. Partners may only access analysis reports they initiated
              via the Partner API. Partner platforms (e.g. Arcapush) are
              responsible for how they display Revel insights to their users and
              for securing API keys on their servers.
            </p>
          </section>

          <section>
            <h2 className="font-heading text-xl font-semibold text-foreground">
              Third-party services
            </h2>
            <ul className="mt-3 list-disc space-y-2 pl-5 leading-relaxed">
              <li>Google OAuth &amp; NextAuth (authentication)</li>
              <li>Supabase / PostgreSQL (data storage)</li>
              <li>OpenRouter (AI analysis)</li>
              <li>Linear, Notion, and GitHub (optional export destinations you connect)</li>
              <li>OKX Onchain OS / x402 (agent marketplace payments)</li>
              <li>Resend (transactional email)</li>
              <li>Cloudflare Workers (hosting)</li>
              <li>Plausible (optional, privacy-friendly analytics)</li>
            </ul>
            <p className="mt-3 leading-relaxed">
              Each provider operates under its own privacy policy. When you
              export to Linear, Notion, or GitHub, content in those products is
              also governed by their terms and privacy policies.
            </p>
          </section>

          <section>
            <h2 className="font-heading text-xl font-semibold text-foreground">
              Data retention &amp; deletion
            </h2>
            <p className="mt-3 leading-relaxed">
              Analysis reports are retained while your account exists so you can
              access history and re-export. OAuth tokens are kept until you
              disconnect the integration or delete your account. Partner activity
              logs are retained for operational analytics. You may request
              account deletion by contacting us; we will remove personal
              identifiers and stored connection tokens where technically
              feasible. Content already created in your Linear, Notion, or
              GitHub accounts remains under your control there.
            </p>
          </section>

          <section>
            <h2 className="font-heading text-xl font-semibold text-foreground">
              Your rights
            </h2>
            <p className="mt-3 leading-relaxed">
              Depending on your jurisdiction, you may request access, correction,
              or deletion of personal data we hold, and you may disconnect
              integrations at any time. Contact us using the details below.
            </p>
          </section>

          <section>
            <h2 className="font-heading text-xl font-semibold text-foreground">
              Contact
            </h2>
            <p className="mt-3 leading-relaxed">
              Questions about privacy? Email{" "}
              <a
                href={`mailto:${siteConfig.organization.email}`}
                className="text-primary hover:underline"
              >
                {siteConfig.organization.email}
              </a>{" "}
              or visit our{" "}
              <Link href="/contact" className="text-primary hover:underline">
                contact page
              </Link>
              .
            </p>
          </section>
        </div>
      </main>
      <Footer />
    </>
  );
}
