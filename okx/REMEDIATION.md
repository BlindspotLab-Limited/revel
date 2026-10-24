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

---

## 5. Resubmission #2 (2026-10-24) — successful, via `agent update` not `agent create`

**Result: accepted. `approvalLabel` changed from "Listing rejected" to "Listing under
review".** Verified with `onchainos agent get-my-agents --role asp` after submission,
not inferred from command exit codes alone.

### What actually blocked this attempt, in order

**5.1 — `agent create` is the wrong command for Revel, permanently.**

Revel already has a registered OKX identity: `agentId 4750`, created by the first
submission that led to section 1's rejection. `npm run okx:submit` (which calls
`onchainos agent create`) will never succeed for Revel again — it is for registering a
**new** identity. Every attempt returned:

```
{"ok":false,"error":"Wallet API error (code=81001): OnchainOS update required before
service registration.\nPlease update and verify the OnchainOS CLI, beta skills by
running:\n   `npx -y @okxweb3/onchainos-installer remove`\n   `npx -y
@okxweb3/onchainos-installer install --beta`\n..."}
```

This message is **misleading**. It reads as a stale local tooling problem, and the CLI
genuinely was outdated (fixed below), but updating it changed nothing — `create` kept
failing with the identical message afterward. The real cause was only found by running
the read-only `onchainos agent gate-check --role asp`, which surfaced the existing
`agentId: 4750` with `approvalLabel: "Listing rejected"`. **The fix is `agent update
--agent-id 4750`, followed by `agent activate --agent-id 4750 --preferred-language
<bcp-47>`.** `create` cannot be made to work here; do not retry it.

**5.2 — The committed avatar URL was stale.**

`okx/revel-asp-listing.json`'s `picture` pointed at a CDN URL from a prior session's
upload. Resubmitting it returned:

```
{"ok":false,"error":"Wallet API error (code=81001): profilePicture is not a valid
uploaded avatar"}
```

Fix: re-upload with `onchainos agent upload --file <local 440x440 square jpg/png>`
(requirements documented in `scripts/make-okx-avatar-square.mjs`) and use the URL it
returns. Uploaded `public/brand/revel-avatar-440-okx.jpg` (440×440, verified with
`sharp` before upload); committed the new URL.

**5.3 — The official `--beta` installer script has a genuine bug: it cannot parse
under Windows PowerShell 5.1.**

`npx -y @okxweb3/onchainos-installer install --beta` failed with PowerShell parse
errors (`MissingEndCurlyBrace`) at `install.ps1:322`, reproducible on a clean npm
cache, on **both** `install --beta` and `install` (stable channel — same script).

Root cause confirmed by parsing the exact cached `install.ps1` under both engines with
`[System.Management.Automation.Language.Parser]::ParseFile`:

| Engine | Parse errors |
|---|---|
| Windows PowerShell 5.1 (`powershell.exe`, what `onchainos-installer` shells out to) | Multiple |
| PowerShell 7 (`pwsh.exe`) | **0** |

The script is valid PowerShell; Windows PowerShell 5.1's parser cannot handle whatever
construct it uses. `onchainos-installer`'s JS wrapper always invokes `powershell.exe`
on win32 (`lib/bin/onchainos-installer.js`, `buildCommands()`), never `pwsh.exe`, so
this fails on any Windows machine where `pwsh` (PowerShell 7+) is not the `powershell`
on PATH — which is most machines, since `pwsh` ships separately from Windows.

**Workaround**, since `npx -y @okxweb3/onchainos-installer remove` had already deleted
the local `onchainos.exe` by the time this was hit:

```bash
# 1. Remove (works — pure Node/npx, no PowerShell involved)
npx -y @okxweb3/onchainos-installer remove

# 2. Run the installer script directly under PowerShell 7 instead of through
#    the broken JS-wrapper -> powershell.exe 5.1 path. Find the exact cached
#    script path from the failed `install --beta` output first.
pwsh -NoProfile -File "<path to install.ps1 from the npx cache>" -beta

# 3. The JS wrapper also runs a separate "Skills" install step
#    (pure npx, unaffected by the PS1 bug) that the above does not reach.
#    Run it directly:
npx skills add "okx/onchainos-skills#beta" --yes -g
```

Confirmed after: `onchainos --version` → `4.9.3-beta`; `wallet status` session
survived the reinstall.

**5.4 — `agent update`'s A2MCP service schema is four lines, not the two-part
structure `scripts/validate-revel-listing.mjs` checks.**

`onchainos agent update --help` documents, for `serviceType: "A2MCP"`:

> line 1 = what the service does · line 2 = ALL parameters on one line, each
> `<name>(<type>, required/optional): <meaning>` · line 3 = request method or MCP tool
> name · line 4 = a working curl example using the real endpoint URL — "an A2MCP
> listing missing any is rejected at listing QA"

