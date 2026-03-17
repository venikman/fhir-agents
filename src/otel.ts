import { trace } from "@opentelemetry/api"
import { createHash } from "node:crypto"
import { resourceFromAttributes } from "@opentelemetry/resources"
import { NodeSDK } from "@opentelemetry/sdk-node"
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions"
import { CallbackHandler } from "@langfuse/langchain"
import { LangfuseSpanProcessor, isDefaultExportSpan } from "@langfuse/otel"
import type { Callbacks } from "@langchain/core/callbacks/manager"

const applicationName = "fhir-copilot"
const runtimeEnvironment = process.env.NODE_ENV ?? "development"
const langfuseEnvironment = process.env.LANGFUSE_TRACING_ENVIRONMENT ?? runtimeEnvironment
const langfuseRelease = process.env.LANGFUSE_RELEASE

export const traceContentEnabled = process.env.LANGFUSE_CAPTURE_CONTENT === "true"

/** Set a span attribute only when content capture is enabled. */
export function setContentAttribute(span: import("@opentelemetry/api").Span, key: string, value: string): void {
  if (traceContentEnabled) span.setAttribute(key, value)
}

export const langfuseEnabled = Boolean(
  process.env.LANGFUSE_BASE_URL &&
    process.env.LANGFUSE_PUBLIC_KEY &&
    process.env.LANGFUSE_SECRET_KEY,
)

const safeKeyPattern =
  /(^|[._-])(agent|answer_length|citation_count|code|confidence|count|duration|environment|fallback_used|host|input_tokens|latency|level|method|model|output_tokens|resource_type|route|scheme|selected_agent|status|token|total_tokens|type|usage|version|workflow)($|[._-])/i

function redactValue(data: unknown, key?: string): unknown {
  if (data == null) return data

  if (typeof data === "string") {
    if (key && safeKeyPattern.test(key)) return data
    return "[redacted]"
  }

  if (Array.isArray(data)) return data.map((item) => redactValue(item, key))

  if (typeof data === "object") {
    return Object.fromEntries(
      Object.entries(data).map(([nestedKey, value]) => [
        nestedKey,
        redactValue(value, nestedKey),
      ]),
    )
  }

  return data
}

const hashCache = new Map<string, string>()

function hashIdentifier(value: string): string {
  let cached = hashCache.get(value)
  if (cached) return cached
  cached = `sha256:${createHash("sha256").update(value).digest("hex").slice(0, 16)}`
  hashCache.set(value, cached)
  return cached
}

export function getTraceIdentifier(value: string): string {
  if (!traceContentEnabled && value.startsWith("sha256:")) return value
  return traceContentEnabled ? value : hashIdentifier(value)
}

let telemetrySdk: NodeSDK | undefined

if (langfuseEnabled) {
  telemetrySdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: applicationName,
    }),
    spanProcessors: [
      new LangfuseSpanProcessor({
        publicKey: process.env.LANGFUSE_PUBLIC_KEY,
        secretKey: process.env.LANGFUSE_SECRET_KEY,
        baseUrl: process.env.LANGFUSE_BASE_URL,
        environment: langfuseEnvironment,
        release: langfuseRelease,
        mask: ({ data }) => (traceContentEnabled ? data : redactValue(data)),
        shouldExportSpan: ({ otelSpan }) =>
          isDefaultExportSpan(otelSpan) ||
          String(otelSpan.resource.attributes[ATTR_SERVICE_NAME] ?? "") === applicationName,
      }),
    ],
  })

  telemetrySdk.start()

  const shutdownTelemetry = async () => {
    if (!telemetrySdk) return
    const sdk = telemetrySdk
    telemetrySdk = undefined
    await sdk.shutdown()
  }

  process.once("SIGINT", () => {
    void shutdownTelemetry().finally(() => process.exit(0))
  })

  process.once("SIGTERM", () => {
    void shutdownTelemetry().finally(() => process.exit(0))
  })
}

type LangfuseCallbackOptions = {
  sessionId?: string
  userId?: string
  tags?: string[]
  traceMetadata?: Record<string, unknown>
}

function sanitizeTraceIdentifiers(data: unknown): unknown {
  if (data == null) return data

  if (Array.isArray(data)) {
    return data.map((item) => sanitizeTraceIdentifiers(item))
  }

  if (typeof data === "object") {
    return Object.fromEntries(
      Object.entries(data).map(([key, value]) => {
        if ((key === "thread_id" || key === "threadId") && typeof value === "string") {
          return [key, getTraceIdentifier(value)]
        }
        return [key, sanitizeTraceIdentifiers(value)]
      }),
    )
  }

  return data
}

function wrapMetadataSanitizers(handler: CallbackHandler): CallbackHandler {
  const wrap = (methodName: keyof CallbackHandler, transform: (args: unknown[]) => unknown[]) => {
    const original = handler[methodName]
    if (typeof original !== "function") return
    ;(handler[methodName] as unknown) = ((...args: unknown[]) =>
      (original as (...args: unknown[]) => unknown).apply(handler, transform(args))) as unknown
  }

  wrap("handleChainStart", (args) => {
    const next = [...args]
    next[1] = sanitizeTraceIdentifiers(args[1])
    next[5] = sanitizeTraceIdentifiers(args[5])
    return next
  })

  for (const m of ["handleGenerationStart", "handleChatModelStart", "handleLLMStart"] as const) {
    wrap(m, (args) => {
      const next = [...args]
      next[4] = sanitizeTraceIdentifiers(args[4])
      next[6] = sanitizeTraceIdentifiers(args[6])
      return next
    })
  }

  for (const m of ["handleToolStart", "handleRetrieverStart"] as const) {
    wrap(m, (args) => {
      const next = [...args]
      next[5] = sanitizeTraceIdentifiers(args[5])
      return next
    })
  }

  return handler
}

export function getTelemetryException(error: unknown): Error {
  const normalized = error instanceof Error ? error : new Error(String(error))
  if (traceContentEnabled) return normalized

  const fhirMatch = normalized.message.match(/^FHIR\s+\d{3}/)
  if (fhirMatch) {
    const redacted = new Error(fhirMatch[0])
    redacted.name = normalized.name
    return redacted
  }

  return normalized
}

export function createLangfuseCallbacks(
  options: LangfuseCallbackOptions = {},
): Callbacks | undefined {
  if (!langfuseEnabled) return undefined

  const traceMetadata = options.traceMetadata
    ? {
        ...options.traceMetadata,
        ...(typeof options.traceMetadata.threadId === "string"
          ? { threadId: getTraceIdentifier(options.traceMetadata.threadId) }
          : {}),
      }
    : undefined

  const handler = wrapMetadataSanitizers(new CallbackHandler({
      sessionId:
        typeof options.sessionId === "string"
          ? getTraceIdentifier(options.sessionId)
          : undefined,
      userId: options.userId,
      tags: Array.from(new Set([applicationName, ...(options.tags ?? [])])),
      version: langfuseRelease,
      traceMetadata,
    }))

  return [handler]
}

export const tracer = trace.getTracer(applicationName)
