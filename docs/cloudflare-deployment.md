# Deploy Revel on Cloudflare Workers

A step-by-step guide you can follow from a phone browser. You do **not**
need a computer, a terminal, or to edit any code.

Read each step to the end before tapping anything.

---

## How to read this guide

Every action is tagged with who does it:

- **[AUTO]** — created for you by the GitHub deployment. Do nothing.
- **[MANUAL]** — you create it in the Cloudflare dashboard.
- **[BUILD VAR]** — a value you type into *Settings → Build*. Used only while building.
- **[RUNTIME]** — a value you type into *Settings → Variables and Secrets*. Used by the live site.
- **[SUPABASE]** — already exists in Supabase. You only copy something.
- **[OPTIONAL]** — not required.

Tabs you will want open:

1. Cloudflare dashboard — `dash.cloudflare.com`
2. Supabase dashboard — your Revel project
3. Vercel dashboard — the Revel project (to copy current values)
4. GitHub — `github.com/BlindspotLab-Limited/revel`

Time needed: about 60–90 minutes, plus DNS propagation.

---

## 1. What you are deploying

**One Cloudflare Worker named `revel`.** It contains everything:

- The Next.js website and all API routes (via the OpenNext adapter).
- The audit runner, as a **Cloudflare Workflow** called `revel-audit`.
- The daily IndexNow job, as a **cron trigger** (`0 6 * * *`, 06:00 UTC).

It connects to:

- **Your existing Supabase Postgres**, through **Hyperdrive**. Same
  database, same tables, same data. Nothing is migrated, reset or copied.
- The same AI providers, Google OAuth, Linear/Notion/GitHub OAuth, OKX
  x402 billing, and Resend as today.

What the Worker is bound to, and who creates each:

- `HYPERDRIVE` → your Hyperdrive config. **[MANUAL]** create it in step 2,
  then give its ID to the build in step 4.
- `AUDIT_WORKFLOW` → Workflow `revel-audit`. **[AUTO]**
- `WORKER_SELF_REFERENCE` → the Worker calling itself. **[AUTO]**
- `ASSETS` → static files. **[AUTO]**
- `IMAGES` → image resizing (AVIF/WebP). **[AUTO]**
- `AUDIT_RATE_LIMITER`, `PARTNER_RATE_LIMITER` → shared rate limits. **[AUTO]**
- Cron trigger `0 6 * * *`. **[AUTO]**

Not used, do not create: D1, KV, R2, Queues, Durable Objects, Pages,
a second Worker.

### Why OpenNext (and not vinext)

Both adapters were evaluated against this codebase on Next.js 16.

- **vinext** (Cloudflare's Vite-based Next.js) — its own compatibility
  checker (`vinext check`, v1.3.0) reports **`next-auth` as incompatible**
  ("relies on Next.js API route internals"). Revel's whole login system is
  Auth.js/next-auth (email + password, Google, JWT sessions, cross-subdomain
  cookies). vinext also requires React 19.3+ and a Vite toolchain, and its
  docs describe it as experimental. Replacing Auth.js would change product
  behaviour, so vinext was rejected.
- **OpenNext for Cloudflare** (`@opennextjs/cloudflare` 1.20) — runs the real
  Next.js server output. It was built and run locally in `workerd` (the
  Workers runtime) and passed sign-up, sign-in, JWT sessions, Mission Control,
  MCP, the x402 paywall, partner credits, audits through the Workflow, and the
  cron trigger. **Selected.**

Two honest caveats about OpenNext:

1. OpenNext 1.20 supports Next.js ≥ 16.4.1, so Next.js was upgraded
   from 16.2.10 to **16.4.2** (same major version, no code changes needed).
2. OpenNext labels Next.js 16's Node.js `proxy.ts` middleware as
   *experimental*. Revel's `proxy.ts` (auth gate, subdomain routing, scanner
   blocking) was tested in `workerd` and works, but watch it after go-live.

---

## 2. Before you start (checklist)

- [ ] **Workers Paid plan** on the Cloudflare account (the Workers &
  Pages overview shows your current plan and an upgrade option). Required: the Worker is about 6.5 MB compressed (Free allows
  3 MB), audits need more than the Free CPU limit, and Workflows run
  inside it. This is a paid subscription — your decision.