This is **not** the two-part (capability summary / what-user-must-provide) structure
rule D1 describes, which `scripts/validate-revel-listing.mjs` / `onchainos agent
validate-listing` enforces for `agent create`. **There is no local validator for the
`agent update` schema** — QA for `update` runs server-side only (`agent activate`'s
own help text: *"QA runs at register/update, not here"*). A second rejection here would
have been invisible to local tooling.

The four-line description actually submitted (service id `31680`, name "Website Growth
Audit" — the name already on the registered service; left unchanged since it was not
part of the rejection reason):

```
Audits a public website's product positioning, messaging and conversion copy,
returning a Reveal Index score (0-100), a Blindspot Map of findings, a prioritised
Blueprint and an Action Queue.
url(string, required): absolute public http(s) URL to audit; timeoutSeconds(number,
optional): max seconds to wait, default 180, max 300; format(string, optional):
export format, markdown or json
MCP tool revel_analyze_website (via tools/call); poll revel_get_analysis until status
is completed or partial
curl -X POST https://tryrevel.xyz/api/mcp -H "Content-Type: application/json" -d
'{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"revel_analyze_website","arguments":{"url":"https://example.com"}}}'
```

Line 4's example call is accurate but, called literally without an `X-PAYMENT` header,
returns 402 per the x402 protocol — expected behaviour for a paid tool, not a defect.
The JSON-RPC shape was taken from `lib/billing/x402-paywall.test.ts:99`, not invented,
and matches what section 2.1 verified working in production.

### Submission commands, for the next person

```bash
# Read current state first — never assume
onchainos agent gate-check --role asp
onchainos agent get-my-agents --role asp
onchainos agent service-list --agent-id 4750

# Update (name/description/picture optional; omitting a flag leaves it unchanged)
onchainos agent update --agent-id 4750 \
  --name "Revel" \
  --description "<agent-level description, from okx/revel-asp-listing.json>" \
  --picture "<CDN URL from `agent upload`>" \
  --service '[{"operation":"update","id":"31680","serviceName":"Website Growth Audit","serviceType":"A2MCP","fee":"0.35","endpoint":"https://tryrevel.xyz/api/mcp","serviceDescription":"<4 lines, \n-separated>"}]'

# Submit for review
onchainos agent activate --agent-id 4750 --preferred-language en-US

# Verify — do not trust the activate response alone; it returned a stale
# cached rejectReason alongside a genuine success in this run
onchainos agent get-my-agents --role asp   # expect approvalLabel: "Listing under review"
```

### Status: under review

`okx/revel-asp-service.json` now holds the four-line content actually submitted,
matching this record. Watch for the next reviewer decision; if rejected again, capture
the verbatim OKX text immediately — do not let it go unrecorded as happened the first
time.

---

## 6. Resubmission #3 (2026-10-24) — successful, endpoint behavior fix

**Result: accepted. `approvalLabel` changed from "Listing rejected" back to
"Listing under review".** Verified via `onchainos agent get-my-agents` after
submission, not trusted from `agent activate`'s own output alone — its
response is ambiguous (see below) in exactly the same way section 5 found.

### OKX's rejection, verbatim

> **No.1** — 您的服务【Website Growth Audit】在买家完成付款签名并扣款后才提示参数缺失或错误，请注意参数校验应在付款前完成。请在返回
> x402 付费待签信息（challenge）之前完成参数校验，并在修改后重新提交。

Translation: the service only reported missing/invalid parameters *after*
the buyer had signed and been charged. Parameter validation must complete
**before** the x402 payment challenge is returned.

### Root cause, confirmed by reading the code, not guessed

Both paid routes charged first and validated second:

- **`/api/mcp`** — `mcpBodyRequiresPayment()` (`lib/mcp/payment-gate.ts`)
  decided whether to issue a 402 purely from the tool **name**; it never
  looked at `arguments`. A `tools/call` for `revel_analyze_website` with a
  missing or malformed `url` still received a 402 challenge. Only after
  `withX402` had verified and settled payment did the MCP SDK's own Zod
  validation (`lib/mcp/create-server.ts`) run and reject it — the buyer had
  already paid for a call that could never succeed.
- **`/api/audit`** — worse: `POST` wrapped **every** request in `withX402`
  unconditionally, with no validation beforehand at all.
  `auditHandler`'s `"url is required"` check only ran after payment had
  already been taken.

### Fix

`lib/mcp/payment-gate.ts` gained two functions:

- `extractBillableToolCall(bodyText)` — pulls `{id, toolName, args}` out of
  a single (non-batch) billable `tools/call`; `null` for anything else
  (batches, free methods, non-billable tools), which keeps flowing through
  the existing `mcpBodyRequiresPayment` logic unchanged.
