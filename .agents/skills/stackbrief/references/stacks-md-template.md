# stacks.md Template

Fill in only the sections that apply - omit a layer entirely if the project has no signal for
it, rather than leaving a section with "N/A." Every entry needs Purpose + Technology +
Configuration at minimum; add "Why this choice" where the reasoning isn't obvious from the tech
name alone.

```markdown
# Stack Brief - <Project Name>

Last updated: <date>

## Overview

<2-4 sentences: what the product is and the shape of the architecture. Not marketing copy -
describe what's actually running.>

## Frontend

- **Framework:** <name + version>
- **Styling:** <approach>
- **State management:** <library, if any>

## Backend / API

- **Framework/runtime:** <name + version>
- **API style:** <REST / tRPC / GraphQL / route handlers>

## Data Layer

- **Database:** <name + hosting>
- **ORM:** <name>
- **Cache/queue:** <if present>

## Infra / Deploy

- **Hosting:** <provider>
- **CI/CD:** <pipeline>

## Auth

- **Provider:** <name>

## Blockchain / Web3 <omit if not applicable>

- **Chain(s):** <name>
- **Contracts:** <contract name - deployed address - purpose>
- **Client library:** <ethers/viem/wagmi/etc.>

## AI Model Layer

- **Provider(s):** <e.g. Anthropic, OpenAI>
- **Model(s):** <exact model string(s), not just "Claude">
- **Routing:** <direct SDK / OpenRouter / custom multi-provider layer>
- **Why this choice:** <optional - cost, latency, context window, capability reasoning>

## RAG Pipeline <omit if not applicable>

- **Purpose:** <what it retrieves and why>
- **Vector database:** <name + hosting>
- **Embedding model:** <name + dimensions>
- **Chunking strategy:** <chunk size / overlap>
- **Retrieval config:** <top-k, reranking if any>
- **Why this choice:** <optional>

## Fine-tuning <omit if not applicable>

- **Purpose:** <what the fine-tune is for>
- **Base model:** <name>
- **Method:** <LoRA / QLoRA / full fine-tune / DPO / RLHF>
- **Training data:** <source/size, described at a high level - no proprietary data dumped here>
- **Eval results:** <if measured - what improved and by how much>

## Agents / Orchestration <omit if not applicable>

- **Framework:** <name>
- **Architecture:** <single-agent tool-use / multi-agent / supervisor pattern, etc.>
- **Tools exposed:** <brief list>
- **Memory:** <how agent memory is handled, if distinct from RAG>

## Evals / Observability <omit if not applicable>

- **Tracing:** <tool>
- **Eval framework:** <tool>
- **Guardrails:** <structured output validation, content filtering, etc.>

## Prompt Engineering

- **Prompt Engineering by:** <name/team - who wrote the original prompts/system instructions>
- **Optimized by:** <name/team - who iterated on them; state explicitly if same as above>
- **Optimization notes:** <what changed during optimization - e.g. token reduction, few-shot
  curation, eval-driven revisions - optional but strengthens the brief>
```
