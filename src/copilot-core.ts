import "./otel.ts"
import { tracer } from "./otel.ts"
import { SpanStatusCode } from "@opentelemetry/api"
import { ChatGoogleGenerativeAI } from "@langchain/google-genai"
import { createReactAgent } from "@langchain/langgraph/prebuilt"
import { HumanMessage } from "@langchain/core/messages"
import { agentDefinitions, type AgentType } from "./agents/definitions.ts"
import { classifyIntent } from "./agents/router.ts"
import { extractResponse, type AgentResponse } from "./explainability.ts"
import { BunSqliteSaver } from "./checkpointer.ts"
import type { BaseMessage } from "@langchain/core/messages"

// ── Shared instances ────────────────────────────────────────────────

export const model = new ChatGoogleGenerativeAI({
  model: "gemini-3.1-flash-lite-preview",
  apiKey: process.env.GOOGLE_API_KEY,
})

export const checkpointer = new BunSqliteSaver("./data/checkpoints.sqlite")

// Cache agents so we don't recreate them each turn
const agentCache = new Map<AgentType, ReturnType<typeof createReactAgent>>()

export function getAgent(agentType: AgentType) {
  if (agentCache.has(agentType)) return agentCache.get(agentType)!
  const def = agentDefinitions[agentType]
  const agent = createReactAgent({
    llm: model,
    tools: def.tools,
    prompt: def.prompt,
    checkpointer,
  })
  agentCache.set(agentType, agent)
  return agent
}

// ── Run a query with streaming callbacks ────────────────────────────

export type StreamCallbacks = {
  onMeta?: (agentType: AgentType, threadId: string) => void
  onDelta?: (content: string) => void
  onTool?: (name: string, preview: string) => void
}

export async function runQuery(
  query: string,
  threadId: string,
  callbacks?: StreamCallbacks,
): Promise<AgentResponse> {
  return tracer.startActiveSpan("copilot.query", async (span) => {
    try {
      span.setAttribute("query.text", query)
      span.setAttribute("thread_id", threadId)

      // 1. Route
      const agentType = await classifyIntent(query)
      span.setAttribute("agent.type", agentType)
      callbacks?.onMeta?.(agentType, threadId)

      // 2. Stream via events (gives both content streaming and token metadata)
      const agent = getAgent(agentType)
      const collectedMessages: BaseMessage[] = []
      let inputTokens = 0
      let outputTokens = 0

      const stream = agent.streamEvents(
        { messages: [new HumanMessage(query)] },
        { configurable: { thread_id: threadId }, version: "v2", recursionLimit: 50 },
      )

      for await (const event of stream) {
        if (event.event === "on_chat_model_stream") {
          const chunk = event.data?.chunk
          if (chunk && chunk.content && !chunk.tool_calls?.length) {
            callbacks?.onDelta?.(String(chunk.content))
          }
        }

        if (event.event === "on_chat_model_end") {
          const output = event.data?.output
          if (output) {
            collectedMessages.push(output)
            const usage = output.usage_metadata
            if (usage) {
              inputTokens += usage.input_tokens ?? 0
              outputTokens += usage.output_tokens ?? 0
            }
          }
        }

        if (event.event === "on_tool_end") {
          const output = event.data?.output
          if (output) {
            collectedMessages.push(output)
            const name = output.name ?? event.name ?? "unknown"
            const preview = String(output.content).split("\n").slice(0, 4).join("\n")
            callbacks?.onTool?.(name, preview)
          }
        }
      }

      // Token usage (OpenLIT semantic conventions)
      span.setAttribute("gen_ai.usage.input_tokens", inputTokens)
      span.setAttribute("gen_ai.usage.output_tokens", outputTokens)
      span.setAttribute("gen_ai.usage.total_tokens", inputTokens + outputTokens)
      span.setAttribute("gen_ai.client.token.usage", inputTokens + outputTokens)

      // 3. Explainability
      const response = extractResponse(collectedMessages, agentType)
      span.setAttribute("response.confidence", response.confidence)
      span.setAttribute("response.citation_count", response.citations.length)
      span.setStatus({ code: SpanStatusCode.OK })
      return response
    } catch (err) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: err instanceof Error ? err.message : String(err) })
      span.recordException(err instanceof Error ? err : new Error(String(err)))
      throw err
    } finally {
      span.end()
    }
  })
}

// Re-exports for convenience
export { classifyIntent } from "./agents/router.ts"
export { extractResponse, type AgentResponse, type Citation } from "./explainability.ts"
export type { AgentType } from "./agents/definitions.ts"
