import type { Metadata } from "next";
import Link from "next/link";
import {
  DocCode,
  DocSection,
  DocsArticle,
} from "@/components/docs/docs-article";
import { MarketingPage } from "@/components/landing/marketing-page";
import { PageSeo } from "@/components/seo/page-seo";
import { getOkxAuditPriceUsd } from "@/lib/billing/okx-x402";
import { createPageMetadata } from "@/lib/seo/metadata";
import { siteConfig } from "@/lib/site-config";

const title = "OKX Ecosystem";
const description =
  "List Revel on OKX.AI, accept x402 payments, and connect via Onchain OS.";
const path = "/docs/ecosystem";
const base = siteConfig.url;

export const metadata: Metadata = createPageMetadata({
  title,
  description,
  path,
  keywords: ["OKX.AI", "Onchain OS", "x402", "A2MCP", "agent marketplace"],
});

export default function EcosystemDocsPage() {
  const price = getOkxAuditPriceUsd();

  return (
    <MarketingPage>
      <PageSeo title={title} description={description} path={path} />
      <DocsArticle
        title={title}
        description={description}
        path={path}
        related={[
          { href: "/docs/mcp", label: "MCP / A2MCP" },
          { href: "/docs/partners", label: "Partner API" },
          { href: "/partners", label: "Apply for Partner API" },
        ]}
      >
        <DocSection title="Revel on OKX.AI">
          <p>
            Revel is registered as an Agent Service Provider (ASP) on OKX.AI with
            A2MCP tools for website audits. Agents discover Revel on the
            marketplace and pay per completed audit.
          </p>
          <ul className="list-disc space-y-2 pl-5">
            <li>Agent ID: <strong className="text-foreground">#4750</strong></li>
            <li>Category: A2MCP / Software Services</li>
            <li>Endpoint: <code>{base}/api/mcp</code></li>
            <li>Manifest: <code>{base}/api/mcp/manifest</code></li>
            <li>Price: ${price.toFixed(2)} USDT0 per audit (X Layer)</li>
          </ul>
        </DocSection>

        <DocSection title="Agent Payments Protocol (x402)">
          <p>
            Revel uses the <strong className="text-foreground">OKX Agent Payments Protocol</strong>{" "}
            (x402) on <code>POST /api/mcp</code>. MCP handshake and discovery stay free (
            <code>initialize</code>, <code>tools/list</code>, health, poll, export). Payment is
            required only when starting a billable audit (
            <code>revel_analyze_website</code> / <code>revel_analyze_website_and_wait</code>
            ). Unpaid billable calls return{" "}
            <strong className="text-foreground">402</strong> with{" "}
            <code>PAYMENT-REQUIRED</code>. Development bypass:{" "}
            <code>MCP_API_KEY</code> in Authorization header.
          </p>
          <p>Alternate paid HTTP route: <code>POST /api/audit</code> with JSON body <code>{`{ "url": "..." }`}</code>.</p>
        </DocSection>

        <DocSection title="Operator checklist">
          <ol className="list-decimal space-y-2 pl-5">
            <li>Register ASP on Onchain OS (Agentic Wallet)</li>
            <li>Set OKX API keys + <code>OKX_PAY_TO</code> as Cloudflare Worker secrets</li>
            <li>
              Ensure free methods work without payment; billable{" "}
              <code>tools/call</code> returns 402 without payment
            </li>
            <li>Submit listing for review; wait for approval email</li>
            <li>Test with <code>npx tsx scripts/test-mcp-marketplace-flow.ts</code></li>
          </ol>
        </DocSection>

        <DocSection title="Required env (Revel production)">
          <DocCode>{`OKX_API_KEY=
OKX_SECRET_KEY=
OKX_PASSPHRASE=
OKX_PAY_TO=0x...          # Agentic Wallet on X Layer
OKX_AUDIT_PRICE_USD=${price.toFixed(2)}
MCP_API_KEY=              # dev / testing bypass`}</DocCode>
        </DocSection>

        <DocSection title="External resources">
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <a href="https://web3.okx.com/help/section/onchain-os" className="text-primary hover:underline" target="_blank" rel="noopener noreferrer">
                Onchain OS documentation
              </a>
            </li>
            <li>
              <a href="https://web3.okx.com/ai/home" className="text-primary hover:underline" target="_blank" rel="noopener noreferrer">
                OKX.AI marketplace
              </a>
            </li>
            <li>
              <a href="https://www.okx.com" className="text-primary hover:underline" target="_blank" rel="noopener noreferrer">
                OKX
              </a>
            </li>
          </ul>
        </DocSection>

        <DocSection title="Partner API vs marketplace">
          <p>
            <strong className="text-foreground">OKX.AI MCP</strong> — agents pay per audit via x402; best for AI agent discovery.
          </p>
          <p>
            <strong className="text-foreground">Partner API</strong> — your platform embeds Revel with <code>rvl_pk_</code> keys; best for Arcapush-style integrations. See{" "}
            <Link href="/docs/partners" className="text-primary hover:underline">
              Partner API docs
            </Link>
            .
          </p>
        </DocSection>
      </DocsArticle>
    </MarketingPage>
  );
}