- [ ] **`tryrevel.xyz` is an active zone in this Cloudflare account**
  (Websites list shows it as *Active*). Needed only for step 9 (custom
  domains). If DNS is hosted elsewhere today, moving nameservers to
  Cloudflare is a DNS change you must plan separately; everything up to
  step 8 works without it.
- [ ] Owner/admin access to the GitHub organisation
  `BlindspotLab-Limited` (to let Cloudflare read the repo).
- [ ] Access to the Supabase project and the Vercel project.
- [ ] Vercel stays connected and live until step 12. Do not touch it now.

---

## 3. Step 1 — Find your Supabase connection details [SUPABASE]

Nothing is created in Supabase. You copy one connection string.

1. Open the Supabase project → **Connect** (top of the project page).
2. Choose **Direct connection**. It looks like:
   `postgresql://postgres:[YOUR-PASSWORD]@db.<project-ref>.supabase.co:5432/postgres`
3. Replace `[YOUR-PASSWORD]` with the database password. It is the same
   password used in Vercel's `DIRECT_URL`. If it contains symbols such as
   `@ # / ? :` you must URL-encode them, or use the separate host / user /
   password fields in the Hyperdrive form instead (safer on a phone).

Use **Direct connection** first — that is Cloudflare's recommendation,
because Hyperdrive does its own connection pooling.

If Hyperdrive later says it **cannot connect** (the direct host is IPv6-only
on some Supabase plans), come back and use **Session pooler** instead:
host `aws-0-<region>.pooler.supabase.com`, port **5432**, user
`postgres.<project-ref>`.

**Never** use the *Transaction pooler* (port **6543**) with Hyperdrive.

---

## 4. Step 2 — Create the Hyperdrive configuration [MANUAL]

1. Cloudflare dashboard → **Storage & databases** → **Hyperdrive**.
   (If you don't see it, use the search box at the top and type
   "Hyperdrive".)
2. Tap **Create configuration**.
3. Name: `revel-supabase`.
4. Enter the connection details from step 1 (either the full connection
   string, or host / port `5432` / database `postgres` / user / password).
5. **Caching: turn it OFF.** If the form or, after creation, the
   configuration's settings show a caching option, set it to disabled.
   This is important: with caching on, Hyperdrive can return database
   reads up to 60 seconds old, which would make audit progress look stuck,
   make a brand-new account fail to sign in for a minute, and delay credit,
   quota and API-key-revocation checks.
   If you cannot find a caching option anywhere, use the GitHub Action in
   **Appendix C2** once (works from the GitHub mobile app).
6. Tap **Create**. Hyperdrive tests the connection first; if it fails, see
   step 1's fallback.
7. Open the new configuration and **copy its ID** — 32 letters/digits,
   e.g. `a1b2c3d4…`. You need it in step 4. It is not a password, but keep
   it out of public places.

---

## 5. Step 3 — Connect GitHub and create the Worker [MANUAL]

1. Cloudflare dashboard → **Workers & Pages** → **Create application**.
2. Choose **GitHub** (connect / import a repository). If asked, authorise
   the Cloudflare GitHub app for the `BlindspotLab-Limited` organisation
   (you can limit it to the `revel` repository).
3. Select repository **`BlindspotLab-Limited/revel`**.
4. Fill in the settings exactly:

   - **Project / Worker name:** `revel`
     (must match `name` in `wrangler.jsonc`, otherwise every build fails)
   - **Production branch:** `main`
   - **Build command:** `npm run build:cloudflare`
   - **Deploy command:** `npm run deploy:cloudflare`
   - **Root directory:** leave empty (repository root, `/`)
   - **Non-production branch builds:** turn **off** (see note below). If
     you leave them on, set the non-production deploy command to
     `npm run upload:cloudflare`.
   - **API token:** let Cloudflare create one (default).

5. If the form has **Build variables** (sometimes under *Advanced*), add
   the variables from step 4 now. If it doesn't, continue — the first
   build will fail with a clear message, and you'll add them in step 4.
6. Tap **Save and Deploy** (or **Deploy**).

Why non-production builds off: preview versions run with the same secrets,
the same database and the same Workflow as production.

What this creates **[AUTO]**: the Worker `revel`, its `revel.<your
account>.workers.dev` address, the Workflow `revel-audit`, the cron
trigger, the image binding and the rate limiters. Every future push to
`main` rebuilds and redeploys automatically.

