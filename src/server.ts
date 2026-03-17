import "./otel.ts"
import { getTelemetryException, getTraceIdentifier, tracer } from "./otel.ts"
import { SpanStatusCode } from "@opentelemetry/api"
import { Elysia, t } from "elysia"
import { cors } from "@elysiajs/cors"
import { runQuery, type AgentResponse } from "./copilot-core.ts"

const PORT = Number(process.env.PORT) || 3000

const app = new Elysia()
  .use(cors())

  // ── Health check ────────────────────────────────────────────────────
  .get("/health", () => ({ status: "ok" }))

  // ── Sync endpoint ───────────────────────────────────────────────────
  .post(
    "/api/copilot",
    async ({ body }) => {
      return tracer.startActiveSpan("http.request", async (span) => {
        const threadId = body.threadId ?? `http-${Date.now()}`
        span.setAttribute("http.method", "POST")
        span.setAttribute("http.route", "/api/copilot")
        span.setAttribute("thread_id", getTraceIdentifier(threadId))

        try {
          const response = await runQuery(body.query, threadId)
          span.setStatus({ code: SpanStatusCode.OK })
          return response
        } catch (err) {
          const traceError = getTelemetryException(err)
          span.setStatus({ code: SpanStatusCode.ERROR, message: traceError.message })
          span.recordException(traceError)
          throw err
        } finally {
          span.end()
        }
      })
    },
    {
      body: t.Object({
        query: t.String(),
        threadId: t.Optional(t.String()),
      }),
    },
  )

  // ── WebSocket streaming ─────────────────────────────────────────────
  .ws("/api/copilot/ws", {
    body: t.Object({
      type: t.Literal("query"),
      query: t.String(),
      threadId: t.Optional(t.String()),
    }),

    async message(ws, data) {
      const threadId = data.threadId ?? `ws-${Date.now()}`

      await tracer.startActiveSpan("ws.message", async (span) => {
        span.setAttribute("http.method", "WS")
        span.setAttribute("http.route", "/api/copilot/ws")
        span.setAttribute("thread_id", getTraceIdentifier(threadId))

        try {
          const response = await runQuery(data.query, threadId, {
            onMeta(agentType, tid) {
              ws.send({ type: "meta" as const, agentType, threadId: tid })
            },
            onDelta(content) {
              ws.send({ type: "delta" as const, content })
            },
            onTool(name, preview) {
              ws.send({ type: "tool" as const, name, preview })
            },
          })

          ws.send({ type: "done" as const, response })
          span.setStatus({ code: SpanStatusCode.OK })
        } catch (err) {
          ws.send({
            type: "error" as const,
            message: err instanceof Error ? err.message : String(err),
          })
          const traceError = getTelemetryException(err)
          span.setStatus({ code: SpanStatusCode.ERROR, message: traceError.message })
          span.recordException(traceError)
        } finally {
          span.end()
        }
      })
    },
  })

  .listen(PORT)

console.log(`Provider Copilot server running on http://localhost:${PORT}`)
console.log(`  POST /api/copilot       — sync query`)
console.log(`  WS   /api/copilot/ws    — streaming`)
console.log(`  GET  /health            — health check`)

export { app }
