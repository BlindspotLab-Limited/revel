# Release checklist — branch `feat/audit-quality-nvidia-kpis`

Nothing here has been deployed. Production is untouched.

> Hosting has since moved to **Cloudflare Workers**. Where this checklist
> says to set a value in production, set it as a Worker secret / variable
> (Cloudflare → Workers & Pages → revel → Settings → Variables and Secrets).
> Deployment steps: [cloudflare-deployment.md](cloudflare-deployment.md).

---

## 0. Pre-flight (blockers)

| # | Blocker | Owner action |
|---|---------|--------------|
| B1 | `NVIDIA_API_KEY` is not set anywhere | Create a key at build.nvidia.com and set it locally + in production (Cloudflare Worker secret). **Until this is set, NVIDIA cannot be primary and no live NVIDIA evaluation has been run.** |
| B2 | `OKX_PAY_TO` still holds the inaccessible wallet `0xe4c9…c5d2` | Set it to `0xA7a2a00D24982c9eBeB16effFd58cEB5DfC94591` in `.env.local` **and** production (Cloudflare) |
| B3 | Production OKX credentials are still the rejected ones (HTTP 401) | Copy the new `OKX_API_KEY` / `OKX_SECRET_KEY` / `OKX_PASSPHRASE` from `.env.local` to production (Cloudflare Worker secrets) |
| B4 | `ai_usage_events` table does not exist | Apply the migration (step 2) |

---

## 1. Environment variables to set in production (Cloudflare Worker)

Values come from your local `.env.local`. Only names are listed here.

**Must change (new values):**

```
OKX_API_KEY
OKX_SECRET_KEY
OKX_PASSPHRASE
OKX_PAY_TO            -> 0xA7a2a00D24982c9eBeB16effFd58cEB5DfC94591
NVIDIA_API_KEY
```

**New, optional (defaults are safe if omitted):**

```
NVIDIA_BASE_URL  NVIDIA_MODEL  NVIDIA_MODEL_FALLBACK
NVIDIA_REASONING  NVIDIA_MAX_OUTPUT_TOKENS  NVIDIA_PRIMARY
OKX_PAY_NETWORK  OKX_PAY_ASSET  OKX_PAY_ASSET_SYMBOL  OKX_PAY_ASSET_DECIMALS
AUDIT_MIN_PAGES  AUDIT_MAX_PAGES  AUDIT_BUDGET_MS
PROVIDER_REQUEST_TIMEOUT_MS  PROVIDER_MAX_RETRIES
```

**Check for a stale value:** if `GROQ_MODEL` or `GROQ_MODEL_FALLBACK` in production
still names `llama-3.3-70b-versatile` or `llama-3.1-8b-instant`, clear them.
Those models return HTTP 404. The code filters them out, but clearing avoids
confusion.

---

## 2. Database migration

Run **before** deploying the app, so the new code never writes to a missing
table. (It degrades gracefully if the table is absent — usage recording logs
and continues — but KPIs would be empty.)

```bash
npx prisma migrate deploy
```

Or, in the Supabase SQL Editor, run `supabase/ai-usage-events.sql`.

The migration is additive only:
- `CREATE TABLE IF NOT EXISTS ai_usage_events`
- `ALTER TABLE analyses ADD COLUMN IF NOT EXISTS completed_at, duration_ms`
- new indexes

No column is dropped or retyped, and no existing row is modified.

---

## 3. Deploy

Deploy `feat/audit-quality-nvidia-kpis` to a **preview** first.

---

## 4. Post-deploy verification

```bash
BASE=https://<preview-url>

# 1. Billing is genuinely healthy, not merely configured
curl -s $BASE/api/health | jq '.okxBilling'
#    expect status "healthy", no "error" field

# 2. Payout points at the new address
curl -s $BASE/api/mcp/manifest | jq '.billing.payout'
#    expect address 0xA7a2…4591, network eip155:196, configured true

# 3. x402 standard check — the one OKX's validator runs
curl -i -X POST $BASE/api/mcp -d '{}'
#    expect HTTP 402 + PAYMENT-REQUIRED header + JSON body
#    (NOT an empty 500; if billing is down, expect 503 + JSON)

curl -i -X POST $BASE/api/audit -d '{}'
#    same expectation

# 4. Free MCP paths unaffected
curl -s -X POST $BASE/api/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"probe","version":"1"}}}'

# 5. Run one real audit from Mission Control, then confirm:
#    - report shows a coverage block with pages fetched/failed
#    - findings carry an evidence basis
#    - /mission-control/ai-usage shows attempts, tokens and cost
```

Also check by eye:
- Landing page: BlindspotLab badge centred above the headline, desktop and mobile.
- Badge is keyboard-focusable with a visible ring, and opens blindspotlab.xyz in a new tab.

**Do not run a paid transaction** without explicit approval.

---

## 5. Promote to production

Only once every check in §4 passes on preview.

---

## 6. OKX resubmission (separate, after deploy)

```bash
npm run okx:validate            # local, no network
npm run okx:submit              # dry run, prints the payload
npm run okx:submit -- --confirm # actually submits
```

Do not submit while `/api/health` reports `okxBilling.status != "healthy"`.
See `okx/REMEDIATION.md`.

---

## Rollback plan

### Fast path — application

Roll back the Worker in the Cloudflare dashboard (Workers & Pages → revel →
Deployments → previous version → ⋯ → Rollback). Takes effect immediately.
See [cloudflare-deployment.md](cloudflare-deployment.md) → Rollback.

The code change is safe to roll back at any time: **the migration is additive
and the old code ignores the new columns and table.** There is no schema
rollback step and no data loss.

### If you must roll back the schema as well

Only if the table itself is a problem. Not required by an app rollback:

```sql
DROP TABLE IF EXISTS ai_usage_events;
ALTER TABLE analyses DROP COLUMN IF EXISTS completed_at;
ALTER TABLE analyses DROP COLUMN IF EXISTS duration_ms;
DROP INDEX IF EXISTS idx_analyses_status;
```

This discards usage history. Prefer leaving the table in place.

### Reports written by the new code

Reports carry `schemaVersion: 2` with extra `evidence` and `coverage` fields.
The previous code path reads reports through `normalizeAnalysisReport`, which
ignores unknown fields — so **v2 reports remain readable after a rollback**,
minus the new display sections.

### Partial rollbacks without a redeploy

| Symptom | Mitigation (env change + redeploy) |
|---------|-----------------------------------|
| NVIDIA underperforming or expensive | `NVIDIA_PRIMARY=false` — demotes to last, keeps the key |
| Want the exact previous routing | Unset `NVIDIA_API_KEY` — chain returns to Groq → OpenRouter → Gemini |
| Audits timing out | Lower `AUDIT_MAX_PAGES` to 2, or `AUDIT_BUDGET_MS` to 180000 |
| Provider calls hanging | Lower `PROVIDER_REQUEST_TIMEOUT_MS` |
| Paid billing misbehaving | Clear `OKX_PAY_TO` — billing reports unconfigured and the paid routes return a clean 503 rather than taking payment |

### Rollback triggers

Roll back if, after promotion:
- `/api/health` shows `okxBilling.status: "error"` and paid traffic is expected
- Audit failure rate on `/mission-control/ai-usage` exceeds the pre-release baseline
- p95 audit duration exceeds 240s (runs are hitting the budget)
- Any report ships a finding quoting text not on the audited site