Install, build and Prisma Client generation all happen in Cloudflare's
build machine (`npm ci` → `prisma generate` → OpenNext build). No database
migration ever runs during a build or deploy.

---

## 6. Step 4 — Build variables [BUILD VAR]

Where: **Workers & Pages → revel → Settings → Build → Variables and
secrets** (build section, *not* the runtime "Variables and Secrets").

These are baked into the site when it is built. Changing one needs a new
build: **Deployments / Builds → Retry build**, or push a commit.

Required:

- `CLOUDFLARE_HYPERDRIVE_ID` = the ID from step 2
- `NEXT_PUBLIC_APP_URL` = `https://tryrevel.xyz`
- `NEXT_PUBLIC_MARKETING_URL` = `https://tryrevel.xyz`
- `NEXT_PUBLIC_DOCS_URL` = `https://docs.tryrevel.xyz`
- `NEXT_PUBLIC_LEGAL_URL` = `https://legal.tryrevel.xyz`
- `NEXT_PUBLIC_AUTH_URL` = `https://auth.tryrevel.xyz`
- `NEXT_PUBLIC_ENABLE_SUBDOMAIN_REDIRECTS` = `true`

Copy these from Vercel if set there (public values, not secrets):

- `NEXT_PUBLIC_PLAUSIBLE_DOMAIN`
- `GOOGLE_SITE_VERIFICATION`, `BING_SITE_VERIFICATION`,
  `YANDEX_SITE_VERIFICATION` (add them as runtime values too, step 5)

Do **not** put passwords, API keys or the database connection string in
build variables.

The build stops with an explicit error if `CLOUDFLARE_HYPERDRIVE_ID`,
`NEXT_PUBLIC_APP_URL` or `NEXT_PUBLIC_ENABLE_SUBDOMAIN_REDIRECTS` is
missing, or if the Hyperdrive ID doesn't look like an ID.

---

## 7. Step 5 — Runtime variables and secrets [RUNTIME]

Where: **Workers & Pages → revel → Settings → Variables and Secrets →
Add**. Pick **Type: Secret** for anything sensitive. Add several, then tap
**Deploy**.

Open Vercel → revel → Settings → Environment Variables (Production) in
another tab and copy the values across **exactly**.

> **Must be identical to Vercel**, character for character:
> - `AUTH_SECRET` and `NEXTAUTH_SECRET` — otherwise everyone is signed out
>   and password-reset links stop working.
> - `INTEGRATIONS_ENCRYPTION_KEY` — otherwise every stored Linear / Notion
>   / GitHub token becomes unreadable and users must reconnect.
>   (If Vercel never had it, also leave it unset here.)

### Secrets (Type: Secret)

Auth:
- `AUTH_SECRET`, `NEXTAUTH_SECRET`
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
- `INTEGRATIONS_ENCRYPTION_KEY`

AI providers (whichever you use today):
- `NVIDIA_API_KEY`, `GROQ_API_KEY`, `OPENROUTER_API_KEY`, `GEMINI_API_KEY`

Integrations (per-user OAuth apps):
- `LINEAR_CLIENT_ID`, `LINEAR_CLIENT_SECRET`
- `NOTION_CLIENT_ID`, `NOTION_CLIENT_SECRET`
- `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`
- Legacy, only if set on Vercel: `GITHUB_TOKEN`, `LINEAR_API_KEY`,
  `LINEAR_TEAM_ID`, `NOTION_API_KEY`, `NOTION_DATABASE_ID`

MCP and billing:
- `MCP_API_KEY`
- `OKX_API_KEY`, `OKX_SECRET_KEY`, `OKX_PASSPHRASE`

Email and jobs:
- `RESEND_API_KEY`
- `CRON_SECRET` (any long random string; needed for the daily IndexNow job)
- `INDEXNOW_SECRET`

### Non-secret values (Type: Text — or Secret if unsure)

- `AUTH_URL` = `https://auth.tryrevel.xyz`
- `NEXTAUTH_URL` = `https://auth.tryrevel.xyz`
- `NEXT_PUBLIC_APP_URL` = `https://tryrevel.xyz` (same value as the build
  variable; harmless safety net)
- `REVEL_ADMIN_EMAILS`, `REVEL_ADMIN_NOTIFY_EMAIL`, `RESEND_FROM_EMAIL`
- `OKX_PAY_TO`, `OKX_PAY_NETWORK`, `OKX_PAY_ASSET`,
  `OKX_PAY_ASSET_SYMBOL`, `OKX_PAY_ASSET_DECIMALS`, `OKX_AUDIT_PRICE_USD`
