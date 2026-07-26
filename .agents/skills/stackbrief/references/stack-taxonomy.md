# Stack Taxonomy - Detection Signals by Layer

Use this as a checklist during Step 1 of SKILL.md. For each layer, look for the listed
files/imports/env vars. If you find a signal, add it to the draft inventory with the specific
detail (version, model name, provider) - not just the category name.

---

## 1. Frontend

| Signal | Look for |
|---|---|
| Framework | `next`, `react`, `vue`, `svelte`, `nuxt` in `package.json` |
| Styling | `tailwindcss`, `styled-components`, CSS module usage |
| State | `zustand`, `redux`, `@tanstack/react-query`, `jotai` |

## 2. Backend / API

| Signal | Look for |
|---|---|
| Runtime/framework | `express`, `fastify`, `hono`, `fastapi`, `django`, Next.js API/route handlers |
| API style | `trpc`, `graphql`, REST route files |

## 3. Data Layer

| Signal | Look for |
|---|---|
| Database | `supabase`, `pg`, `mysql2`, `mongodb`, connection strings in `.env.example` |
| ORM | `prisma/schema.prisma`, `drizzle`, `sqlalchemy`, `typeorm` |
| Cache/queue | `redis`, `bullmq`, `upstash` |

## 4. Infra / Deploy

| Signal | Look for |
|---|---|
| Hosting | `vercel.json`, `wrangler.toml`, `Dockerfile`, `railway.json`, `fly.toml` |
| CI/CD | `.github/workflows/*.yml`, `.gitlab-ci.yml` |
| IaC | `terraform/`, `pulumi/` |

## 5. Auth

| Signal | Look for |
|---|---|
| Provider | `next-auth`, `@supabase/auth-helpers`, `clerk`, `auth0`, `lucia` |

## 6. Blockchain / Web3 (if present)

| Signal | Look for |
|---|---|
| Contracts | `*.sol` files, `hardhat.config.*`, `foundry.toml` |
| Chain/client | `ethers`, `viem`, `wagmi`, `@solana/web3.js` |
| Deployed addresses | Referenced in code, docs, or a `deployments/` directory - capture chain + address |

## 7. AI Model Layer

This is the layer generic docs collapse into "uses Claude API." Break it out fully.

| Signal | Look for |
|---|---|
| Provider SDKs | `@anthropic-ai/sdk`, `openai`, `@google/generative-ai`, `groq-sdk`, `ollama` |
| Model routing | `openrouter`, custom multi-provider abstraction layers |
| Specific models | Model name strings in code/config (e.g. `claude-sonnet-4-6`, `gpt-4.1`, `gemini-2.5-pro`) - capture the exact string, not just "Claude" |
| Streaming | `@vercel/ai` (the `ai` package), SSE/streaming response handlers |

## 8. RAG (Retrieval-Augmented Generation)

Only include this section if there's an actual retrieval pipeline - not just "we call an LLM."

| Signal | Look for |
|---|---|
| Vector DB | `pinecone`, `weaviate`, `chromadb`, `pgvector` extension, `qdrant`, `@supabase/vecs` |
| Embedding model | `text-embedding-3`, `voyage`, `cohere` embed calls, local embedding models |
| Framework | `langchain`, `llama-index`, `llamaindex` |
| Chunking/retrieval config | Chunk size, overlap, top-k, reranking step - usually in a config file or the retrieval function itself |

## 9. Fine-tuning

Only include if there's evidence of an actual fine-tune, not just prompting.

| Signal | Look for |
|---|---|
| Method/library | `peft`, `unsloth`, `trl`, `axolotl`, LoRA/QLoRA config files |
| Base model | HuggingFace model ID or provider fine-tune job reference |
| Training data | Dataset directory, `datasets` library usage, references to a curated dataset |
| Job config | Provider fine-tuning API calls (OpenAI, Anthropic, Together, Fireworks) |

## 10. Agents / Orchestration

| Signal | Look for |
|---|---|
| Framework | `langgraph`, `crewai`, `autogen`, `@modelcontextprotocol` (MCP), custom agent loop code |
| Tool use | Tool/function-calling schemas, tool registries |
| Memory | Vector store or key-value store used specifically for agent memory (distinct from RAG over documents) |

## 11. Evals / Observability

| Signal | Look for |
|---|---|
| Tracing | `langsmith`, `helicone`, `braintrust`, `arize`, custom logging around LLM calls |
| Eval framework | `promptfoo`, `deepeval`, custom eval scripts/test suites for prompt outputs |
| Guardrails | `guardrails-ai`, `nemo-guardrails`, structured-output validation (e.g. `zod`/`pydantic` schemas wrapping LLM output) |

## 12. Prompt Engineering (attribution layer - never auto-detected)

There is no file signal for this. This layer is always filled in via the Step 3 interview in
SKILL.md, never inferred from code. Do not skip it and do not guess it from commit history.
