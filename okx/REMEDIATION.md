# OKX.AI ASP listing — rejection remediation

**Listing:** Agent "Revel", role `asp`, on OKX.AI / Onchain OS
**Submission tool:** `onchainos agent create --role asp`
**Status:** Fixes implemented and locally verified. **Not yet deployed, not yet
resubmitted.**

---

## 1. Reason explicitly stated by OKX

Verbatim, from the rejection notice supplied by the owner:

> **Your Agent "Revel" Listing Review Rejected**
> We're sorry to inform you that your Agent "Revel" did not pass review.
> Reason:
> **No.1** — The service you submitted is missing a complete description,
> parameter details, and usage examples. Please make these updates and resubmit.

That is the **only** reason OKX stated. There was no mention of payments,
endpoint availability, or protocol conformance.

### Root cause

The submitted `--service` payload came from `.tmp-revel-service.json`, an
untracked file that no longer exists, so the exact rejected payload cannot be
recovered. What *can* be established is the rule it failed, by running OKX's own
local validator:

```
onchainos agent validate-listing --role asp --name Revel --description <…> --service <…>
```

The validator enforces a **structured** `serviceDescription`. Rule **D1**:

> Service description must have 2 parts: a core-capability summary and **what
> the user must provide**, on separate lines.

"What the user must provide" *is* the parameter detail OKX's rejection named.
A single-paragraph description — however long — fails D1 regardless of content.

### Full rule set discovered (by probing the validator)

| Code | Rule |
|------|------|
| D1 | Service description must have 2 parts on separate lines: capability summary, then what the user must provide |
| D2 | Service description ≤ 400 CJK / 800 half-width characters total |
| D3 | Part 1 ≤ 200 CJK / 400 half-width characters |
| D4 | Part 2 ≤ 200 CJK / 400 half-width characters |
| D6 | Service description must not contain a URL |
| D8 | Agent description ≤ 500 characters |
| PARSE | `fee` must be a JSON **string** (`"0.35"`). A numeric `0.35` is rejected as an unparseable service array |

The `fee`-must-be-a-string rule is undocumented in `--help`, which describes it
as a "plain number". A numeric value produces a misleading
`--service is not a valid JSON array of service objects` error.

### Fix applied

| Item | Before | After |
|------|--------|-------|
| Submission payload | Untracked `.tmp-revel-service.json`, unreviewable | Committed `okx/revel-asp-service.json` + `okx/revel-asp-listing.json` |
| Service description | Single block of prose | Two parts on separate lines: capability summary, then required/optional parameters and the call sequence |
| Parameter details | Absent | `url` (required, absolute public http(s) URL); `timeoutSeconds` (optional, default 180, max 300); `format` (`markdown`/`json`) |
| Usage example | Absent | Call sequence stated in part 2: `revel_analyze_website` → poll `revel_get_analysis` until `completed`/`partial`. Full worked examples published at `/docs/mcp` (URLs are disallowed in the field itself by rule D6) |
| `fee` | Numeric | String `"0.35"` |
| Agent description | 534 chars | 494 chars |

### Verification evidence

```
$ node scripts/validate-revel-listing.mjs
{
  "pass": true,
  "findings": []
}

Listing PASSES local marketplace validation.
```

Reproduce with `npm run okx:validate`. This is a pure-local check — the
validator makes no network call and nothing is submitted.

### Remaining limitation

Passing the local validator proves the listing satisfies the **mechanical**
rules OKX publishes in the CLI. It cannot prove a human reviewer will accept
the wording. If a second rejection arrives, capture the verbatim text — the
previous one was never stored, which is why the root cause had to be
reconstructed from the validator rather than read from the feedback.

---

## 2. Reproducible defects found during review

These were **not** cited by OKX. They are real, independently confirmed, and
would each have blocked a working paid integration.

### 2.1 Every paid request returned HTTP 500 with an empty body

**Severity: critical.** Confirmed against production on 2026-10-13.

```
$ curl -i -X POST https://tryrevel.xyz/api/mcp -d '{}'
HTTP/1.1 500 Internal Server Error
Content-Length: 0

$ curl -i -X POST https://tryrevel.xyz/api/audit -d '{}'
HTTP/1.1 500 Internal Server Error
Content-Length: 0
```

A `tools/call` on the billable `revel_analyze_website` also returned 500.
Free paths (`initialize`, manifest) worked normally.

The x402 standard self-check is `POST <endpoint>` → expect **402 +
`PAYMENT-REQUIRED`**. It returned 500, so no agent could ever pay.

**Root cause**, traced end to end and reproduced locally:

```
$ node tmp-check-okx.js
OKX getSupported failed: 401

$ # resource server initialize
INITIALIZE_THREW: Error | Failed to initialize: no supported payment kinds
                  loaded from any facilitator.
```

Production confirms the same state:

```
$ curl -s https://tryrevel.xyz/api/health
"okxBilling": {
  "enabled": true,
  "status": "error",
  "error": "Failed to initialize: no supported payment kinds loaded from any facilitator."
}
```

1. `isOkxBillingEnabled()` only checked that four env vars were **non-empty** —
   not that the facilitator accepted them. It returned `true`.
2. The manifest therefore advertised `"enabled": true` and a `$0.35` price.
3. `ensureOkxResourceServerReady()` → `initialize()` → facilitator
   `getSupported()` → **HTTP 401** → throw.
4. `app/api/mcp/route.ts` and `app/api/audit/route.ts` awaited that with **no
   try/catch**, so the throw became Next.js's generic empty 500.

**Fix:**
- `getResourceServerReadiness()` — non-throwing readiness check with a 30s
  negative cache (`lib/billing/okx-x402.ts`).
- Both paid routes translate failure into **HTTP 503 with a JSON body**
  (`retryable: true`), and wrap the paywall call in try/catch.
- A self-minted 402 was deliberately **not** used: if the facilitator cannot
  verify a payment, inviting one would take money that cannot be settled.
- The manifest now reports `configured` (env present) and `operational`
  (facilitator actually accepted the credentials) separately.

**Still required from the owner:** the 401 itself is a credentials problem, not
a code problem. New OKX Developer Portal API credentials must be issued and set
on Vercel. Steps are in `ops-local/okx-credentials.md`.

### 2.2 Billing unit was advertised inaccurately

The manifest declared `unit: "completed_audit"` while the note in the same
object said "One charge per started audit" — and the charge did in fact occur
when the billable tool was invoked, before any report existed.

**Fix:** `unit` is now `"audit_request"`, with an explicit `refundPolicy` field
stating that a request failing before a report is produced is refundable, and
that partial-coverage reports are delivered, charged, and state which pages
failed.

### 2.3 Partner API ran every audit twice

`startWebsiteAnalysis()` already schedules the run via `after()`. The partner
route called it and then scheduled `runAnalysis` **again**, so every partner
request executed the full AI pipeline twice — double provider spend and a write
race on the same row.

**Fix:** the duplicate scheduling was removed from
`app/api/partner/v1/analyze/route.ts`.

### 2.4 Audit quality defects

Nine separate defects in evidence handling were confirmed and fixed; the most
consequential for a paying agent:

- A missing `OPENROUTER_API_KEY` returned a hard-coded **fabricated sample
  report**, stored as `status: "completed"` and indistinguishable from a real
  audit. Removed entirely.
- A failed live fetch fell back to auditing **the domain name alone**. Removed.
- Navigation labels were extracted *after* `<nav>` was stripped from the DOM, so
  nav evidence was always empty.
- Report validation checked text length but never whether cited evidence
  existed. Quotes are now verified against fetched pages.

Full detail in the delivery report.

---

## 3. Unconfirmed hypotheses

Stated as hypotheses because no evidence confirms them:

- **That the 500s contributed to the rejection.** Plausible — a reviewer probing
  the endpoint would have hit them — but OKX cited only the service description,
  and a reviewer who stopped at the listing metadata may never have called the
  endpoint. Unconfirmed.
- **Why the OKX credentials return 401.** Expiry, a lost passphrase, revocation,
  or an account-side issue are all consistent with the observed behaviour.
  The owner believes they expired. Not independently confirmed.
- **Whether the rejected payload actually lacked parameter details**, as opposed
  to having them in prose that failed the two-part D1 structure. The payload is
  unrecoverable, so this cannot be settled.

---

## 4. Resubmission readiness

| Gate | State |
|------|-------|
| Listing passes local marketplace validation | **Yes** — `pass: true`, zero findings |
| Submission materials reviewable in version control | **Yes** — `okx/` |
| Paid endpoints return a standards-compliant response instead of 500 | **Code fixed**, not deployed |
| Facilitator accepts credentials | **No** — 401; new credentials required |
| Payout address reachable by the owner | **No** — new address supplied, not yet set on Vercel |
| Fixes deployed to production | **No** — deployment is outside this task |

### Status: **ready for resubmission after deployment**

The submission must not claim these fixes are live until they are. Specifically,
do not resubmit while `/api/health` still reports
`"okxBilling": { "status": "error" }` — a reviewer checking the advertised
endpoint would find the paid path unavailable.

### Order of operations

1. Issue new OKX Developer Portal API credentials; set them on Vercel.
2. Set `OKX_PAY_TO` to the new receiving address on Vercel.
3. Deploy this branch.
4. Confirm `/api/health` → `"status": "healthy"`, and
   `curl -i -X POST /api/mcp -d '{}'` → **402 + PAYMENT-REQUIRED**.
5. Run `npm run okx:validate` once more against the final text.
6. Submit with `npm run okx:submit -- --confirm`.