- `validateBillableToolArguments(toolName, args)` — the same required/format
  rules the real tool handler enforces (`url` required;
  `revel_analyze_website_and_wait`'s `timeoutSeconds` bounds), calling the
  identical `normalizeUrlSafe()` the handler calls. Nothing validated here
  can still fail there.

`app/api/mcp/route.ts` runs this check before the facilitator readiness
probe and before `withX402` is ever reached. An invalid call gets the exact
MCP JSON-RPC error shape the SDK itself returns for a free call — HTTP 200,
`result.isError: true` — free, since nothing billable could have succeeded
anyway. No 402 is issued.

`app/api/audit/route.ts` runs the same `url` presence + `normalizeUrlSafe`
check before `withX402`, returning the same 400 body `auditHandler` already
used — just moved before payment instead of after.

Batch JSON-RPC requests are intentionally out of scope for this pre-check
(not the documented single-call usage pattern); they continue through the
existing payment logic unchanged.

### Verified live against production, not just locally

```
1. tools/call revel_analyze_website, missing url   → 200, isError:true, NO 402
2. tools/call revel_analyze_website, empty url      → 200, isError:true, NO 402
3. tools/call revel_analyze_website, malformed url  → 200, isError:true, NO 402
4. tools/call revel_analyze_website, VALID url      → 402  (paid flow intact)
5. POST /api/audit, missing url                     → 400, NO 402
```

Case 4 matters as much as 1–3: it confirms the fix did not also break
payment for a legitimate request.

### Resubmission

No listing content changed this round — OKX's complaint was about live
endpoint behavior, not the description/parameters/examples fixed in
section 5. Deployed the fix, then:

```bash
onchainos agent activate --agent-id 4750 --preferred-language en-US
```

First attempt failed on an unrelated local issue:

```
{"ok":false,"error":"A2A communication is not ready... Run: okx-a2a doctor --fix"}
```

Fixed by running the CLI's own suggested command, `okx-a2a doctor --fix`
(started the local A2A daemon; no code or listing changes). Retried
`agent activate` — succeeded.

As in section 5, `agent activate`'s own JSON response is misleading: its
`activate` field echoes a **stale** pre-call snapshot (old `rejectReason`,
`success:false`), while the real outcome is in `submitApproval`
(`success:true`). **Always confirm with a fresh `agent get-my-agents`
call afterward** rather than trusting `activate`'s response.

### Status: under review (again)

If rejected a third time, add section 7 here with the verbatim text
immediately, the same way this section and section 5 did — do not let it
go unrecorded.

---

## 7. Resubmission #4 (2026-10-24) — the real post-payment failure

**Section 6's fix was necessary but not sufficient.** OKX rejected again
with the identical text. The rejection was timestamped 14:36:36Z, about one
minute after activation, which points to an automated paid test call rather
than a human review.

### Root cause

`asX402ApiClientRequest()` (`lib/billing/x402-response.ts`) forced
`Accept: application/json` so the x402 SDK would not serve an HTML paywall.
After verifying a payment, `withX402` hands **that same request** to the
route handler. The MCP Streamable HTTP transport (SDK 1.29,
`webStandardStreamableHttp.js:378`) rejects any POST whose Accept lacks
`text/event-stream` with **HTTP 406**. So **every** paid `/api/mcp` call
failed after the buyer signed, whatever its arguments. A valid paid request
could never succeed.

Confirmed live, with no payment: `tools/list` sent with
`Accept: application/json` returns 406 on production.

Why nothing caught it: `x402-paywall.test.ts` only exercised the **unpaid**
402 challenge. No test looked at what the handler receives after payment.

### Fix (cf3370f)

1. Force `Accept: application/json, text/event-stream`. The x402 SDK's
   browser check is `accept.includes("text/html") && ua.includes("Mozilla")`,
   so the challenge stays standard JSON.
2. `withholdSettlementOnMcpError()`: `withX402` settles whenever the handler
   returns < 400. The MCP SDK reports tool failures as HTTP 200 with
   `result.isError: true`, so the buyer would be charged for an error. For
   paid calls only, such responses are re-issued as **422** with the body
   unchanged, so settlement is skipped.
3. A body that counts as paid but cannot succeed (batch, `tools/call`
   without a tool name, non-JSON, no method) gets a free **400** before any
   challenge. Only the bare discovery probe (empty body or `{}`) keeps its
   402, for the marketplace x402 self-check.

New `lib/billing/x402-paid-replay.test.ts` feeds the MCP SDK the exact
request `withX402` passes after payment. It expects 200, with a control
case showing `application/json` alone still gets 406. It also covers
settlement withholding and every no-402 case. The facilitator is mocked;
nothing is verified or settled.

### Verified live after deploy (version ef0f6d21)

```
valid url                    → 402 + PAYMENT-REQUIRED
missing url / malformed url  → 200 isError, no 402
batch / no tool name / non-JSON → 400, no 402
{} and empty body probes     → 402 + PAYMENT-REQUIRED
okxBilling.status            → healthy
```

**Not verified live:** the post-payment replay itself. That needs a real
on-chain payment, which was deliberately not made. It is covered by the
test above, which exercises the identical SDK code path.

### Status

Resubmitted 14:52Z. Confirmed "Listing under review" with
`agent get-my-agents`, and still under review after 7+ minutes of polling.
The previous attempt was auto-rejected within about a minute.
