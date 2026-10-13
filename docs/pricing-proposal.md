# Pricing proposal — for review, not implemented

**Nothing in this document has been applied.** Live billing amounts, account
entitlements and partner charges are unchanged. This is a proposal for the
owner to approve, reject or amend.

---

## 1. What is enforced today

Verified by reading the enforcement code, not the marketing copy.

| Surface | Entitlement | Enforced in |
|---------|-------------|-------------|
| Mission Control (web) | **3 audits per signed-in account per week**, resetting Monday 00:00 UTC. Admins exempt. | `lib/weekly-audit-limit.ts`, default in `lib/weekly-audit-limit-config.ts` (`WEEKLY_AUDIT_LIMIT`, capped at 20) |
| Web rate limit | 5 requests / 60s per key | `app/api/analyze/route.ts` |
| Partner API | `whitelisted` → free · `trial` → free · `paid` → 1 prepaid credit per audit · otherwise HTTP 402 | `lib/partner-billing.ts` |
| Partner rate limit | per-partner window | `lib/partner-rate-limit.ts` |
| Agent / MCP (x402) | **$0.35 per audit request** (`OKX_AUDIT_PRICE_USD`, capped at $10) | `lib/billing/okx-x402.ts` |
| Anonymous web use | No audits without sign-in | `getCurrentUserId()` gate |

### Gaps found

1. **`trial` partners have no cap at all.** `checkPartnerBilling` returns
   `allowed: true` for `accessType: "trial"` with no counter and no expiry — an
   unlimited free tier by accident. There is no `trial_quota` column.
2. **`whitelisted` partners are likewise uncapped.** Acceptable for a deliberate
   partnership, but it is unbounded exposure with no alerting.
3. **Credits are consumed on request, not on delivery.** `reservePartnerCredit`
   decrements before the audit runs; a failed audit still costs the partner a
   credit, with no refund path.
4. **No refund or re-credit mechanism exists** for failed audits on any surface.
5. **Pricing copy drift.** `/pricing` presents "free early access"; the x402
   manifest advertises $0.35. Both are true for different surfaces, but no page
   explains the relationship.

---

## 2. Cost basis

**All figures below are ESTIMATES.** Reproduce with
`node scripts/estimate-audit-cost.mjs`; every assumption is labelled in that
file. They are engineering estimates, not measurements — and that is precisely
why the per-attempt usage accounting shipped in this branch exists. Once
`ai_usage_events` has production traffic, replace these with measured figures
from **Mission Control → AI Usage** before committing to a price.

### Per-audit variable cost (estimated)

| Component | Estimate | Basis |
|-----------|----------|-------|
| Groq agentic run | $0.0354 | 6 calls × ~8k in / ~1.5k out at $0.59/$0.79 per 1M |
| OpenRouter single-shot | $0.0120 | 1 call × ~15k in / ~3k out at $0.30/$2.50 per 1M |
| Blended AI incl. 20% fallback (wasted attempts counted) | **$0.0350** | 20% of audits burn ~60% of a Groq run, then pay OpenRouter too |
| Vercel compute | $0.0077 | ~90s active, 1.7 GB, order-of-magnitude |
| **Total variable cost** | **~$0.043** | |

Not included (fixed, not per-audit): Supabase, domains, email, monitoring.

### Margin at candidate prices

| Price / audit | Gross margin |
|---------------|--------------|
| $0.20 | 78.7% |
| **$0.35** (current) | **87.8%** |
| $0.50 | 91.5% |
| $0.75 | 94.3% |

**The current $0.35 is not the problem.** Headroom is comfortable even with
fallback waste counted. The real exposure is the uncapped free tiers, not the
unit price.

### Cost drivers to watch

- **Retries and fallbacks**, now measured per attempt. A rise in fallback rate
  raises unit cost without any change in traffic.
- **Reasoning tokens** if NVIDIA reasoning is enabled — billed as output, and on
  a 120B model that is the single largest swing factor.
- **Page count.** `AUDIT_MAX_PAGES` directly scales input tokens; raising it
  from 4 to 8 roughly doubles the input bill.
