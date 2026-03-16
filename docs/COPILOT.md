# Provider Copilot — Agent Architecture

## Overview

The Provider Copilot is a headless AI system that answers healthcare questions by orchestrating FHIR API calls. It translates natural language into multi-step API workflows, joins data across resource types, and produces clinical insights that FHIR APIs can't express natively.

```
User Query
    │
    ▼
┌─────────┐     ┌─────────────┐     ┌──────────────────┐
│  Router  │────▶│  Specialist │────▶│  Explainability  │
│ (intent  │     │   Agent     │     │  (citations,     │
│  classify)│    │  (tools +   │     │   reasoning,     │
└─────────┘     │   prompt)   │     │   confidence)    │
                └─────────────┘     └──────────────────┘
                       │                      │
                       ▼                      ▼
                 ┌──────────┐          AgentResponse
                 │ FHIR API │          {answer, citations,
                 │ (tools)  │           reasoning, toolsUsed,
                 └──────────┘           agentUsed, confidence}
```

## Agents

| Agent | When Used | Tools | Strength |
|-------|-----------|-------|----------|
| **Lookup** | "show me X", "what insurance", reference resolution | 3 (groups, read, list) | Single-resource reads, reference chasing |
| **Search** | "find patients by...", "encounters for..." | 8 (7 search + read) | Parameterized FHIR queries, code system mapping |
| **Analytics** | "how many", "compare", "top N", "trend" | 10 (search + list + calculator) | Counting, aggregation, ranking, comparisons |
| **Clinical** | "clinical summary", "tell me about encounter X" | 12 (everything) | Multi-resource orchestration, narrative synthesis |
| **Cohort** | "patients with X and Y", "without", "gap", "at risk" | 10 (search + list + calculator) | Set operations, gap analysis, anomaly detection |
| **Export** | "export all data", "bulk download" | 3 (groups, read, bulk export) | Async export lifecycle management |

### Router

The Router is an LLM call that classifies user intent into one of the 6 agent types. It uses a classification prompt with clear distinctions:
- **search** = filtering a single resource type
- **cohort** = combining criteria across multiple resource types
- **analytics** = computing derived values (counts, trends, rankings)
- **clinical** = producing narratives or summaries

Fallback: if classification fails, routes to `clinical` (has all tools).

## Tools (12 total)

### Core FHIR Tools
| Tool | Purpose |
|------|---------|
| `fhir_search_groups` | Find attribution groups by name/identifier |
| `fhir_read_resource` | Read any single FHIR resource by type + ID |
| `fhir_list_resources` | List all resources of a given type |
| `fhir_bulk_export` | Full async bulk data export with polling |

### Clinical Search Tools
| Tool | Search Parameters |
|------|-------------------|
| `fhir_search_patients` | name, gender, birthdate range, general-practitioner |
| `fhir_search_encounters` | patient, date range, status, type (CPT), practitioner, location, reason-code (ICD-10) |
| `fhir_search_conditions` | patient, code (ICD-10), clinical-status, category |
| `fhir_search_observations` | code (LOINC), patient, category (vital-signs/laboratory), date range |
| `fhir_search_medications` | patient, status, code (RxNorm) |
| `fhir_search_procedures` | patient, code (CPT) |
| `fhir_search_allergies` | patient |
| `calculator` | Mathematical expressions |

## Explainability

Every response includes an `AgentResponse` with:

| Field | Type | Description |
|-------|------|-------------|
| `answer` | string | The final response text |
| `citations` | Citation[] | FHIR resource IDs referenced (e.g. `Patient/patient-0001`) |
| `reasoning` | string[] | Step-by-step tool call trace |
| `toolsUsed` | string[] | Deduplicated tool names invoked |
| `agentUsed` | string | Which specialized agent handled the query |
| `confidence` | high/medium/low | Based on citation presence and error absence |

## Multi-Turn Memory

The copilot uses a custom `BunSqliteSaver` checkpointer backed by `bun:sqlite` for persistent conversational context:
- Each session gets a unique `thread_id`
- Follow-up questions ("what about their medications?") reference prior context
- Memory persists across server restarts (SQLite WAL mode at `./data/checkpoints.sqlite`)
- Thread state survives process crashes — restart and continue where you left off

## Programmatic Integration

Import `runQuery` from `copilot-core.ts`:

```typescript
import { runQuery } from "./copilot-core.ts"

const response = await runQuery("Full clinical summary for patient-0001", "my-session")
// → { answer, citations, reasoning, toolsUsed, agentUsed, confidence }
```

With streaming callbacks:

```typescript
const response = await runQuery("Full clinical summary for patient-0001", "my-session", {
  onMeta(agentType, threadId) { console.log(`Routed to ${agentType}`) },
  onDelta(content) { process.stdout.write(content) },
  onTool(name, preview) { console.log(`Tool: ${name}`) },
})
```

## Deployment

### Running the server

```bash
bun run src/server.ts
# Provider Copilot server running on http://localhost:3000
```

### Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/health` | GET | Health check → `{ status: "ok" }` |
| `/api/copilot` | POST | Sync query → `AgentResponse` JSON |
| `/api/copilot/ws` | WS | Streaming via WebSocket |

### Sync API

```bash
curl -X POST http://localhost:3000/api/copilot \
  -H "Content-Type: application/json" \
  -d '{"query": "How many patients?", "threadId": "optional-thread-id"}'
```

### WebSocket Protocol

Connect to `ws://localhost:3000/api/copilot/ws`.

**Client → Server:**
```json
{ "type": "query", "query": "...", "threadId": "..." }
```

**Server → Client (in order):**
```json
{ "type": "meta", "agentType": "clinical", "threadId": "..." }
{ "type": "delta", "content": "partial text..." }
{ "type": "tool", "name": "fhir_search_conditions", "preview": "..." }
{ "type": "done", "response": { "answer": "...", "citations": [...], ... } }
```

On error: `{ "type": "error", "message": "..." }`

The connection stays open after `done` — send another `query` message for multi-turn conversation.

### WebSocket Client Example (browser)

```javascript
const ws = new WebSocket("ws://localhost:3000/api/copilot/ws")
ws.onmessage = ({ data }) => {
  const msg = JSON.parse(data)
  switch (msg.type) {
    case "meta":  console.log(`Agent: ${msg.agentType}`); break
    case "delta": process.stdout.write(msg.content); break
    case "tool":  console.log(`Tool: ${msg.name}`); break
    case "done":  console.log("Response:", msg.response); break
    case "error": console.error(msg.message); break
  }
}
ws.onopen = () => {
  ws.send(JSON.stringify({ type: "query", query: "Clinical summary for patient-0001" }))
}
```

### What's deployed
- HTTP server (Elysia) with sync + WebSocket streaming
- Persistent memory (`BunSqliteSaver` backed by `bun:sqlite`, WAL mode)
- 6 agents, router, 12 tools, explainability — complete and tested
- OTel tracing via OpenLIT SDK auto-instrumentation + manual spans for router, FHIR HTTP, explainability
- Dockerfile for Railway deployment (`bun:sqlite` on persistent volume)

### Observability

OpenLIT auto-instruments all LangChain calls. Manual spans cover custom orchestration:

```
copilot.query (root)
  ├── router.classify_intent
  ├── agent.stream (auto-instrumented by OpenLIT)
  │   ├── llm.call (auto)
  │   ├── tool.fhir_search_patients (auto)
  │   │   └── fhir.http (manual)
  │   └── llm.call (auto)
  └── explainability.extract
```

**Local:** `docker compose up -d` → OpenLIT UI at `http://localhost:3001`
**Deploy:** Set `OTEL_EXPORTER_OTLP_ENDPOINT` + `OTEL_EXPORTER_OTLP_HEADERS` for Grafana Cloud

### Deployment (Railway)

1. Connect GitHub repo → Railway auto-deploys on push
2. Add persistent volume mounted at `/app/data` for SQLite checkpoints
3. Set environment variables: `GOOGLE_API_KEY`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS`

### What's needed for production

| Gap | What to build | Effort |
|-----|---------------|--------|
| **Auth / RBAC** | `UserContext` injection, tool-level policy gates, role-specific prompt segments | Medium |
| **Rate limiting** | Protect the FHIR API from excessive tool calls per request | Small |
| **Error handling** | Graceful degradation when FHIR API is down, retry logic, circuit breaker | Medium |

## Example Queries by Agent

### Lookup
- "Which attribution lists exist in the system?"
- "What insurance does patient-0001 have?"
- "Is patient-0003 covered by Northwind Health Plan?"

### Search
- "Find female patients over 60"
- "All encounters for James Smith"
- "Tell me about patient James Smith"

### Analytics
- "How many practitioners per organization?"
- "Diabetes-related encounters — top 3 providers?"
- "Compare the provider network"

### Clinical
- "Full clinical summary for patient-0001"
- "Tell me about encounter-0001 in plain English"

### Cohort
- "Find all patients with type 2 diabetes"
- "Patients with diabetes AND HbA1c > 9"
- "Patients on metformin without a diabetes diagnosis"
- "Active hypertension without treatment — who's at risk?"
- "Which patients haven't had a preventive care visit?"

### Export
- "Export all data for the ACO and tell me what we have"
