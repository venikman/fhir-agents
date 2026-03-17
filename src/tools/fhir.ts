import { tool } from "@langchain/core/tools"
import { SpanStatusCode } from "@opentelemetry/api"
import { getTelemetryException, setContentAttribute, tracer } from "../otel.ts"
import { z } from "zod"

const BASE_URL = process.env.FHIR_BASE_URL ?? "https://bulk-atr.nedbailov375426.workers.dev"

// ── Helpers ──────────────────────────────────────────────────────────

export async function fhirGet<T = any>(
  path: string,
  accept = "application/fhir+json",
): Promise<T> {
  return tracer.startActiveSpan("fhir.http", async (span) => {
    const url = `${BASE_URL}${path}`
    span.setAttribute("http.method", "GET")
    setContentAttribute(span, "http.url", url)

    // Extract resource type from path (e.g. /fhir/Patient/123 → Patient)
    const resourceMatch = path.match(/\/fhir\/(\w+)/)
    const resourceType = resourceMatch?.[1]
    if (resourceType) span.setAttribute("fhir.resource_type", resourceType)

    try {
      const res = await fetch(url, {
        headers: { Accept: accept },
      })
      span.setAttribute("http.status_code", res.status)

      if (!res.ok) {
        const body = await res.text()
        span.setStatus({ code: SpanStatusCode.ERROR, message: `FHIR ${res.status}` })
        throw new Error(`FHIR ${res.status}: ${body}`)
      }

      span.setStatus({ code: SpanStatusCode.OK })
      return (await res.json()) as T
    } catch (err) {
      const traceError = getTelemetryException(err)
      span.setStatus({ code: SpanStatusCode.ERROR, message: traceError.message })
      span.recordException(traceError)
      throw err
    } finally {
      span.end()
    }
  })
}

export function summarizeBundle(bundle: any): string {
  const total = bundle.total ?? bundle.entry?.length ?? 0
  if (!bundle.entry?.length) return `Bundle with ${total} result(s) — no entries.`

  const entries = bundle.entry.map((e: any) => {
    const r = e.resource
    const label = r.name
      ? Array.isArray(r.name)
        ? r.name.map((n: any) => [n.prefix, n.given?.join(" "), n.family].filter(Boolean).join(" ")).join("; ")
        : r.name
      : r.id
    return `  ${r.resourceType}/${r.id}: ${label}`
  })

  return `Bundle: ${total} result(s)\n${entries.join("\n")}`
}

export function summarizeResource(r: any): string {
  return JSON.stringify(r, null, 2).slice(0, 3000)
}

// ── Tools ────────────────────────────────────────────────────────────

export const searchGroupsTool = tool(
  async ({ identifier, name }) => {
    const params = new URLSearchParams()
    if (identifier) params.set("identifier", identifier)
    if (name) params.set("name", name)
    params.set("_summary", "true")
    const bundle = await fhirGet(`/fhir/Group?${params}`)
    return summarizeBundle(bundle)
  },
  {
    name: "fhir_search_groups",
    description:
      "Search for attribution Groups by identifier (system|value token) or name (partial match). Returns group IDs needed for other tools. Provide exactly one of identifier or name.",
    schema: z.object({
      identifier: z.string().optional().describe("Token search: {system}|{value}, e.g. http://example.org/contracts|CTR-2026-NWACO-001"),
      name: z.string().optional().describe("Case-insensitive partial name match"),
    }),
  }
)

export const readResourceTool = tool(
  async ({ resourceType, id }) => {
    const resource = await fhirGet(`/fhir/${resourceType}/${id}`)
    return summarizeResource(resource)
  },
  {
    name: "fhir_read_resource",
    description:
      "Read a single FHIR resource by type and ID. Supported types: Group, Patient, Coverage, RelatedPerson, Practitioner, PractitionerRole, Organization, Location, Encounter, Condition, Observation, MedicationRequest, Procedure, AllergyIntolerance.",
    schema: z.object({
      resourceType: z.enum(["Group", "Patient", "Coverage", "RelatedPerson", "Practitioner", "PractitionerRole", "Organization", "Location", "Encounter", "Condition", "Observation", "MedicationRequest", "Procedure", "AllergyIntolerance"]),
      id: z.string().describe("Resource ID, e.g. patient-0001"),
    }),
  }
)

