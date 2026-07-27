# Revel

> Find the hidden gaps stopping your product from growing.

**Revel** is an AI product strategist by [BlindspotLab](https://blindspotlab.xyz). Paste a public website URL, and Revel analyzes positioning, UX, messaging, and competition, then returns a scored **Reveal Index**, prioritized **Blueprint**, and exportable **Action Queue**.

**Author:** [Mojeeb Titilayo](https://mojeeb.xyz) · **Company:** [BlindspotLab](https://blindspotlab.xyz)

**Live:** [tryrevel.xyz](https://tryrevel.xyz) · **Docs:** [docs.tryrevel.xyz](https://docs.tryrevel.xyz) · **Repo:** [github.com/Blindspotlabxyz/revel](https://github.com/Blindspotlabxyz/revel) · **License:** Proprietary. See [LICENSE](LICENSE)

---

## What ships today

| Area | Status |
|------|--------|
| Website analysis | Public URLs via Mission Control (cascade: Groq → OpenRouter → Gemini) |
| Outputs | Blindspot Map, Reveal Index, Blueprint, Action Queue |
| Export | Markdown, GitHub MD, JSON; optional Linear / Notion / Gist when configured |
| Auth | NextAuth (email/password + Google), forgot/reset password, editable profile |
| Usage | 3 free audits per week per user (Mission Control); admin unlimited |
| Partner API | `rvl_pk_` keys — analyze + poll report (`/api/partner/v1/*`) |
| MCP / OKX | Streamable HTTP at `/api/mcp`; x402 paid audits at `/api/audit` |
| Database | Supabase Postgres + Prisma (production) |
| SEO / AEO | Sitemap, robots, JSON-LD, `llms.txt`, `ai.txt`, IndexNow |
| Subdomains | `docs.`, `legal.`, `auth.` with logo home → marketing apex |

**Also live:** `/compare`, `/pricing` (early access), `/guides/find-product-blindspots`, public Genesis sample report.

---

## Tech stack

- **App:** Next.js 16, React 19, TypeScript, Tailwind 4, Framer Motion, Radix
- **Data / auth:** Supabase Postgres, Prisma 7, NextAuth (Google + credentials), Resend
- **AI:** Custom agentic tool loop — **Groq** (`llama-3.3-70b-versatile` → `llama-3.1-8b-instant`) → **OpenRouter** → **Gemini** last; Zod quality gates on reports
- **Agents / payments:** MCP A2MCP (`/api/mcp`), OKX x402 on billable tools, Partner API keys
- **Deploy:** Vercel (long-running analyze/mcp/audit functions)

Full technical brief (including prompt-engineering attribution): **[stacks.md](./stacks.md)**

---

## Quick start

### Prerequisites

- Node.js 20+
- Accounts as needed: [Groq](https://console.groq.com) or [Google AI Studio](https://aistudio.google.com), [OpenRouter](https://openrouter.ai), [Google Cloud Console](https://console.cloud.google.com) (OAuth), [Supabase](https://supabase.com), optional [Resend](https://resend.com)

### Setup

```bash
git clone https://github.com/Blindspotlabxyz/revel.git
cd revel
npm install

cp .env.example .env.local
npm run env:merge          # append any missing keys
# Fill secrets in .env.local (see .env.example)

npm run db:setup           # verify database connection
# Apply schema: npx prisma db push  (or run SQL in Supabase SQL Editor)
npm run dev                # http://localhost:3000
```

Configure Google OAuth and set `AUTH_SECRET` / `NEXTAUTH_*` / `GOOGLE_*` in `.env.local`.

### OKX x402 billing

The app already wires OKX x402 billing for the paid MCP and audit endpoints. If you want marketplace/API access, add the same values from `.env.example` (or the Vercel template in `.env.vercel`) for:

- `OKX_API_KEY`
- `OKX_SECRET_KEY`
- `OKX_PASSPHRASE`
- `OKX_PAY_TO`
- `OKX_AUDIT_PRICE_USD`

You can verify the official SDK wiring with:

```bash
npm run verify:okx-billing
```

You can also check the runtime health endpoint:

```bash
curl http://localhost:3000/api/health
```

### Key scripts

| Command | Purpose |
|---------|---------|
| `npm run dev` | Dev server (webpack) |
| `npm run build` | Production build (+ IndexNow ping on Vercel) |
| `npm run env:merge` | Sync missing keys from `.env.example` → `.env.local` |
| `npm run indexnow:ping` | Manually ping Bing/IndexNow |
| `npm run db:setup` | Test DB connectivity |
| `npm run generate:brand-icons` | Regenerate favicon / PWA icons |
| `npm run mcp` | Local MCP stdio server |

---

## Environment variables

Copy `.env.example` to `.env.local`. On **Vercel production**:

```env
NEXT_PUBLIC_APP_URL=https://tryrevel.xyz
NEXT_PUBLIC_MARKETING_URL=https://tryrevel.xyz
NEXT_PUBLIC_DOCS_URL=https://docs.tryrevel.xyz
NEXT_PUBLIC_LEGAL_URL=https://legal.tryrevel.xyz
NEXT_PUBLIC_AUTH_URL=https://auth.tryrevel.xyz
NEXT_PUBLIC_ENABLE_SUBDOMAIN_REDIRECTS=true
```

| Group | Variables |
|-------|-----------|
| Site | `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_MARKETING_URL`, subdomain URLs, `NEXT_PUBLIC_ENABLE_SUBDOMAIN_REDIRECTS` |
| AI | `GROQ_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, model env vars |
| Auth | `AUTH_SECRET` / `NEXTAUTH_SECRET`, `AUTH_URL` / `NEXTAUTH_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` |
| Database | `DATABASE_URL`, `DIRECT_URL`, optional Supabase keys |
| SEO | `GOOGLE_SITE_VERIFICATION`, `BING_SITE_VERIFICATION`, `INDEXNOW_KEY`, `CRON_SECRET` |
| Usage | `WEEKLY_AUDIT_LIMIT` (default 3 / week) |
| Analytics | `NEXT_PUBLIC_PLAUSIBLE_DOMAIN` (optional, e.g. `tryrevel.xyz`) |
| MCP | `MCP_API_KEY` |
| OKX billing | `OKX_API_KEY`, `OKX_SECRET_KEY`, `OKX_PASSPHRASE`, `OKX_PAY_TO`, `OKX_AUDIT_PRICE_USD` |
| Email (Resend) | `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `REVEL_ADMIN_NOTIFY_EMAIL` |
| Export OAuth (per-user) | `LINEAR_CLIENT_ID/SECRET`, `NOTION_CLIENT_ID/SECRET`, `GITHUB_CLIENT_ID/SECRET`, `INTEGRATIONS_ENCRYPTION_KEY` (encrypts OAuth tokens at rest; falls back to `AUTH_SECRET`) |

### Per-user export privacy (Linear / Notion / GitHub)

Cloud exports do **not** use a shared BlindspotLab Linear/Notion/GitHub workspace. Each signed-in user connects **their own** account via OAuth under **Mission Control → Integrations**. Tokens are stored encrypted; disconnecting deletes them. Downloads (Markdown / JSON / GitHub MD) never require a connection.

| Provider | OAuth scopes (approx.) | Export lands in |
|----------|------------------------|-----------------|
| Linear | `read,write,issues:create` | User’s Linear team |
| Notion | User-granted pages/databases | User’s Notion workspace |
| GitHub | `gist` | User’s **private** Gist |

Redirect URIs (production):

```text
https://tryrevel.xyz/api/integrations/linear/callback
https://tryrevel.xyz/api/integrations/notion/callback
https://tryrevel.xyz/api/integrations/github/callback
```

Generate an encryption key for local/prod:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
# → INTEGRATIONS_ENCRYPTION_KEY=<output>
```

```bash
node scripts/generate-secrets.mjs
```

### Database migrations

Profile + password-reset + per-user integrations (if not already applied):

```sql
-- Profile / password reset
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "name" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "username" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "image" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "password_reset_token_hash" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "password_reset_expires" TIMESTAMPTZ(6);
CREATE UNIQUE INDEX IF NOT EXISTS "users_username_key" ON "users" ("username");

-- Per-user OAuth tokens for private exports
CREATE TABLE IF NOT EXISTS "user_integrations" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "provider" TEXT NOT NULL,
  "access_token_encrypted" TEXT NOT NULL,
  "refresh_token_encrypted" TEXT,
  "token_expires_at" TIMESTAMPTZ(6),
  "scopes" TEXT,
  "metadata" JSONB,
  "connected_at" TIMESTAMPTZ(6) DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ(6) DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS "user_integrations_user_provider_key"
  ON "user_integrations" ("user_id", "provider");
```

Or: `npx prisma db push` / `npx prisma migrate deploy`.

---

## Project structure

```
app/              # Routes (marketing, Mission Control, auth, API, llms.txt)
components/       # UI, landing, dashboard, auth, SEO
lib/              # Config, SEO, auth, logo-home, report schema, Prisma
services/         # Analysis store, export, agents, content extraction
prisma/           # Schema and migrations
public/           # Brand assets, images, humans.txt
scripts/          # DB checks, env merge, IndexNow, brand icons, MCP
styles/           # Global CSS and design tokens
types/            # Shared TypeScript types
```

---

## Routes

**Marketing:** `/`, `/features`, `/compare`, `/pricing`, `/about`, `/contact`, `/guides/find-product-blindspots`

**Docs:** `/docs/*` (also `docs.tryrevel.xyz/*`)

**Legal:** `/privacy`, `/terms` (also `legal.tryrevel.xyz/*`)

**App:** `/mission-control`, `/mission-control/analysis/[id]`, `/mission-control/report/[id]`, `/mission-control/history`, `/mission-control/account`, `/mission-control/settings`

**Auth:** `/log-in`, `/sign-up`, `/forgot-password`, `/reset-password` (also `auth.tryrevel.xyz`)

**API:** `POST /api/analyze`, `GET /api/report/:id`, `POST /api/export`, `GET /api/history`, Partner + MCP routes under `/api/partner` and `/api/mcp`

**Discovery:** `/llms.txt`, `/llms-full.txt`, `/ai.txt`, `/sitemap.xml`, `/robots.txt`

---

## Subdomains & logo home

With `NEXT_PUBLIC_ENABLE_SUBDOMAIN_REDIRECTS=true`, product hosts rewrite into this app. The logo uses `NEXT_PUBLIC_MARKETING_URL` (or `NEXT_PUBLIC_APP_URL`) so **docs / legal / auth** always link back to the marketing apex via a real `<a href>`, while the apex keeps a relative Next.js `<Link href="/">`.

---

## Deploy (Vercel)

1. Import `Blindspotlabxyz/revel` from GitHub  
2. Paste env vars (production URL overrides above)  
3. Attach domains: `tryrevel.xyz`, `docs.tryrevel.xyz`, `legal.tryrevel.xyz`, `auth.tryrevel.xyz`  
4. Google OAuth redirect: `https://auth.tryrevel.xyz/api/auth/callback/google`  
5. Submit `https://tryrevel.xyz/sitemap.xml` in Search Console / Bing  

Production builds auto-ping [IndexNow](https://www.indexnow.org/).

---

## Security

- Env files are gitignored; only `.env.example` is tracked  
- Middleware returns **403** for common `.env` scanner probes  
- Analysis access checks, SSRF guards, and partner key hashing  
- Optional: Vercel Firewall custom rule to deny `*.env` paths at the edge  

---

## License

This project is **proprietary and not open source**. All rights reserved by **Mojeeb Titilayo** and **BlindspotLab**.

You may not copy, modify, distribute, sublicense, or commercially use this code without written permission. See [LICENSE](LICENSE) for full terms.

For licensing or partnership inquiries: [hello@blindspotlab.xyz](mailto:hello@blindspotlab.xyz)

---

## Vision

Revel is building toward an intelligence layer that AI agents and applications can call to deeply understand products — not another generic chat audit. **Blindspot Audit** (website analysis) is the first module on that path.

---

Created by **[Mojeeb Titilayo](https://mojeeb.xyz)** · **BlindspotLab** · [hello@blindspotlab.xyz](mailto:hello@blindspotlab.xyz)