- `ANALYSIS_PROVIDER`, `ANALYSIS_MODE`, `AGENT_MAX_STEPS`
- `NVIDIA_BASE_URL`, `NVIDIA_MODEL`, `NVIDIA_MODEL_FALLBACK`,
  `NVIDIA_REASONING`, `NVIDIA_MAX_OUTPUT_TOKENS`, `NVIDIA_PRIMARY`
- `GROQ_MODEL`, `GROQ_MODEL_FALLBACK`, `OPENROUTER_MODEL`,
  `OPENROUTER_MODEL_FALLBACK`, `GEMINI_MODEL`, `GEMINI_MODEL_FALLBACK`
- `AUDIT_MIN_PAGES`, `AUDIT_MAX_PAGES`, `AUDIT_BUDGET_MS`,
  `PROVIDER_REQUEST_TIMEOUT_MS`, `PROVIDER_MAX_RETRIES`
- `WEEKLY_AUDIT_LIMIT`, `NOTION_TITLE_PROPERTY`, `INDEXNOW_KEY`
- `GOOGLE_SITE_VERIFICATION`, `BING_SITE_VERIFICATION`,
  `YANDEX_SITE_VERIFICATION`

Only copy the ones that exist in Vercel; anything missing uses the same
default as before.

### Do NOT add on Cloudflare

- `DATABASE_URL`, `DIRECT_URL` — not used on Workers. The database is
  reached only through Hyperdrive. (Keep them where they are for local
  development and migrations.)
- `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` — only
  a local-development fallback. Leaving them out means a broken Hyperdrive
  setup fails loudly instead of silently using a different storage path.
- Anything starting with `VERCEL_`.

Variables you set here survive every GitHub deploy (`keep_vars` is on and
secrets are never overwritten).

---

## 8. Step 6 — Bindings and the Workflow [AUTO]

Nothing to create. After the first successful deploy, confirm:

1. **Workers & Pages → revel → Settings → Bindings**: you should see
   `HYPERDRIVE`, `AUDIT_WORKFLOW`, `WORKER_SELF_REFERENCE`, `ASSETS`,
   `IMAGES`, `AUDIT_RATE_LIMITER`, `PARTNER_RATE_LIMITER`.
2. **Workers & Pages → Workflows** (or search "Workflows"): a workflow
   named **`revel-audit`** exists. Each audit appears here as one
   instance whose ID equals the analysis ID.

Do not add or edit bindings in the dashboard: the next GitHub deploy
replaces them with what `wrangler.jsonc` declares.

How audits run now (for your understanding):

1. A start request saves the audit as `processing` and creates one
   Workflow instance (ID = analysis ID). A second instance for the same
   audit is refused, so an audit can never run twice.
2. The Workflow runs the unchanged analysis engine (NVIDIA → Groq →
   OpenRouter → Gemini, evidence checks, report normalisation, per-attempt
   AI usage accounting) and stores `completed`, `partial` or `failed`.
3. It survives the user closing the browser. One automatic retry for
   infrastructure errors, a 10-minute step timeout, and a final step that
   marks the audit `failed` if everything else went wrong. Anything still
   `processing` after 30 minutes is closed as failed when next read.
4. Credits and x402 payments are taken before the run and are never
   touched by the Workflow, so retries cannot double-charge.

---

## 9. Step 7 — Scheduled job [AUTO]

The daily IndexNow submission (`0 6 * * *`, 06:00 UTC — same as Vercel)
is declared in the code. Check **revel → Settings → Trigger events**
(or *Triggers*): one cron `0 6 * * *`.

- Needs the `CRON_SECRET` runtime secret (step 5). Without it the job
  logs "skipped" and does nothing (fails closed).
- To pause it: add runtime variable `INDEXNOW_DISABLED` = `true`.
- Do not add a second cron in the dashboard.
- Builds never submit to IndexNow any more; only this job (or a manual
  `npm run indexnow:ping`) does.

---

## 10. Step 8 — Test before switching any DNS

