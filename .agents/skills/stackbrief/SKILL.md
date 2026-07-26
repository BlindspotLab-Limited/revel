---
name: stackbrief
description: >
  Generates and maintains a stacks.md file that documents a codebase's REAL technical stack -
  not just the generic layer (Next.js, Vercel, Prisma, Supabase, "Codex API") but everything
  behind the build: RAG pipelines, fine-tuning, embeddings, vector databases, agent orchestration,
  evals/observability, and prompt engineering. Use this skill whenever the user asks to
  "document the stack," "write up the tech stack," "create stacks.md," "audit what's actually
  in this codebase," or wants a technical brief of a project for a README, pitch deck, or
  portfolio case study. ALWAYS trigger this when the user mentions prompt engineering
  attribution, "who wrote/optimized the prompts," or wants credit for AI-layer work captured
  in writing. This skill ALWAYS interviews the user for prompt-engineering authorship before
  writing the file - do not skip that step even if the rest of the stack is auto-detected.
author: Mojeeb Titilayo (BlindspotLab) - blindspotlab.xyz
---

# Stackbrief - Real Stack Documentation

Most "tech stack" sections are a lie by omission. They list the framework and the database and
stop there - as if the AI layer (RAG, fine-tuning, agents, evals, and the actual prompt
engineering work) doesn't exist or doesn't matter. It's usually the hardest, least visible part
of the build, and it's the part that goes uncredited.

This skill produces `stacks.md`: a technical brief of what's actually running a project, written
so a human, another LLM, or a hiring manager can read it and understand the real architecture -
including who did the prompt engineering and who optimized it.

## Compatibility

This skill is written in the standard Codex Skill format (YAML frontmatter + Markdown) but the
workflow below has no Codex-specific dependencies - any coding agent that can read files, run
shell commands, and write a file can execute it. If you are a non-Codex agent reading this file,
follow the workflow as-is; skip the "Progressive disclosure" note, it's Codex-specific.

## Workflow

Do these steps **in order**. Do not skip Step 3 - it's the part every other stack doc omits, and
it's the reason this skill exists.

### Step 1 - Scan the codebase for the real stack

Don't ask the user to enumerate their stack from memory; detect it. Run a scan for stack signals
before asking anything. Use `references/stack-taxonomy.md` as the checklist of what to look for -
it groups signals by layer (infra, data, AI/ML, agents, evals) with the actual files/imports/env
vars that reveal each one.

Practical detection sources, roughly in this order:
- Dependency manifests: `package.json`, `requirements.txt`, `pyproject.toml`, `Pipfile`, `Cargo.toml`, `go.mod`
- Lockfiles for exact versions: `package-lock.json`, `pnpm-lock.yaml`, `poetry.lock`
- Config/infra files: `docker-compose.yml`, `Dockerfile`, `vercel.json`, `.env.example`, `wrangler.toml`, `supabase/config.toml`
- Source imports: grep for the SDK/library names in `references/stack-taxonomy.md` (e.g. `langchain`, `llama-index`, `@anthropic-ai/sdk`, `openai`, `pinecone`, `weaviate`, `chromadb`, `pgvector`, `peft`, `unsloth`, `transformers`, `@vercel/ai`, `ai` (Vercel AI SDK), `crewai`, `autogen`, `@modelcontextprotocol`)
- Smart contracts / on-chain: `*.sol`, `hardhat.config.*`, `foundry.toml`, deployed-address references in code or docs
- Schema files: `prisma/schema.prisma`, `supabase/migrations/`, `*.sql`

Build a draft inventory grouped by layer (Frontend, Backend, Data, Infra/Deploy, Auth, Blockchain
if present, AI Model Layer, RAG, Fine-tuning, Agents/Orchestration, Evals/Observability). Leave a
layer out of the draft if you find zero signal for it - don't guess or pad.

### Step 2 - Confirm the draft, fill gaps

Show the user the draft inventory in plain text (not a wall of JSON). Ask, in one pass, only
about what the scan could NOT determine - typically:
- Which model versions/checkpoints are actually pinned in production vs. dev
- Chunking strategy, retrieval top-k, and reranking approach for any RAG pipeline detected
- Fine-tuning method (LoRA / QLoRA / full fine-tune / DPO / RLHF) and base model, if a fine-tune signal was found
- Agent framework's role (single-agent tool-use vs. multi-agent orchestration) if detected
- Anything the scan flagged as ambiguous (e.g. an `ai` import that could be Vercel AI SDK or something else)

Keep this to the smallest set of questions the scan couldn't answer. If the scan was complete,
skip straight to Step 3.

### Step 3 - Prompt engineering attribution (always ask, never skip)

This is the one section that is never auto-detected, because authorship isn't in the code. Ask
directly, every time this skill runs on a project that has any AI/LLM layer at all:

> "Who did the prompt engineering on this build, and who optimized it? These can be the same
> person or different people/teams - I'll credit both."

Capture, at minimum:
- **Prompt Engineering by** - who wrote the original prompts/system instructions
- **Optimized by** - who iterated on them (evals, red-teaming, cost/latency tuning, few-shot
  curation, etc.) - if this is the same person as above, say so explicitly rather than leaving
  it blank
- Optionally: what the optimization pass actually changed (e.g. "cut token usage 40% via
  structured output", "added few-shot examples after eval failures on edge cases") - this is
  what turns a credit line into a real technical brief

Do not infer or assume an answer to this step from git blame, commit authors, or file
timestamps - ask the human. Attribution is a claim about who did intellectual work, not a
computed fact.

### Step 4 - Write stacks.md

Use `references/stacks-md-template.md` as the structure. Key rules:
- If `stacks.md` already exists in the repo root, **read it first and update it** - preserve
  sections/attribution the user isn't currently changing, add or revise the sections covered in
  this run. Never silently drop prior attribution.
- Every AI/ML layer gets a **Purpose**, **Technology**, **Configuration**, and (where relevant)
  **Why this choice** line - not just a bullet with a product name. A stack doc that just lists
  "RAG" is exactly the generic doc this skill exists to replace.
- The Prompt Engineering section always shows both attribution lines, even if they're the same
  person for both.
- Write the file to the project root as `stacks.md` unless the user specifies another path.

### Step 5 - Confirm and offer next steps

Show the user the final `stacks.md` (or a summary if long). Offer, don't push:
- Regenerating a shorter version for a README's "Tech Stack" section
- Re-running this skill later to update it as the stack changes - it's meant to be a living
  document, not a one-time artifact

## Notes on tone

Write technical, not promotional. This file is a technical brief, not marketing copy - avoid
adjectives like "cutting-edge" or "powerful." State what's used, why, and who built the
prompt-engineering layer. Precision is what makes this credible to another engineer or another
LLM reading it.