- **Rejected reports.** Each evidence-validation rejection costs a full
  generation and is now recorded as `report_rejected`.

---

## 3. Proposed structure

### 3.1 Trial — "Look first"

| | |
|---|---|
| Price | Free |
| Allowance | **3 audits per week** per account (unchanged), **and a lifetime cap of 10 audits** |
| Rationale | The weekly reset currently makes the free tier unbounded over time: 3/week is 156 audits/year per account, ~$6.70 of variable cost each, with no conversion pressure. A lifetime cap turns it into a genuine trial. |
| Failed audits | Do not count against the allowance |
| Partial audits | Count as one audit |

### 3.2 Paid audit allowance — "Revel Pro"

| | |
|---|---|
| Price | **$29 / month** |
| Allowance | **100 audits / month** |
| Effective unit | $0.29/audit at full use |
| Estimated cost at full use | ~$4.30 → ~85% gross margin |
| Additional usage | **$0.40 per audit** beyond 100, billed in arrears |
| Rollover | None. Unused audits expire monthly. |
| Rationale | 100/month covers a team auditing their own properties plus prospects. Overage is priced above the subscription's effective unit so heavy users are nudged to the next tier rather than subsidised. |

**Not "unlimited".** No tier promises unlimited usage.

### 3.3 Agent / MCP (x402)

| | |
|---|---|
| Price | **$0.35 per audit request** — unchanged |
| Billing unit | `audit_request`, now advertised accurately (was mislabelled `completed_audit`) |
| Failed audits | Refundable on request; see 3.5 |

### 3.4 Partner / API

| Tier | Allowance | Overage |
|------|-----------|---------|
| `trial` | **50 audits, expiring 30 days after issue** — currently uncapped | Blocked; must convert |
| `whitelisted` | Negotiated cap, **recorded on the partner record** — currently uncapped | Blocked at cap, alert raised |
| `credits` | Prepaid, 1 credit per audit | Blocked at zero |

Requires schema work: `trial_quota`, `trial_expires_at`, and a cap column for
whitelisted partners. **Not implemented** — proposed only.

### 3.5 Failed and partial audits

The current behaviour is the least defensible part of the model: a credit is
consumed before the audit runs, and there is no refund path anywhere.

| Outcome | Proposed treatment |
|---------|--------------------|
| `completed` | Charged in full |
| `partial` (report delivered, some pages unreachable) | **Charged in full.** The report is usable and names every page that failed. Stated up front, not discovered afterwards. |
| `failed` (no report) | **Not charged.** Web/partner: credit automatically restored. x402: refundable on request. |
| Duplicate request for the same URL within 10 minutes | Return the existing `analysisId`; charge once |

Implementation needed: restore the partner credit in `markAnalysisFailed`, and
publish the x402 refund path. The manifest now carries a `refundPolicy` field
stating this; **the automatic credit restore is not yet implemented.**

---

## 4. Assumptions this rests on

1. Token estimates are engineering guesses; nothing has been measured in production yet.
2. Groq list pricing ($0.59/$0.79 per 1M) came from third-party aggregators, not a billing API.
3. Vercel compute cost is order-of-magnitude.
4. A 20% fallback rate is assumed, not observed.
5. NVIDIA has **no** published per-token USD price, so NVIDIA audits are currently unpriceable — recorded as `unknown`, never as $0.
6. Fixed infrastructure is excluded, so these are gross-margin figures, not contribution after overhead.

---

## 5. What is needed before any of this ships

1. **Owner approval** of prices, allowances and the failed-audit policy.
2. **Two weeks of measured usage** from the new KPI dashboard, to replace the estimates in §2.
3. **Schema work** for trial quotas and partner caps.
4. **Credit restore on failure** in `markAnalysisFailed`.
5. **Copy alignment** across `/pricing`, the landing page, `/docs/*` and the x402 manifest — all driven from one config value, so they cannot drift again.

No live billing amount, entitlement or customer plan changes until that approval.
