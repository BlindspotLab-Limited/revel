# Stack Brief - Revel

Last updated: 2026-10-22

## Overview

Revel is an AI product-strategist web app: paste a public website URL, get a scored **Reveal Index**, Blindspot Map, Blueprint, and Action Queue. Architecture is a Next.js full-stack app on Cloudflare Workers (OpenNext) with Postgres (Supabase via Hyperdrive/Prisma), multi-provider LLM analysis (agentic tool-use cascade), and an MCP/A2MCP surface with OKX x402 billing for agent marketplace payments. Exports go to Markdown/JSON and optional per-user OAuth destinations (Linear, Notion, GitHub Gist).

## Frontend

- **Framework:** Next.js 16 (App Router), React 19, TypeScript 5
- **Styling:** Tailwind CSS 4, Framer Motion, Radix UI primitives, Lucide icons
- **State management:** Server Components + route handlers; client session via `next-auth/react` (no global client store)
- **Analytics:** Plausible (`components/analytics.tsx`)

## Backend / API

- **Framework/runtime:** Next.js Route Handlers on Cloudflare Workers (`nodejs_compat`, OpenNext adapter)
- **API style:** REST JSON under `app/api/*`
- **Notable routes:** `/api/analyze` (async audit job), `/api/report/[id]`, Partner API `/api/partner/v1/*`, MCP `/api/mcp` + manifest, paid `/api/audit` (x402), export `/api/export`, OAuth integrations, auth signup/reset
- **Background work:** Cloudflare Workflow `revel-audit` (durable, one instance per analysis); `after()` on Node.js

## Data Layer

- **Database:** PostgreSQL hosted on Supabase
- **ORM:** Prisma 7 (`@prisma/client`, `@prisma/adapter-pg`)
- **Schema:** `prisma/schema.prisma` + SQL helpers under `supabase/`
- **Connection pooling:** Cloudflare Hyperdrive (binding `HYPERDRIVE`, caching off)
- **Cache/queue:** None dedicated; Workers Rate Limiting bindings + in-process windows, weekly audit counters

## Infra / Deploy

- **Hosting:** Cloudflare Workers, one Worker `revel` (`wrangler.jsonc`, OpenNext `@opennextjs/cloudflare`)
- **CI/CD:** Cloudflare Workers Builds from `main` (`npm run build:cloudflare` / `npm run deploy:cloudflare`)
- **Cron:** Cloudflare cron trigger `0 6 * * *` → `/api/indexnow`
- **Security headers:** `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`

## Auth

- **Provider:** NextAuth v5 (Auth.js) — Google OAuth + email/password (bcrypt)
- **Hosts:** canonical auth subdomain pattern (`AUTH_URL` / `NEXTAUTH_URL`, e.g. `auth.tryrevel.xyz`)
- **Profile:** username/display name, password reset via Resend email

## Blockchain / Web3

- **Chain(s):** X Layer (`eip155:196`) for OKX Onchain OS / x402 settlement
- **Contracts / assets:** USDT0 token address used in billing config; no in-repo Solidity
- **Client library:** OKX seller SDKs `@okxweb3/app-x402-core`, `@okxweb3/app-x402-evm`, `@okxweb3/app-x402-next`
- **Purpose:** HTTP 402 paywall on A2MCP and audit routes; facilitator client with sync settle
- **Why this choice:** Matches OKX.AI ASP marketplace payment path (x402 / Agent Payments Protocol) without running a custom chain stack

## AI Model Layer

- **Provider(s):** Groq, OpenRouter, Google AI Studio (Gemini)
- **Model(s) (defaults / production pins):**
  - Groq primary: `llama-3.3-70b-versatile`
  - Groq fallback: `llama-3.1-8b-instant` (scout model removed; not available on free/dev tier)
  - OpenRouter: env-pinned (e.g. `anthropic/claude-3.5-sonnet` with fallbacks such as `google/gemini-2.5-flash`)
  - Gemini last: `gemini-2.5-flash` → `gemini-2.5-flash-lite`
- **Routing:** Custom multi-provider cascade in `services/agentic-analysis.ts` + `lib/analysis-provider.ts` — **Groq → OpenRouter → Gemini** on recoverable failures (quota, incomplete report, API errors)
- **Client error policy:** Upstream provider/model/org detail logged server-side only; UI gets generic gateway messages (`lib/safe-client-error.ts`)
- **Why this choice:** Groq for fast tool-calling free tier; OpenRouter for stronger single-shot grounded JSON; Gemini last due to tight free quota

## Agents / Orchestration

- **Framework:** Custom agent loop (not LangChain/CrewAI) — `services/groq-agent.ts`, `services/gemini-agent.ts`
- **Architecture:** Single-agent tool-use over the target website; multi-step until `submit_analysis_report`
- **Tools exposed:** `fetch_url`, `discover_internal_links`, `submit_analysis_report` (`services/agent-tools.ts`)
- **Page evidence:** Cheerio extraction (`services/content-extractor.ts`) — title, meta, headings, CTAs, nav, body text
- **MCP / A2MCP:** `@modelcontextprotocol/sdk` streamable HTTP at `/api/mcp` (+ stdio script); selective x402 on billable tools only (`lib/mcp/payment-gate.ts`)
- **Memory:** No long-term agent memory store; each audit is a fresh run

## Evals / Observability

- **Tracing:** Custom activity/event logging (`lib/activity.ts`, `lib/logger.ts`); no LangSmith/Helicone detected
- **Eval / quality gates:** Zod schemas + `normalizeAnalysisReport` / `isCompleteReport` — reject empty shells, title-only blindspots, and placeholder fixes (`lib/report-schema.ts`)
- **Guardrails:** Structured JSON report contract; agent resubmit on incomplete reports; SSRF-aware fetch helpers

## Integrations / Product surfaces

- **Exports:** Markdown/JSON + per-user OAuth to Linear, Notion, GitHub Gist (AES-GCM token encryption)
- **Partner API:** API keys (`rvl_pk_`) for server-side audits
- **Email:** Resend (welcome, partner, password reset)
- **OKX ASP:** Marketplace identity/services separate from app deploy (agent #4750, endpoint `https://tryrevel.xyz/api/mcp`)

## Prompt Engineering

- **Prompt Engineering by:** Mojeeb Titilayo
- **Optimized by:** Claude and Grok Build CLI (same product workstream; Mojeeb authored the original system/user prompts; Claude and Grok Build CLI used for iteration)
- **Optimization notes:**
  - Multi-provider cascade (Groq → OpenRouter → Gemini) for reliability and quota
  - Site-grounding prompts (quote page copy; ban generic “review this area” fixes)
  - Completeness gates (min blindspots/blueprint/actions, category/priority diversity)
  - Client-safe error sanitization so provider/model failures do not leak stack fingerprints to the UI
  - A2MCP payment gate: free discovery methods, paid only on billable audit tools
