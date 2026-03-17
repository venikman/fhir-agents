# Observability

## Target Architecture

```text
Users / Clients
      |
      v
Railway: Provider Copilot app
  - Bun + Elysia HTTP / WebSocket server
  - LangGraph agents + SQLite checkpointer
  - Manual spans for HTTP, router, FHIR, explainability
  - LangChain callback spans for model + tool execution
      |
      v
Self-hosted Langfuse
  - web
  - worker
  - Postgres
  - ClickHouse
  - Redis / Valkey
  - S3-compatible blob storage
```

The app keeps its current runtime and deployment shape on Railway. Langfuse is a separate observability stack.

## Runtime Design

- `src/otel.ts` boots an OpenTelemetry `NodeSDK` only when `LANGFUSE_BASE_URL`, `LANGFUSE_PUBLIC_KEY`, and `LANGFUSE_SECRET_KEY` are set.
- `@langfuse/otel` exports spans directly to Langfuse.
- `@langfuse/langchain` attaches LangChain callback tracing so model and tool runs appear in Langfuse without OpenLIT.
- The export filter keeps Langfuse spans and all spans emitted by the `fhir-copilot` service so manual spans are preserved.

## Trace Content Policy

Default:

```bash
LANGFUSE_CAPTURE_CONTENT=false
```

With content capture disabled:

- prompt text is not attached to manual spans
- router raw classification output is not attached to manual spans
- thread/session identifiers are hashed before export
- FHIR URLs are not attached to spans
- FHIR HTTP exceptions drop response bodies
- Langfuse span export applies redaction before shipping payloads

Set `LANGFUSE_CAPTURE_CONTENT=true` only in environments where full prompt and tool payload capture is acceptable.

## Expected Trace Shape

```text
http.request | ws.message
└── copilot.query
    ├── router.classify_intent
    ├── agent / llm / tool spans (LangChain callback handler)
    │   └── fhir.http
    └── explainability.extract
```

## Rollout Notes

1. Stand up Langfuse separately from this repo.
2. Add `LANGFUSE_*` env vars to local or staging.
3. Run a sync request and a WebSocket request.
4. Verify the trace shape above in Langfuse.
5. Promote the same env pattern to production.

Rollback is an env-only change: remove `LANGFUSE_PUBLIC_KEY` or `LANGFUSE_SECRET_KEY` and restart the app to disable tracing.
