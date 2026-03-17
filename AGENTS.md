# AGENTS.md

Project instructions for AI coding agents working in this repository.

## Purpose

Provider Copilot — a headless, multi-agent system for healthcare organizations managing attributed patient populations under value-based care contracts (DaVinci ATR / FHIR R4). Built with LangChain.js + LangGraph.

## Runtime & Tooling Constraints

- **Runtime: Bun only.** No Node.js, no Deno. Use `bun` for all execution, package management, and scripting.
- **Language: TypeScript only.** Prefer type inference over explicit annotations. No Python.
- **No linters/formatters.** Do not add ESLint, Prettier, Biome, or similar.
- **No bundlers.** Do not add Vite, Webpack, esbuild, or similar.
- **No test frameworks beyond Bun's built-in.** Do not add Jest, Vitest, or Mocha.
- **Adding any new tooling requires explicit agreement.**
- **Only install packages you are about to import and use.**

## LLM Provider

**Google Gemini via Generative Language API only.** GCloud project: `audio-sharp-interop`.

- **Primary model:** `gemini-3-flash-preview`
- **Fallback model:** `gemini-3.1-flash-lite-preview`
- **Forbidden:** No 2.x models and no pro-tier models. Only Gemini 3-series non-pro models (`gemini-3-flash-preview`, `gemini-3.1-flash-lite-preview`).
- **No other providers.** Do not use OpenAI, Anthropic API, or other LLM providers in code.
- Use `@langchain/google-genai` package (not `@langchain/google-vertexai`)
- Auth via API key: `GOOGLE_API_KEY` in `.env`

## Common Commands

```bash
bun install                              # Install dependencies
bun run src/server.ts                    # Start the copilot server
bunx httpyac docs/http/copilot.http --all  # Run copilot API tests (requires server)
bunx httpyac docs/http/router.http --all   # Run router classification tests
bun run docs/http/telemetry-e2e.ts         # Verify traces land in Langfuse (requires server + LANGFUSE_* env)
```

## Testing Strategy

- E2E tests only — no unit tests
- Tests use `.http` files with httpYac assertions in `docs/http/`
- Telemetry E2E (`telemetry-e2e.ts`) verifies traces reach Langfuse via its public API
- Tests hit the live FHIR API at `https://bulk-atr.nedbailov375426.workers.dev`

## Monitoring & Observability

Every agent run produces OTel traces.
- **SDK:** Langfuse OpenTelemetry span processor + LangChain callback handler; manual spans for router, FHIR HTTP, explainability
- **Local/Staging/Prod:** point `LANGFUSE_*` env vars at the target Langfuse instance
- **Default policy:** `LANGFUSE_CAPTURE_CONTENT=false` to avoid exporting prompt/tool payloads by default
- Tracks: latency per step, token usage, tool call success/failure
- See `LOCAL_SETUP.md` and `docs/OBSERVABILITY.md`

## Architecture Overview

```
src/
├── server.ts              # Elysia HTTP + WebSocket server
├── copilot-core.ts        # Entry point: Router → Agent → Explainability
├── otel.ts                # Langfuse tracing bootstrap + tracer export
├── checkpointer.ts        # BunSqliteSaver for multi-turn memory
├── agents/
│   ├── definitions.ts     # 6 specialized agents (tools + prompts)
│   └── router.ts          # Intent classifier → AgentType
├── explainability.ts      # Post-processing: citations, reasoning, confidence
└── tools/
    ├── fhir.ts            # Core FHIR tools (search groups, read, list, bulk export)
    ├── fhir-patient-search.ts
    ├── fhir-encounter.ts
    ├── fhir-condition.ts
    ├── fhir-observation.ts
    ├── fhir-medication.ts
    ├── fhir-procedure.ts
    ├── fhir-allergy.ts
    └── calculator.ts
```

## Decision Log

Record architectural decisions in `DECISIONS.md`.