export const listResourcesTool = tool(
  async ({ resourceType }) => {
    const bundle = await fhirGet(`/fhir/${resourceType}`)
    return summarizeBundle(bundle)
  },
  {
    name: "fhir_list_resources",
    description:
      "List all resources of a given type. Supported: Patient, Coverage, RelatedPerson, Practitioner, PractitionerRole, Organization, Location, Encounter, Condition, Observation, MedicationRequest, Procedure, AllergyIntolerance. Returns a summary with IDs. WARNING: clinical resources can be very large (600+ encounters). Prefer specific search tools (fhir_search_encounters, etc.) when filtering is needed.",
    schema: z.object({
      resourceType: z.enum(["Patient", "Coverage", "RelatedPerson", "Practitioner", "PractitionerRole", "Organization", "Location", "Encounter", "Condition", "Observation", "MedicationRequest", "Procedure", "AllergyIntolerance"]),
    }),
  }
)

export const bulkExportTool = tool(
  async ({ groupId, resourceTypes }) => {
    const types = resourceTypes ?? "Group,Patient,Coverage,RelatedPerson,Practitioner,PractitionerRole,Organization,Location"

    // 1 — Kick off
    const kickUrl = `${BASE_URL}/fhir/Group/${groupId}/$davinci-data-export?exportType=hl7.fhir.us.davinci-atr&_type=${types}`

    const kickRes = await tracer.startActiveSpan("fhir.http", async (span) => {
      span.setAttribute("http.method", "GET")
      setContentAttribute(span, "http.url", kickUrl)
      span.setAttribute("fhir.resource_type", "Group")

      try {
        const res = await fetch(kickUrl, {
          headers: { Prefer: "respond-async" },
        })
        span.setAttribute("http.status_code", res.status)
        span.setStatus({ code: SpanStatusCode.OK })
        return res
      } catch (err) {
        const traceError = getTelemetryException(err)
        span.setStatus({ code: SpanStatusCode.ERROR, message: traceError.message })
        span.recordException(traceError)
        throw err
      } finally {
        span.end()
      }
    })

    if (kickRes.status !== 202) {
      const body = await kickRes.text()
      return `Export kick-off failed (${kickRes.status}): ${body}`
    }

    const statusUrl = kickRes.headers.get("Content-Location")!

    // 2 — Poll until done
    let attempts = 0
    while (attempts < 60) {
      attempts++
      const pollRes = await fetch(statusUrl, {
        headers: { Accept: "application/json" },
      })

      if (pollRes.status === 200) {
        const manifest = (await pollRes.json()) as {
          output?: Array<{ type?: string; url: string }>
        }

        // 3 — Download all NDJSON and build summary
        const lines: string[] = [`Export complete (${attempts} polls). Files:`]
        const outputs = manifest.output ?? []

        for (const entry of outputs) {
          const fileRes = await fetch(entry.url, {
            headers: { Accept: "application/fhir+ndjson" },
          })
          const ndjson = await fileRes.text()
          const resources = ndjson.trim().split("\n")
          lines.push(`  ${entry.type ?? "unknown"}: ${resources.length} resource(s)`)

          // Include first 2 resources as sample for each type
          for (const line of resources.slice(0, 2)) {
            const r = JSON.parse(line)
            const label = r.name
              ? Array.isArray(r.name)
                ? r.name.map((n: any) => [n.given?.join(" "), n.family].filter(Boolean).join(" ")).join("; ")
                : r.name
              : ""
            lines.push(`    - ${r.resourceType}/${r.id}${label ? `: ${label}` : ""}`)
          }
          if (resources.length > 2) lines.push(`    ... and ${resources.length - 2} more`)
        }

        return lines.join("\n")
      }

      if (pollRes.status === 202) {
        const retryAfter = parseInt(pollRes.headers.get("Retry-After") ?? "1", 10)
        await Bun.sleep(retryAfter * 1000)
        continue
      }

      if (pollRes.status === 429) {
        const retryAfter = parseInt(pollRes.headers.get("Retry-After") ?? "5", 10)
        await Bun.sleep(retryAfter * 1000)
        continue
      }

      const body = await pollRes.text()
      return `Poll failed (${pollRes.status}): ${body}`
    }

    return "Export timed out after 60 polls"
  },
  {
    name: "fhir_bulk_export",
    description:
      "Run a full bulk data export for an attribution Group. Kicks off async export, polls until complete, downloads all NDJSON files, and returns a summary. This is the most comprehensive way to get all data for a group. Use groupId from fhir_search_groups.",
    schema: z.object({
      groupId: z.string().describe("Group resource ID, e.g. group-2026-northwind-atr-001"),
      resourceTypes: z.string().optional().describe("Comma-separated types to export. Defaults to all: Group,Patient,Coverage,RelatedPerson,Practitioner,PractitionerRole,Organization,Location"),
    }),
  }
)

export const fhirTools = [searchGroupsTool, readResourceTool, listResourcesTool, bulkExportTool]
