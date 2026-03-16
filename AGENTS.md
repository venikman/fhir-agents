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

- **Primary model:** `gemini-3.1-flash-lite-preview`
- **Forbidden:** No 2.x models, no 3.0 models, no pro-tier models. Only Gemini 3.1 non-pro models.
- **No other providers.** Do not use OpenAI, Anthropic API, or other LLM providers in code.
- Use `@langchain/google-genai` package (not `@langchain/google-vertexai`)
- Auth via API key: `GOOGLE_API_KEY` in `.env`

## Common Commands

```bash
bun install                              # Install dependencies
bun run src/server.ts                    # Start the copilot server
docker compose up -d                     # Start OpenLIT observability stack
bunx httpyac docs/http/copilot.http --all  # Run copilot API tests (requires server)
bunx httpyac docs/http/router.http --all   # Run router classification tests
```

## Testing Strategy

- E2E tests only — no unit tests
- Tests use `.http` files with httpYac assertions in `docs/http/`
- Tests hit the live FHIR API at `https://bulk-atr.nedbailov375426.workers.dev`

## Monitoring & Observability

Every agent run produces OTel traces.
- **SDK:** OpenLIT auto-instruments LangChain; manual spans for router, FHIR HTTP, explainability
- **Local:** OpenLIT UI at `http://localhost:3001` (via `docker compose up -d`)
- **Deploy:** Grafana Cloud (same OTLP protocol, switch via env vars)
- Tracks: latency per step, token usage, tool call success/failure
- See `LOCAL_SETUP.md` for Docker commands

## Architecture Overview

```
src/
├── server.ts              # Elysia HTTP + WebSocket server
├── copilot-core.ts        # Entry point: Router → Agent → Explainability
├── otel.ts                # OpenLIT initialization + tracer export
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