The first deploy gives you `https://revel.<your-account>.workers.dev`
(shown on the Worker's overview page). Production traffic still goes to
Vercel. Both use the same database, so be gentle: don't create junk data.

### What works on the workers.dev address

- All public pages, docs, robots.txt, sitemap.xml.
- `/api/health`, MCP (`/api/mcp`), `/api/audit` paywall, partner API.
- Database reads (the health checks below).

### What does not work there yet (expected)

- Signing in: login is pinned to `auth.tryrevel.xyz` and session cookies
  to `.tryrevel.xyz`, which still point at Vercel. Test sign-in in step 9
  (optional staging hostname) or right after cutover.

### Quick checks from your phone browser

1. `https://revel.<account>.workers.dev/api/health` →
   `"status":"ok"`, and `okxBilling.status` as on Vercel.
2. `…/api/mission-control/health` → `{"ok":true}` means the database,
   tables and Workflow binding are all ready.
3. `…/` and `…/pricing` load normally.
4. `…/api/mcp/manifest` loads.

### Full read-only test (GitHub Action)

GitHub app or github.com → **Actions** → **Cloudflare: smoke test** →
**Run workflow** → base_url = your workers.dev address → **Run**.
It runs about 35 checks (pages, security headers, SEO files, auth endpoints,
MCP, the x402 402-challenge, partner auth, hidden internal endpoints) and
never pays, writes or starts audits. Green = pass.

### [OPTIONAL] Staging hostname with real sign-in

Only if `tryrevel.xyz` is a Cloudflare zone. Adds a **new** hostname;
existing records are untouched.

1. **revel → Settings → Domains & Routes → Add → Custom Domain**.
2. Enter `staging.tryrevel.xyz` → **Add Custom Domain**. Cloudflare
   creates the DNS record and certificate.
3. Sign in on the live site (`tryrevel.xyz`) as usual. Because the session
   cookie is shared across `*.tryrevel.xyz` and both sides use the same
   `AUTH_SECRET`, `https://staging.tryrevel.xyz/mission-control` opens
   signed in, served by Cloudflare.
4. Run one real audit there and watch it in **Workflows → revel-audit**.
5. Remove the staging domain later (same screen) if you like.

---

## 11. Step 9 — Switch the domains [MANUAL]

Only after step 8 looks good. Do this when traffic is low.

Hostnames: `tryrevel.xyz`, `auth.tryrevel.xyz`, `docs.tryrevel.xyz`,
`legal.tryrevel.xyz` (and `www.tryrevel.xyz` if it exists today).

Before anything else:

1. Cloudflare → `tryrevel.xyz` → **DNS → Records**. **Screenshot every
   record** for these hostnames. This is your rollback.
2. If possible, lower their TTL to the minimum an hour beforehand.

Then, one hostname at a time (suggested order: `legal`, `docs`, then
`auth` and the apex `tryrevel.xyz` together, then `www`):

1. In **DNS → Records**, delete the record for that hostname that points
   to Vercel (a Custom Domain cannot be added while a CNAME exists).
   This is the moment traffic for that hostname stops reaching Vercel.
2. Immediately: **Workers & Pages → revel → Settings → Domains & Routes
   → Add → Custom Domain** → enter the hostname → **Add Custom Domain**.
   Cloudflare creates the DNS record and TLS certificate (allow a few
   minutes).
3. Open the hostname and check it (step 10).

Nothing in the code needs to change for this. In particular:

- **Google OAuth** keeps the same redirect URI:
  `https://auth.tryrevel.xyz/api/auth/callback/google`. No change in
  Google Cloud Console.
- **Linear / Notion / GitHub OAuth** callbacks stay
  `https://tryrevel.xyz/api/integrations/<provider>/callback`.
- Existing user sessions remain valid (same `AUTH_SECRET`, same cookie
  domain).

If `tryrevel.xyz` is **not** a Cloudflare zone, stop here: custom domains
need the zone on Cloudflare. Moving nameservers is a separate DNS project.

---

## 12. Step 10 — Verify production

Run **Actions → Cloudflare: smoke test** with `https://tryrevel.xyz` and
**subdomains** ticked. Then check by hand:

### Database

- Sign in as an admin, open `https://tryrevel.xyz/api/mission-control/health`.
  Expect `"ok":true`, `"runtime":"cloudflare-workers"`,
  `"database_connection":"hyperdrive"`, `"audit_workflow":true`,
  `"storage":"prisma"`.
- Mission Control → **History** shows your existing audits.
- Admin **AI usage** and **Analytics** pages show historical numbers.

### Auth

- Sign out, sign in with email + password.
- Sign in with Google (redirects through `auth.tryrevel.xyz`).
- Forgot password → the email arrives → the reset link works.
- Admin pages open for admin accounts only.
- `docs.`, `legal.`, `auth.` and apex links stay signed in.

### Audits

- Mission Control → run one audit. The progress screen finishes in a few
  minutes.
- **Workflows → revel-audit**: an instance with the audit's ID shows
  *Complete*.
- Close the tab mid-audit once: the audit still finishes (check History).
- Admin **AI usage** shows the new provider attempts.

### MCP and APIs

- `https://tryrevel.xyz/api/mcp` (GET) shows the service JSON.
- Your MCP client (or the OKX listing validator) connects to
  `https://tryrevel.xyz/api/mcp` and lists tools.
- `/api/partner/v1/health` responds; a partner key can poll a report.

### Billing (no money moves)

- The smoke test's "POST /api/audit without payment" check must show
  **402** with a `PAYMENT-REQUIRED` challenge (billing on) — never 500.
- `/api/health` → `okxBilling.status` is `healthy`.
- Do **not** make a paid test call unless you intend to pay for it.

### Integrations

- Mission Control → Integrations: existing Linear / Notion / GitHub
  connections still show as connected. Export one report to each.
  If they show errors, `INTEGRATIONS_ENCRYPTION_KEY` differs from Vercel.

### Scheduled job

- The next day, **revel → Observability → Logs**, search `indexnow_cron`:
  one entry with `"status":200`.

---

## 13. Finding errors

### Build or deploy failed

**revel → Deployments** (or **Builds**) → open the failed build → read
the log from the bottom up. Common messages:

- *"Worker name … does not match"* → the Worker must be named `revel`.
- *"CLOUDFLARE_HYPERDRIVE_ID is not set"* → add the build variable
  (step 4) and retry the build.
- *"must be the 32-character Hyperdrive configuration ID"* → you pasted
  something else (e.g. a connection string). Use the ID.
- *"Build variable(s) not set: NEXT_PUBLIC_…"* → add them (step 4).
- *"Worker exceeded the size limit"* / *"exceeded startup time"* → the
  account is not on Workers Paid, or a dependency grew; report it.
- *"Hyperdrive config … not found"* → the ID is from another account or
  the config was deleted.

### Site is up but something is broken

**revel → Observability → Logs**. Revel logs one JSON line per event;
search for:

- `analysis_failed` — an audit failed (field `errorDetail` says why).
- `audit_workflow_run_failed` — the Workflow gave up after retries.
- `Audit execution is unavailable` — `AUDIT_WORKFLOW` binding missing.
- `okx_facilitator_unavailable` — OKX rejected the billing credentials;
  paid routes answer 503 (fail closed) until fixed.
- `indexnow_cron` — the daily job.
- `rate_limit_binding_failed`, `background_task_failed` — non-fatal.

Database errors such as *"connection refused"* or *"password
authentication failed"*: fix the Hyperdrive configuration's details
(step 2); the Worker needs no redeploy.

### An audit looks stuck

**Workflows → revel-audit → instance with the audit ID** shows each step,
its retries and the error. After 30 minutes the audit is closed as
`failed` automatically the next time it is opened or polled.

---

## 14. Rollback

### A. Bad code deploy (keep Cloudflare)

**revel → Deployments** → on the last good version tap **⋯ → Rollback**.
Instant. Variables, secrets and the database are unaffected.

### B. Go back to Vercel (after DNS cutover)

Vercel is still connected and still deploys every push to `main`
(the code still runs on Node.js/Vercel). To return traffic:

1. **revel → Settings → Domains & Routes**: remove the custom domains.
2. **DNS → Records**: recreate the Vercel records from your screenshots
   (step 9).
3. Wait for DNS; check `tryrevel.xyz`.

No data rollback is needed — both platforms use the same database.
Audits that were running on Cloudflare at that moment are closed as
`failed` within 30 minutes; users can re-run them.

---

## 15. Remove Vercel safely (after cutover)

Wait at least **7 days** of normal traffic on Cloudflare, then:

1. Vercel → revel → **Analytics/Logs**: confirm no real traffic.
2. Save every Vercel environment variable value in your password manager
   (you need `AUTH_SECRET` and `INTEGRATIONS_ENCRYPTION_KEY` forever).
3. Vercel → revel → **Settings → Domains**: remove the tryrevel.xyz
   domains.
4. Vercel → revel → **Settings → Git**: disconnect the repository (stops
   Vercel builds on every push). Later, pause or delete the project.
5. Code clean-up (one small follow-up commit, or ask a developer): remove
   the `export const maxDuration = 300` lines in `app/api/analyze`,
   `app/api/mcp`, `app/api/audit` and `app/api/partner/v1/analyze` — they
   only matter on Vercel and are kept now so Vercel stays a working
   rollback target.
6. Legal: the Privacy Policy (`app/privacy/page.tsx`) lists "Vercel
   (hosting)" as a processor. Update it to Cloudflare when you switch —
   a legal decision, so it was not changed automatically.

---

## Appendix A — All environment variables

**Build variables** (Settings → Build): `CLOUDFLARE_HYPERDRIVE_ID`,
`NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_MARKETING_URL`,
`NEXT_PUBLIC_DOCS_URL`, `NEXT_PUBLIC_LEGAL_URL`, `NEXT_PUBLIC_AUTH_URL`,
`NEXT_PUBLIC_ENABLE_SUBDOMAIN_REDIRECTS`, `NEXT_PUBLIC_PLAUSIBLE_DOMAIN`,
optional `GOOGLE_SITE_VERIFICATION`, `BING_SITE_VERIFICATION`,
`YANDEX_SITE_VERIFICATION`.

**Runtime secrets**: `AUTH_SECRET`, `NEXTAUTH_SECRET`, `GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET`, `INTEGRATIONS_ENCRYPTION_KEY`, `NVIDIA_API_KEY`,
`GROQ_API_KEY`, `OPENROUTER_API_KEY`, `GEMINI_API_KEY`,
`LINEAR_CLIENT_ID`, `LINEAR_CLIENT_SECRET`, `NOTION_CLIENT_ID`,
`NOTION_CLIENT_SECRET`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`,
`MCP_API_KEY`, `OKX_API_KEY`, `OKX_SECRET_KEY`, `OKX_PASSPHRASE`,
`RESEND_API_KEY`, `CRON_SECRET`, `INDEXNOW_SECRET`
(+ legacy `GITHUB_TOKEN`, `LINEAR_API_KEY`, `LINEAR_TEAM_ID`,
`NOTION_API_KEY`, `NOTION_DATABASE_ID` if used).

**Runtime non-secret**: `AUTH_URL`, `NEXTAUTH_URL`, `NEXT_PUBLIC_APP_URL`,
`REVEL_ADMIN_EMAILS`, `REVEL_ADMIN_NOTIFY_EMAIL`, `RESEND_FROM_EMAIL`,
`OKX_PAY_TO`, `OKX_PAY_NETWORK`, `OKX_PAY_ASSET`, `OKX_PAY_ASSET_SYMBOL`,
`OKX_PAY_ASSET_DECIMALS`, `OKX_AUDIT_PRICE_USD`, `ANALYSIS_PROVIDER`,
`ANALYSIS_MODE`, `AGENT_MAX_STEPS`, `NVIDIA_*` (non-key), `GROQ_MODEL*`,
`OPENROUTER_MODEL*`, `GEMINI_MODEL*`, `AUDIT_MIN_PAGES`,
`AUDIT_MAX_PAGES`, `AUDIT_BUDGET_MS`, `PROVIDER_REQUEST_TIMEOUT_MS`,
`PROVIDER_MAX_RETRIES`, `WEEKLY_AUDIT_LIMIT`, `NOTION_TITLE_PROPERTY`,
`INDEXNOW_KEY`, optional `INDEXNOW_DISABLED`, `AUTH_DEBUG`, SEO
verification codes.

**Not used on Cloudflare**: `DATABASE_URL`, `DIRECT_URL`, `SUPABASE_*`,
`USE_PRISMA_LOCAL`, `VERCEL*`.

**Set automatically by Workers Builds**: `CI`, `WORKERS_CI`,
`WORKERS_CI_BRANCH`, `WORKERS_CI_COMMIT_SHA`, `WORKERS_CI_BUILD_UUID`.

---

## Appendix B — Exact Cloudflare settings

- Worker name: `revel`
- Repository: `BlindspotLab-Limited/revel`, production branch `main`
- Root directory: repository root (empty)
- Build command: `npm run build:cloudflare`
- Deploy command: `npm run deploy:cloudflare`
- Non-production deploy command (if previews enabled):
  `npm run upload:cloudflare`
- Node.js: 22 (pinned by `.node-version`)
- Config file: `wrangler.jsonc` (no account-specific values; the build
  writes the git-ignored `wrangler.deploy.jsonc` with the Hyperdrive ID)
- Compatibility: date `2026-10-01`, flags `nodejs_compat`,
  `global_fetch_strictly_public`
- CPU limit: 300,000 ms (Workers Paid)
- Workflow: `revel-audit` → class `AuditWorkflow`, binding `AUDIT_WORKFLOW`
- Cron: `0 6 * * *`

Why `npm run …` instead of the default `npx wrangler deploy`: the OpenNext
adapter must build the Next.js app first, and the deploy must use the
generated config that carries your Hyperdrive ID.

---

## Appendix C — GitHub Actions helpers (optional, manual only)

Both run only when you press **Run workflow**; neither runs on push.

**C1. Cloudflare: smoke test** — read-only checks of any deployment URL
(steps 8 and 10).

**C2. Cloudflare: disable Hyperdrive query caching** — for step 2 if the
dashboard has no caching option.

1. Cloudflare → **My Profile → API Tokens → Create Token → Custom
   token**: permission **Account → Hyperdrive → Edit**, your account
   only. Copy the token.
2. Your account ID: Cloudflare → **Workers & Pages** → shown in the
   right-hand column (or the URL after `dash.cloudflare.com/`).
3. GitHub → repo **Settings → Secrets and variables → Actions → New
   repository secret**: `CLOUDFLARE_API_TOKEN` and
   `CLOUDFLARE_ACCOUNT_ID`.
4. **Actions → Cloudflare: disable Hyperdrive query caching → Run
   workflow** → paste the Hyperdrive ID → **Run**. The log ends with
   `caching: {"disabled":true}`.
5. Delete the API token afterwards if you won't need it again.

---

## Appendix D — For developers

- Local development is unchanged: `npm run dev` (Node.js, `.env.local`).
- Run the production Worker locally in `workerd`:
  `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE=postgres://…local… npm run preview:cloudflare`
  (runtime values from `.dev.vars`, git-ignored). Never point it at
  production.
- Tests: `npm test` (unit + orchestration + x402 mocks),
  `npm run test:cloudflare` (workerd compatibility probe; add
  `TEST_DATABASE_URL` for the full app suite against a throwaway DB),
  `npm run typecheck`, `npm run typecheck:cloudflare`.
- Prisma: one schema, two generated clients — `lib/generated/prisma`
  (Node.js) and `lib/generated/prisma-workerd` (Workers; the Cloudflare
  build aliases to it). Migrations are unchanged and are never run by
  builds. `DIRECT_URL` remains the migration connection.
- Code map: `cloudflare/worker.ts` (entry: fetch + cron + Workflow export),
  `cloudflare/audit-workflow.ts`, `app/api/internal/audit-run/route.ts`
  (HMAC-protected), `services/audit-dispatch.ts`, `lib/prisma.ts`,
  `lib/runtime/cloudflare.ts`, `scripts/cloudflare/*`.

---

## Appendix E — Verified locally vs pending on your account

Verified in this repository without a Cloudflare account (local `workerd`
+ throwaway Postgres): build and bundle (6.5 MB gzipped), Prisma through
Hyperdrive's local mode, sign-up / sign-in / sessions / sign-out, Mission
Control and admin pages, MCP Streamable HTTP + CORS, x402 402-challenge
and fail-closed 503 (mocked facilitator), partner credits charged once,
audit dispatch → Workflow → terminal state, duplicate-run protection,
cron trigger, crypto compatibility (tokens encrypted on Node.js decrypt in
`workerd`), subdomain routing, security and cache headers.

Pending — only possible on your account (step 8 / 10):

- First real Workers Build + deploy (and the startup-time check).
- Hyperdrive → Supabase connectivity and the caching setting.
- A real audit end-to-end with live AI providers.
- Google OAuth round-trip, password-reset email, Linear/Notion/GitHub
  exports with existing stored tokens.
- OKX facilitator accepting the production credentials.
- Custom domains and certificates; cron firing at 06:00 UTC.
