# Revel — development

Setup, configuration, migrations and deployment for people working on the
codebase. Product documentation for Revel's users lives in
[../README.md](../README.md).

**No secret value belongs in this file.** Only variable *names* are listed.
Real values go in `.env.local` (git-ignored) or the Vercel project settings.

---

## Prerequisites

- Node.js 20+
- Accounts as needed: [Groq](https://console.groq.com) or
  [Google AI Studio](https://aistudio.google.com),
  [OpenRouter](https://openrouter.ai),
  [NVIDIA build portal](https://build.nvidia.com),
  [Google Cloud Console](https://console.cloud.google.com) (OAuth),
  [Supabase](https://supabase.com), optional [Resend](https://resend.com)

## Setup

```bash
git clone https://github.com/Blindspotlabxyz/revel.git
cd revel
npm install

cp .env.example .env.local
npm run env:merge          # append any missing keys
# Fill values in .env.local — never commit this file

npm run db:setup           # verify database connection
npm run dev                # http://localhost:3000
```

Configure Google OAuth and set `AUTH_SECRET` / `NEXTAUTH_*` / `GOOGLE_*` in
`.env.local`.

## Scripts

| Command | Purpose |
|---------|---------|
| `npm run dev` | Dev server (webpack) |
| `npm run build` | Production build (+ IndexNow ping on Vercel) |
| `npm test` | Run every `*.test.ts` via tsx |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | Next lint |
| `npm run env:merge` | Sync missing keys from `.env.example` → `.env.local` |
| `npm run db:setup` | Test DB connectivity |
| `npm run db:migrate` | Prisma migrate (development only) |
| `npm run mcp` | Local MCP stdio server |
| `npm run test:mcp:http` | Exercise the MCP HTTP transport |
| `npm run verify:okx-billing` | Check the OKX payment SDK wiring |
| `npm run generate:brand-icons` | Regenerate favicon / PWA icons |
| `npm run indexnow:ping` | Manually ping Bing/IndexNow |

## Tests

There is no test framework. Each `*.test.ts` is a plain `node:assert` script,
run by `scripts/run-tests.mjs`:

```bash
npm test
```

| File | Covers |
|------|--------|
| `lib/audit/evidence.test.ts` | HTML extraction, nav-label ordering, quote verification, fetch-failure recording |
| `lib/audit/claim-rules.test.ts` | Visual-claim rejection, fabricated-quote rejection, absence-claim rules |
| `lib/ai-usage/pricing.test.ts` | Cost estimation, reasoning-token double-count prevention, unknown vs free |
| `lib/billing/payout-config.test.ts` | Payout address/network validation |
| `lib/mcp/payment-gate.test.ts` | Which MCP methods require x402 payment |
| `lib/report-schema.quality.test.ts` | Report normalisation and quality gates |

---

## Environment variables

Names only. Copy `.env.example` to `.env.local` and fill it in.

| Group | Variables |
|-------|-----------|
| Site | `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_MARKETING_URL`, `NEXT_PUBLIC_DOCS_URL`, `NEXT_PUBLIC_LEGAL_URL`, `NEXT_PUBLIC_AUTH_URL`, `NEXT_PUBLIC_ENABLE_SUBDOMAIN_REDIRECTS` |
| AI providers | `GROQ_API_KEY`, `GROQ_MODEL`, `GROQ_MODEL_FALLBACK`, `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, `OPENROUTER_MODEL_FALLBACK`, `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_MODEL_FALLBACK` |
| NVIDIA | `NVIDIA_API_KEY`, `NVIDIA_BASE_URL`, `NVIDIA_MODEL`, `NVIDIA_MODEL_FALLBACK`, `NVIDIA_REASONING`, `NVIDIA_MAX_OUTPUT_TOKENS`, `NVIDIA_PRIMARY` |
| Analysis policy | `ANALYSIS_MODE`, `ANALYSIS_PROVIDER`, `AGENT_MAX_STEPS`, `AUDIT_MIN_PAGES`, `AUDIT_MAX_PAGES`, `AUDIT_BUDGET_MS`, `PROVIDER_REQUEST_TIMEOUT_MS`, `PROVIDER_MAX_RETRIES` |
| Auth | `AUTH_SECRET`, `NEXTAUTH_SECRET`, `AUTH_URL`, `NEXTAUTH_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` |
| Database | `DATABASE_URL`, `DIRECT_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `USE_PRISMA_LOCAL` |
| Admin | `REVEL_ADMIN_EMAILS` |
| Usage | `WEEKLY_AUDIT_LIMIT` |
| MCP | `MCP_API_KEY` |
| OKX billing | `OKX_API_KEY`, `OKX_SECRET_KEY`, `OKX_PASSPHRASE`, `OKX_AUDIT_PRICE_USD` |
| Payout | `OKX_PAY_TO`, `OKX_PAY_NETWORK`, `OKX_PAY_ASSET`, `OKX_PAY_ASSET_SYMBOL`, `OKX_PAY_ASSET_DECIMALS` |
| Email | `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `REVEL_ADMIN_NOTIFY_EMAIL` |
| SEO | `GOOGLE_SITE_VERIFICATION`, `BING_SITE_VERIFICATION`, `YANDEX_SITE_VERIFICATION`, `INDEXNOW_KEY`, `INDEXNOW_SECRET`, `CRON_SECRET` |
| Analytics | `NEXT_PUBLIC_PLAUSIBLE_DOMAIN` |
| Export OAuth | `LINEAR_CLIENT_ID`, `LINEAR_CLIENT_SECRET`, `NOTION_CLIENT_ID`, `NOTION_CLIENT_SECRET`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `INTEGRATIONS_ENCRYPTION_KEY` |

### AI provider selection

`ANALYSIS_PROVIDER` pins the first backend (`groq`, `openrouter`, `gemini`,
`nvidia`, or `auto`).

The default cascade is **NVIDIA → Groq → OpenRouter → Gemini**. NVIDIA leads
whenever `NVIDIA_API_KEY` is set; set `NVIDIA_PRIMARY=false` to demote it to
last without removing the key. With no NVIDIA key the order is unchanged
(**Groq → OpenRouter → Gemini**).

**Groq model note:** `llama-3.3-70b-versatile` and `llama-3.1-8b-instant` were
decommissioned by Groq and now return HTTP 404. Defaults moved to
`openai/gpt-oss-120b` with `openai/gpt-oss-20b` and `qwen/qwen3.8-27b` as
fallbacks, and the retired ids are filtered out even if pinned via env.
Re-verify against `GET https://api.groq.com/openai/v1/models` when a model is
retired again.

`NVIDIA_REASONING` accepts `off` (default), `low` or `high`. It maps to the
Nemotron `chat_template_kwargs` fields `enable_thinking` and `low_effort` —
Nemotron 3 does **not** take a top-level `reasoning_effort`. Reasoning traces
are dropped by the agent loop and never reach a report.

### Payout configuration

`lib/billing/payout-config.ts` is the single source of truth for where payment
is received. `OKX_PAY_TO` is a **receiving address only** — it needs no private
key and nothing in this codebase signs on its behalf. An invalid, zero, burn or
token-contract address fails validation and disables billing rather than being
advertised.

`OKX_API_KEY` / `OKX_SECRET_KEY` / `OKX_PASSPHRASE` are OKX facilitator **API
credentials** for settlement verification, not a wallet. Create them in the
[OKX Developer Portal](https://web3.okx.com/onchainos/dev-docs/home/developer-portal):
switch to your project → **Create API key** → set a name and passphrase. The
secret key is viewable afterwards via **View details**; the passphrase is one
you choose and cannot be recovered. If the passphrase is lost, the key is
unusable and a new one must be created.

### Encryption key

```bash
node scripts/generate-secrets.mjs
```

---

## Database

Prisma schema: `prisma/schema.prisma`. Migrations: `prisma/migrations/`.
Supabase-SQL equivalents for the same changes live in `supabase/`.

| Migration | Adds |
|-----------|------|
| `20261013120000_ai_usage_events` | `ai_usage_events` table; `analyses.completed_at`, `analyses.duration_ms`; `idx_analyses_status` |

Apply locally:

```bash
npx prisma migrate deploy      # applies pending migrations
npx prisma generate            # regenerate the client
```

Against Supabase, run the matching file from `supabase/` in the SQL Editor.

**Production migrations are a release step, not a development one.** They are
run deliberately as part of the release checklist, never from a developer
machine against production.

---

## Architecture notes

### Audit pipeline

```
POST /api/analyze  (or MCP tools/call, or /api/partner/v1/analyze)
  → saveAnalysis(status: processing)
  → after()  ← Vercel-supported background work; NOT a dangling promise
      → runAnalysis()
          → AuditEvidenceStore scoped per run (AsyncLocalStorage)
          → provider cascade (agentic tool loop or single-shot)
          → evidence validation on submit
          → saveAnalysis(status: completed | partial | failed, durationMs)
```

`startWebsiteAnalysis()` in `lib/mcp/handlers.ts` **already schedules the run**.
Do not schedule `runAnalysis` again at the call site — doing so executes the
whole pipeline twice.

### Key modules

| Module | Responsibility |
|--------|----------------|
| `lib/audit/evidence.ts` | Per-run evidence store, quote verification, coverage |
| `lib/audit/claim-rules.ts` | Visual-claim detection, quote extraction |
| `lib/audit/capabilities.ts` | Honest inventory of which checks run |
| `lib/report-schema.ts` | Report schema v2, quality gates, evidence validation |
| `services/openai-compatible-agent.ts` | Shared agent loop (Groq + NVIDIA) |
| `lib/ai-usage/recorder.ts` | Per-attempt usage and cost accounting |
| `lib/ai-usage/pricing.ts` | Operator-maintained pricing table |
| `lib/ai-usage/kpis.ts` | Admin KPI aggregation |
| `lib/billing/payout-config.ts` | Validated payout source of truth |

### Report schema versioning

Reports written by the current pipeline carry `schemaVersion: 2` plus
`coverage` and per-finding `evidence`. Reports stored before this change have
no `schemaVersion` (treated as version 1) and remain readable — every new field
is optional on read.

---

## Deployment (Vercel)

Revel deploys to Vercel. Hosting is not to be migrated.

- `vercel.json` sets `maxDuration: 300` for `/api/analyze`, `/api/mcp` and `/api/audit`, and region `iad1`.
- Background work uses `after()` from `next/server`, which Vercel supports; it keeps the invocation alive. `AUDIT_BUDGET_MS` (default 240s) keeps a run inside that window so a terminal state is always persisted.
- Long-running audits must be started and polled, not awaited in one HTTP request.

Release steps, rollback and the production checklist are tracked per release,
not in this file.

---

## Local-only operational notes

`ops-local/` is git-ignored and exists for notes that must not be published.
It is **local to one machine**: it is not committed, not pushed, and not
available to other maintainers, to CI, or to agents working in a fresh clone.
Anything another maintainer needs must live in a tracked file or in the team's
own secret store — never only in `ops-local/`.
