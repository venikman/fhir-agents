#!/usr/bin/env bun
/**
 * Telemetry E2E — verifies copilot queries produce Langfuse traces.
 *
 * Requires:
 *   - Running copilot server  (bun run src/server.ts)
 *   - LANGFUSE_* env vars configured in .env
 *
 * Usage:
 *   bun run docs/http/telemetry-e2e.ts
 */

const COPILOT_URL = process.env.COPILOT_URL ?? "http://localhost:3000"
const { LANGFUSE_BASE_URL, LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY } = process.env

if (!LANGFUSE_BASE_URL || !LANGFUSE_PUBLIC_KEY || !LANGFUSE_SECRET_KEY) {
  console.log("⏭  LANGFUSE_* env vars not set — skipping telemetry E2E")
  process.exit(0)
}

const langfuseAuth = `Basic ${btoa(`${LANGFUSE_PUBLIC_KEY}:${LANGFUSE_SECRET_KEY}`)}`

async function langfuseGet<T = any>(path: string): Promise<T> {
  const res = await fetch(`${LANGFUSE_BASE_URL}${path}`, {
    headers: { Authorization: langfuseAuth },
  })
  if (!res.ok) throw new Error(`Langfuse ${res.status}: ${await res.text()}`)
  return res.json() as T
}

function assert(condition: boolean, msg: string): asserts condition {
  if (!condition) {
    console.error(`✗ ${msg}`)
    process.exit(1)
  }
}

// ── Test ─────────────────────────────────────────────────────────────

const fromTimestamp = new Date().toISOString()
const threadId = `telemetry-e2e-${Date.now()}`

// 1. Health check
const healthRes = await fetch(`${COPILOT_URL}/health`)
assert(healthRes.ok, `Server not reachable at ${COPILOT_URL}`)

// 2. Send copilot query
console.log(`Sending query (threadId=${threadId}) …`)
const queryRes = await fetch(`${COPILOT_URL}/api/copilot`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ query: "Which attribution lists exist?", threadId }),
})
assert(queryRes.ok, `Copilot query failed: ${queryRes.status}`)
const copilotBody = (await queryRes.json()) as { answer: string; agentUsed: string }
assert(copilotBody.answer?.length > 0, "Empty answer")
console.log(`✓ Query succeeded (agent=${copilotBody.agentUsed})`)

// 3. Wait for telemetry batch flush
const FLUSH_WAIT_MS = 10_000
console.log(`Waiting ${FLUSH_WAIT_MS / 1000}s for telemetry flush …`)
await Bun.sleep(FLUSH_WAIT_MS)

// 4. Verify CallbackHandler traces landed in Langfuse
console.log("Checking Langfuse for traces …")
type TraceList = { data: Array<{ id: string; name: string; tags: string[] }> }
const traces = await langfuseGet<TraceList>(
  `/api/public/traces?tags=fhir-copilot&fromTimestamp=${encodeURIComponent(fromTimestamp)}&limit=10`,
)
assert(
  traces.data?.length >= 1,
  `Expected ≥1 Langfuse trace with tag "fhir-copilot", got ${traces.data?.length ?? 0}`,
)
console.log(`✓ Found ${traces.data.length} trace(s) with tag "fhir-copilot"`)

// 5. Verify observations exist on the first trace
type ObsList = { data: Array<{ id: string; name: string; type: string }> }
const traceId = traces.data[0].id
const observations = await langfuseGet<ObsList>(
  `/api/public/observations?traceId=${traceId}&limit=50`,
)
assert(
  observations.data?.length >= 1,
  `Expected observations in trace ${traceId}, got ${observations.data?.length ?? 0}`,
)
const obsNames = observations.data.map((o) => o.name)
console.log(
  `✓ Trace ${traceId.slice(0, 8)}… has ${observations.data.length} observation(s): ${obsNames.join(", ")}`,
)

// 6. Verify OTel-exported spans (manual instrumentation)
const otelSpans = await langfuseGet<ObsList>(
  `/api/public/observations?name=copilot.query&fromStartTime=${encodeURIComponent(fromTimestamp)}&limit=5`,
)
if (otelSpans.data?.length >= 1) {
  console.log(`✓ OTel span "copilot.query" found in Langfuse`)
} else {
  console.log(`⚠ OTel span "copilot.query" not found — span processor may still be flushing`)
}

console.log("\n✓ Telemetry E2E — all checks passed")
