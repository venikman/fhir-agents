import { SpanStatusCode } from "@opentelemetry/api"
import { tracer } from "./otel.ts"
import type { BaseMessage } from "@langchain/core/messages"

// ── Types ───────────────────────────────────────────────────────────

export type Citation = {
  resourceType: string
  resourceId: string
  reference: string
}

export type AgentResponse = {
  answer: string
  citations: Citation[]
  reasoning: string[]
  toolsUsed: string[]
  agentUsed: string
  confidence: "high" | "medium" | "low"
}

// ── Citation regex ──────────────────────────────────────────────────

const FHIR_REF_PATTERN =
  /\b(Patient|Encounter|Condition|Observation|MedicationRequest|Procedure|AllergyIntolerance|Practitioner|PractitionerRole|Organization|Coverage|Group|Location|RelatedPerson)\/([a-z]+(?:-[a-z]+)*-[\d]+[a-z\d\-]*)/g

// ── Helpers ─────────────────────────────────────────────────────────

function extractCitations(messages: BaseMessage[]): Citation[] {
  const seen = new Set<string>()
  const citations: Citation[] = []

  for (const msg of messages) {
    const text = typeof msg.content === "string" ? msg.content : ""
    if (!text) continue

    for (const match of text.matchAll(FHIR_REF_PATTERN)) {
      const reference = `${match[1]}/${match[2]}`
      if (seen.has(reference)) continue
      seen.add(reference)
      citations.push({
        resourceType: match[1],
        resourceId: match[2],
        reference,
      })
    }
  }

  return citations
}

function extractReasoning(messages: BaseMessage[]): string[] {
  const steps: string[] = []

  for (const msg of messages) {
    const type = msg._getType()

    if (type === "ai") {
      const toolCalls = (msg as any).tool_calls as
        | Array<{ name: string; args: Record<string, unknown> }>
        | undefined

      if (toolCalls?.length) {
        for (const call of toolCalls) {
          const argSummary = Object.entries(call.args)
            .map(([k, v]) => `${k}=${v}`)
            .join(", ")
          steps.push(`Called ${call.name}(${argSummary})`)
        }
      }
    }

    if (type === "tool") {
      const name = (msg as any).name ?? "unknown_tool"
      const content = typeof msg.content === "string" ? msg.content : ""
      const brief = content.split("\n")[0].slice(0, 120)
      steps.push(`Result from ${name}: ${brief}`)
    }
  }

  return steps
}

function extractToolsUsed(messages: BaseMessage[]): string[] {
  const tools = new Set<string>()

  for (const msg of messages) {
    if (msg._getType() === "ai") {
      const toolCalls = (msg as any).tool_calls as
        | Array<{ name: string }>
        | undefined
      if (toolCalls?.length) {
        for (const call of toolCalls) tools.add(call.name)
      }
    }
    if (msg._getType() === "tool") {
      const name = (msg as any).name
      if (name) tools.add(name)
    }
  }

  return [...tools]
}

function hasToolErrors(messages: BaseMessage[]): boolean {
  for (const msg of messages) {
    if (msg._getType() !== "tool") continue
    const content = typeof msg.content === "string" ? msg.content : ""
    if (/error/i.test(content)) return true
  }
  return false
}

function determineConfidence(
  citations: Citation[],
  messages: BaseMessage[],
): "high" | "medium" | "low" {
  const errors = hasToolErrors(messages)
  if (errors || citations.length === 0) return "low"
  if (citations.length > 0 && !errors) return "high"
  return "medium"
}

function extractAnswer(messages: BaseMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg._getType() === "ai" && typeof msg.content === "string" && msg.content) {
      return msg.content
    }
  }
  return ""
}

// ── Main ────────────────────────────────────────────────────────────

export function extractResponse(
  messages: BaseMessage[],
  agentUsed: string,
): AgentResponse {
  return tracer.startActiveSpan("explainability.extract", (span) => {
    try {
      const answer = extractAnswer(messages)
      const citations = extractCitations(messages)
      const reasoning = extractReasoning(messages)
      const toolsUsed = extractToolsUsed(messages)
      const confidence = determineConfidence(citations, messages)

      span.setAttribute("response.confidence", confidence)
      span.setAttribute("response.citation_count", citations.length)
      span.setAttribute("response.answer_length", answer.length)
      span.setStatus({ code: SpanStatusCode.OK })

      return { answer, citations, reasoning, toolsUsed, agentUsed, confidence }
    } catch (err) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: err instanceof Error ? err.message : String(err) })
      span.recordException(err instanceof Error ? err : new Error(String(err)))
      throw err
    } finally {
      span.end()
    }
  })
}
