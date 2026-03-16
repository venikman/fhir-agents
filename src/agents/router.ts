import { ChatGoogleGenerativeAI } from "@langchain/google-genai"
import { SystemMessage, HumanMessage } from "@langchain/core/messages"
import { SpanStatusCode } from "@opentelemetry/api"
import { tracer } from "../otel.ts"
import type { AgentType } from "./definitions.ts"

const VALID_TYPES: AgentType[] = ["lookup", "search", "analytics", "clinical", "cohort", "export"]

const CLASSIFICATION_PROMPT = `Classify the user's healthcare query into exactly one agent type:

- "lookup" → Simple reads: "show me", "read", "what is X", single resource lookups, reference resolution, "who manages", "what insurance"
- "search" → Finding resources by single-type criteria: "find patients by gender/age", "search encounters", name lookups, "encounters for patient X", filtering one resource type by its parameters
- "analytics" → Counting, comparing, trends: "how many", "compare", "breakdown", "trend", "per organization", "top N providers", "volume"
- "clinical" → Patient summaries, narratives: "clinical summary", "tell me about encounter X in plain English", "what happened", "full summary"
- "cohort" → Cross-resource population queries, gaps, set operations: "patients with X AND Y" (combining different resource types), "patients without", "who needs", "gap", "flag for review", "at risk", "who hasn't had"
- "export" → Bulk data: "export", "bulk", "download all", "full data snapshot"

Key distinction: "search" filters a SINGLE resource type (e.g. find patients by age). "cohort" COMBINES criteria across MULTIPLE resource types (e.g. patients with condition X who lack medication Y).

Respond with ONLY the agent type, nothing else.`

export async function classifyIntent(query: string): Promise<AgentType> {
  return tracer.startActiveSpan("router.classify_intent", async (span) => {
    try {
      span.setAttribute("query.text", query)

      const model = new ChatGoogleGenerativeAI({
        model: "gemini-3.1-flash-lite-preview",
        apiKey: process.env.GOOGLE_API_KEY,
      })

      const response = await model.invoke([
        new SystemMessage(CLASSIFICATION_PROMPT),
        new HumanMessage(query),
      ])

      const raw = String(response.content).trim().toLowerCase()
      span.setAttribute("router.raw_response", raw)

      // Extract a valid agent type from the response
      for (const t of VALID_TYPES) {
        if (raw === t || raw === `"${t}"`) {
          span.setAttribute("router.selected_agent", t)
          span.setAttribute("router.fallback_used", false)
          span.setStatus({ code: SpanStatusCode.OK })
          return t
        }
      }

      // Fallback: check if the response contains a valid type anywhere
      for (const t of VALID_TYPES) {
        if (raw.includes(t)) {
          span.setAttribute("router.selected_agent", t)
          span.setAttribute("router.fallback_used", false)
          span.setStatus({ code: SpanStatusCode.OK })
          return t
        }
      }

      // Default to clinical (most capable agent)
      span.setAttribute("router.selected_agent", "clinical")
      span.setAttribute("router.fallback_used", true)
      span.setStatus({ code: SpanStatusCode.OK })
      return "clinical"
    } catch (err) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: err instanceof Error ? err.message : String(err) })
      span.recordException(err instanceof Error ? err : new Error(String(err)))
      throw err
    } finally {
      span.end()
    }
  })
}
