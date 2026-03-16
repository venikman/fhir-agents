# Decision Log

Architectural decisions and their reasoning. Updated as the project evolves.

| Date | Decision | Chose | Over | Why |
|------|----------|-------|------|-----|
| 2026-03-14 | Console tracing | LangChain `ConsoleCallbackHandler` | Custom `AgentTracer` | Don't reimplement what LangChain provides; built-in has colored output with timing |
| 2026-03-14 | OTel integration | OpenLIT SDK auto-instrumentation | Custom OTelHandler callback | OpenLIT patches LangChain + Google AI at module level; no manual callback wiring needed |
| 2026-03-14 | LLM provider | Gemini 3.1-flash-lite via Generative Language API | Vertex AI / OpenAI | GCloud credits available; lite keeps costs low |
| 2026-03-14 | Runtime | Bun | Node.js / Deno | Faster startup, built-in TypeScript, built-in test runner |
| 2026-03-14 | Testing | E2E only, Bun test runner | Unit tests / Jest / Vitest | Focus on testing running systems; learning repo |
| 2026-03-16 | Agent architecture | 6 specialized agents + router | Single monolithic agent | Each agent has a focused prompt and minimal tool set — reduces hallucination, improves reliability for complex queries |
| 2026-03-16 | Router implementation | LLM-based intent classifier | Rule-based regex / keyword matching | LLM handles ambiguous queries better; the classification prompt disambiguates edge cases (search vs cohort) |
| 2026-03-16 | Router fallback | Default to `clinical` agent | Error / ask user to rephrase | Clinical agent has ALL tools — safest fallback when intent is unclear |
| 2026-03-16 | Tool design | One tool per FHIR resource type | Single generic search tool | Each tool has its own Zod schema with resource-specific params; LLM makes fewer parameter errors with focused schemas |
| 2026-03-16 | Tool output format | Rich pipe-delimited summaries | Raw JSON / generic `summarizeBundle` | Each tool formats output with the fields that matter for its resource type (e.g. ICD-10 codes for conditions, LOINC+values for observations). LLM reasons better over structured text than raw JSON. |
| 2026-03-16 | Memory | `BunSqliteSaver` checkpointer | `MemorySaver` / Postgres | Persistent across restarts, `bun:sqlite` built-in, zero deps, WAL mode for crash safety |
| 2026-03-16 | Explainability | Post-processing message extraction | LLM-based structured output chain | Pure data extraction (regex + message parsing) is faster, deterministic, and free — no extra LLM call needed |
| 2026-03-16 | Confidence scoring | Heuristic (citations + error presence) | LLM self-assessment | Deterministic and instant; LLM self-assessment adds latency and is unreliable |
| 2026-03-16 | Recursion limit | 50 steps | Default 25 | Complex cohort queries (e.g. checking medications for each of 15 hypertensive patients) need more than 25 tool calls |
| 2026-03-16 | FHIR API target | Remote Cloudflare Workers URL | Local-only (localhost:3001) | Remote is always available; no local server setup required for development or testing |
| 2026-03-16 | Agent-agnostic docs | `AGENTS.md` (generic) | `CLAUDE.md` (Claude-specific) | Project instructions should work with any AI coding agent, not just Claude Code |
| 2026-03-16 | HTTP server | Elysia | Bun.serve / Hono / Express | SSE generator pattern maps 1:1 to agent stream loop; Zod v4 works via Standard Schema; `.ws()` with typed schemas for WebSocket; CORS plugin; only 4 tiny runtime deps |
| 2026-03-16 | Persistent memory | Custom `BunSqliteSaver` using `bun:sqlite` | `@langchain/langgraph-checkpoint-sqlite` / Postgres | `better-sqlite3` crashes under Bun (N-API mismatch); `bun:sqlite` is built-in, zero extra deps, 3-6x faster |
| 2026-03-16 | Streaming protocol | WebSocket | SSE / NDJSON | Bidirectional enables future features: mid-stream cancellation, typing indicators, multi-agent handoff; persistent connection for multi-turn |
| 2026-03-16 | Observability SDK | OpenLIT | Phoenix (Arize) | Auto-instruments LangChain (no manual callback handler), traces + metrics (not just traces), standard OTLP output |
| 2026-03-16 | Local observability | OpenLIT UI + ClickHouse | Jaeger | AI-specific dashboards (token usage, cost, latency), not just raw trace viewer |
| 2026-03-16 | Deployment observability | Grafana Cloud | Self-hosted Grafana | 5 pre-built AI dashboards, OTel-native, 50 GB/month free tier, same OTLP protocol — switch by changing env var |
| 2026-03-16 | Deployment platform | Railway | Fly.io / Cloudflare Workers | Native Bun support, Elysia templates, `bun:sqlite` works on persistent volume, simpler deploy, more reliable |
