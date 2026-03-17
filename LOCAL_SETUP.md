# Local Setup

## Prerequisites

- [Bun](https://bun.sh) runtime installed
- [Docker](https://www.docker.com/) for local Langfuse (optional, for tracing)

## Quick Start

```bash
# 1. Install dependencies
bun install

# 2. Configure environment
cp .env.example .env
# Edit .env and set GOOGLE_API_KEY

# 3. Start local Langfuse (optional — tracing disabled without it)
docker compose up -d
# UI at http://localhost:3001 (dev@example.com / password)
# API keys pk-lf-local / sk-lf-local are auto-seeded (match .env.example)

# 4. Start the server
bun run src/server.ts
```

## Environment Variables

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `GOOGLE_API_KEY` | Yes | — | Gemini API authentication |
| `GOOGLE_CLOUD_PROJECT` | No | `audio-sharp-interop` | GCP project for quota |
| `FHIR_BASE_URL` | No | `https://bulk-atr.nedbailov375426.workers.dev` | FHIR R4 server base URL |
| `LANGFUSE_BASE_URL` | No | — | Langfuse base URL, e.g. `https://langfuse.example.com` |
| `LANGFUSE_PUBLIC_KEY` | No | — | Langfuse public API key |
| `LANGFUSE_SECRET_KEY` | No | — | Langfuse secret API key |
| `LANGFUSE_TRACING_ENVIRONMENT` | No | `NODE_ENV` or `development` | Trace environment label |
| `LANGFUSE_RELEASE` | No | — | Release/version tag for traces |
| `LANGFUSE_CAPTURE_CONTENT` | No | `false` | Opt-in prompt/output capture. Keep `false` for PHI-safe defaults |

Tracing is disabled automatically when `LANGFUSE_BASE_URL`, `LANGFUSE_PUBLIC_KEY`, or `LANGFUSE_SECRET_KEY` is missing.

## Running the Server

```bash
bun run src/server.ts
# Provider Copilot server running on http://localhost:3000
#   POST /api/copilot       — sync query
#   WS   /api/copilot/ws    — streaming
#   GET  /health            — health check
```

### Quick test

```bash
curl http://localhost:3000/health
curl -X POST http://localhost:3000/api/copilot \
  -H "Content-Type: application/json" \
  -d '{"query": "Which attribution lists exist?"}'
```

See [docs/COPILOT.md](docs/COPILOT.md) for WebSocket protocol and client examples.

## Langfuse Observability

This repo emits traces to Langfuse through the Langfuse OpenTelemetry span processor and LangChain callback handler.

- Manual spans cover router, FHIR HTTP, and explainability.
- LangChain spans cover model calls and tool execution.
- Trace content is redacted by default, and thread/session identifiers are hashed before export. Set `LANGFUSE_CAPTURE_CONTENT=true` only in safe environments.

### Local Langfuse (via Docker Compose)

```bash
docker compose up -d            # Start Langfuse v3 stack (Postgres, ClickHouse, Redis, MinIO)
# UI: http://localhost:3001     (dev@example.com / password)
# API keys pk-lf-local / sk-lf-local are auto-seeded via LANGFUSE_INIT_* env vars
```

The `.env.example` defaults already point at local Langfuse — just `cp .env.example .env` and set `GOOGLE_API_KEY`.

### Remote / Cloud Langfuse

Replace `LANGFUSE_*` vars in `.env` with your instance URL and keys.

After running a query, open your Langfuse project and verify you see:

- `http.request` or `ws.message`
- `copilot.query`
- `router.classify_intent`
- LangChain model/tool spans
- `fhir.http`
- `explainability.extract`

See [docs/OBSERVABILITY.md](docs/OBSERVABILITY.md) for the deployment topology and rollout notes.

## Running Tests

API contract tests use `.http` files with [httpYac](https://httpyac.github.io/) assertions.

```bash
bunx httpyac docs/http/copilot.http --all    # Copilot API contract tests
bunx httpyac docs/http/router.http --all     # Router classification tests
bun run docs/http/telemetry-e2e.ts           # Verify traces land in Langfuse
```
