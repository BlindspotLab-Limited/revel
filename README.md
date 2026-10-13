# Revel

> Find the hidden gaps stopping your product from growing.

**A BlindspotLab Product.** Revel reads your public website the way a product
strategist would, then tells you what your positioning, messaging and
conversion copy are failing to communicate — with the page text that proves it.

**Live:** [tryrevel.xyz](https://tryrevel.xyz) ·
**Docs:** [docs.tryrevel.xyz](https://docs.tryrevel.xyz) ·
**Pricing:** [tryrevel.xyz/pricing](https://tryrevel.xyz/pricing)

---

## What Revel does

You give Revel a public website URL. It fetches the homepage and the key pages
it can find (pricing, about, features, product), extracts the on-page text, and
returns four things:

| Output | What it is |
|--------|-----------|
| **Reveal Index** | A 0–100 score summarising how clearly the site communicates its product |
| **Blindspot Map** | The specific problems found, each tied to the page text that evidences it |
| **Blueprint** | An ordered plan — what to fix first, with effort and expected impact |
| **Action Queue** | Individual tasks you can hand to a person or paste into a tracker |

Every finding carries its evidence. Quoted page text is checked against the
pages Revel actually fetched before the report is accepted, so a finding cannot
quote something that is not on your site.

## Who it helps

- **Founders** who are too close to their own copy to see what a stranger does not understand.
- **Product and growth teams** who need a prioritised list rather than a vague critique.
- **Agencies and consultants** running a fast first-pass review before a deeper engagement.
- **Platforms and marketplaces** that want listing or site quality scored automatically — see the Partner API below.

## What Revel looks for

- Positioning that never states who the product is for or what outcome it delivers
- Headlines and subheads that describe features instead of results
- Missing or buried pricing signals
- Absent trust and proof elements in the page copy
- Call-to-action labels that do not tell the visitor what happens next
- Navigation and page structure that omit what a buyer is looking for
- Competitive positioning that does not differentiate

---

## Start an audit

**On the web.** Sign in at [tryrevel.xyz/mission-control](https://tryrevel.xyz/mission-control),
paste a public URL, and run it. An audit normally takes one to three minutes.
Results appear in Mission Control and stay in your history.

**From an agent or your own code.** Revel exposes an MCP server and a Partner
API — see [For API and agent consumers](#for-api-and-agent-consumers).

Revel only reads **public** pages. It cannot sign in, bypass a paywall, or read
anything behind authentication.

---

## Reading your report

### Reveal Index

A single 0–100 score. Treat it as a relative signal to track over time, not an
industry benchmark — it is produced from your site's own copy, not from a
comparison set.

### Blindspot Map

Each blindspot carries:

- **Priority** — `critical`, `high`, `medium` or `low`
- **Category** — `product`, `ux`, `messaging` or `competition`
- **Description** — what is wrong, quoting your page text or naming a verified absence
- **Suggested fix** — specific steps, not generic advice
- **Evidence** — how the claim is supported:

| Basis | Meaning |
|-------|---------|
| `measured` | Read directly from your page markup — an exact string, or an element verifiably present or absent |
| `observed` | A reading of the fetched text that someone else could reproduce |
| `inferred` | Judgement or comparison, not grounded in a specific quote |

**Treat `inferred` findings as opinion.** They are often useful, but they are
not measurements, and Revel labels them so you can tell the difference.

### Blueprint

Ordered steps with estimated effort and expected impact. Work top-down: the
order reflects what unblocks the most value earliest.

### Action Queue

Discrete tasks with an expected outcome each. These are what you export into a
tracker.

### How to prioritise

1. Start with `critical` and `high` blindspots whose evidence is `measured`. These are real, confirmed and consequential.
2. Then take blueprint steps marked `high` impact with low estimated effort.
3. Treat `inferred` findings as prompts for a conversation, not instructions.
4. Re-run the audit after you ship changes and watch whether the specific findings disappear.

A good site will get **few findings**. Revel has no minimum finding count and
does not inflate severity to look thorough — if there is nothing critical, it
says so.

---

## Coverage and limitations

Revel is a **product, messaging and UX-copy review built from server-rendered
HTML text**. Being precise about this matters, because the word "audit" invites
assumptions that would be wrong here.

Every report includes a coverage block listing the pages fetched, the pages that
failed, timestamps, and the checks that did and did not run.

**What runs:** HTML fetch, title and meta-description extraction, heading
extraction, CTA and navigation label extraction, internal link discovery,
positioning and messaging review, conversion-copy review.

**What does NOT run** — and is reported as unsupported in every report:

| Not included | Why |
|--------------|-----|
| Layout, spacing, visual hierarchy | No page is rendered; there is no browser in the pipeline |
| Colour contrast / WCAG accessibility | Requires computed styles from a rendered page |
| Mobile and responsive behaviour | No viewport emulation |
| Page speed / Core Web Vitals | No performance instrumentation or field data |
| Technical SEO (robots.txt, sitemap, canonical, hreflang, structured data) | Not parsed |
| Search rankings or index status | No search-console or SERP data source |
| Broken-link verification | Links are discovered, not individually status-checked |
| Competitor benchmarking from live competitor sites | No competitor page is fetched |
| Content rendered only by client-side JavaScript | Extraction reads the server HTML response |

Revel will not claim to have seen something it did not fetch. A page that fails
to load is reported as a failed fetch — never as evidence that a feature is
missing.

### Partial results

If some pages load and others do not, the audit is marked **partial**. You still
get a report, and the coverage block names each page that failed and why. A
partial report is not a failed one — it is a complete report over less evidence,
and it says so.

---

## Exports and integrations

**Always available, no connection required:**

- Markdown download
- GitHub-flavoured Markdown
- JSON

**Optional, per-user OAuth connections** under Mission Control → Integrations:

| Destination | Where the export lands |
|-------------|------------------------|
| Linear | Your own Linear team |
| Notion | Pages or databases you grant |
| GitHub Gist | Your own **private** gist |

These use **your** account, not a shared BlindspotLab workspace. Tokens are
stored encrypted and deleting the connection deletes them.

---

## For API and agent consumers

Full reference: **[docs.tryrevel.xyz](https://docs.tryrevel.xyz)** ·
[MCP docs](https://tryrevel.xyz/docs/mcp) ·
[API docs](https://tryrevel.xyz/docs/api) ·
[Partner docs](https://tryrevel.xyz/docs/partners)

### MCP (agents)

Streamable HTTP at `https://tryrevel.xyz/api/mcp`, manifest at
`/api/mcp/manifest`. Tools:

| Tool | Purpose |
|------|---------|
| `revel_health` | Capability and status check |
| `revel_analyze_website` | Start an audit, returns an `analysisId` |
| `revel_get_analysis` | Poll status and fetch the report |
| `revel_wait_for_analysis` | Block until the audit finishes |
| `revel_analyze_website_and_wait` | One-shot audit |
| `revel_export_blueprint` | Export a finished report as markdown or JSON |
| `revel_fetch_url` | Extract readable text from a public page |

Over HTTP, prefer `revel_analyze_website` then poll `revel_get_analysis` —
long blocking calls are prone to intermediary timeouts.

### Partner API

For platforms integrating Revel into their own product. Keys are issued per
partner (`rvl_pk_…`) and used against `/api/partner/v1/analyze` and
`/api/partner/v1/report/{id}`. Apply at
[tryrevel.xyz/partners](https://tryrevel.xyz/partners).

[Arcapush](https://arcapush.com) consumes this API for its listing-quality
check. It is an integration partner that calls Revel; it does not own or
operate Revel.

### Paid agent access

Billable MCP tools support the OKX Agent Payments Protocol (x402). Discovery,
polling, health and export calls are free. Current price, network, receiving
address and live operational status are published at
[`/api/mcp/manifest`](https://tryrevel.xyz/api/mcp/manifest) and
[`/api/health`](https://tryrevel.xyz/api/health) — check those rather than
relying on a figure copied into documentation.

---

## Pricing and usage limits

The canonical source is **[tryrevel.xyz/pricing](https://tryrevel.xyz/pricing)**.

Currently enforced in the product:

- **Mission Control (web):** 3 audits per week per signed-in account, resetting Monday 00:00 UTC.
- **Partner API:** per-partner access — whitelisted, trial, or prepaid credits — plus a per-partner rate limit.
- **Agent access (x402):** priced per audit request; the live figure is in the manifest.

Revel does not offer unlimited usage on any tier.

---

## Support and feedback

- **Support and feedback:** hello@mail.tryrevel.xyz
- **Security reports:** hello@blindspotlab.xyz
- **Sample report:** a public example is linked from the homepage
- **Studio:** [blindspotlab.xyz](https://blindspotlab.xyz)

---

## Ownership and licence

Revel is **A BlindspotLab Product**, owned and operated by **BlindspotLab
Limited**.

The software is licensed under the **Apache License, Version 2.0** — see
[LICENSE](LICENSE).

The Apache licence covers the software only. The **Revel** and **BlindspotLab**
names, logos and visual identity are trademarks of BlindspotLab Limited and are
**not** licensed under Apache-2.0. See [NOTICE](NOTICE) for trademark terms and
third-party attribution.

---

## Contributing and development

Development setup, environment configuration, database migrations and
deployment live in **[docs/development.md](docs/development.md)**, not here.
