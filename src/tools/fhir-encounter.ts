import { tool } from "@langchain/core/tools"
import { z } from "zod"
import { fhirGet } from "./fhir.ts"

// ── Encounter-specific summary ─────────────────────────────────────

function summarizeEncounterBundle(bundle: any): string {
  const total = bundle.total ?? bundle.entry?.length ?? 0
  if (!bundle.entry?.length) return `Encounters: ${total} result(s) — no entries.`

  const lines = bundle.entry.map((e: any) => {
    const r = e.resource

    const id = `${r.resourceType}/${r.id}`
    const patient = r.subject?.reference ?? "—"
    const date = r.period?.start?.slice(0, 10) ?? "—"
    const status = r.status ?? "—"
    const cls = r.class?.code ?? "—"

    // Type: first coding from first type element (CPT)
    const typeCoding = r.type?.[0]?.coding?.[0]
    const typeStr = typeCoding
      ? `${typeCoding.code}${typeCoding.display ? " " + typeCoding.display : ""}`
      : "—"

    // Reason code: first coding from first reasonCode element (ICD-10)
    const reasonCoding = r.reasonCode?.[0]?.coding?.[0]
    const reasonStr = reasonCoding
      ? `${reasonCoding.code}${reasonCoding.display ? " " + reasonCoding.display : ""}`
      : "—"

    // Practitioner: first participant with individual reference
    const practitioner = r.participant
      ?.find((p: any) => p.individual?.reference?.startsWith("Practitioner/"))
      ?.individual?.reference ?? "—"

    // Location: first location reference
    const location = r.location?.[0]?.location?.reference ?? "—"

    return `  ${id} | ${patient} | ${date} | ${status} | ${cls} | ${typeStr} | ${reasonStr} | ${practitioner} | ${location}`
  })

  return `Encounters: ${total} result(s)\n${lines.join("\n")}`
}

// ── Tool ────────────────────────────────────────────────────────────

export const searchEncountersTool = tool(
  async ({ patient, date_ge, date_le, status, type, practitioner, location, reasonCode }) => {
    const params = new URLSearchParams()
    if (patient) params.set("patient", patient)
    if (date_ge) params.append("date", `ge${date_ge}`)
    if (date_le) params.append("date", `le${date_le}`)
    if (status) params.set("status", status)
    if (type) params.set("type", type)
    if (practitioner) params.set("practitioner", practitioner)
    if (location) params.set("location", location)
    if (reasonCode) params.set("reason-code", reasonCode)

    const bundle = await fhirGet(`/fhir/Encounter?${params}`)
    return summarizeEncounterBundle(bundle)
  },
  {
    name: "fhir_search_encounters",
    description:
      "Search for FHIR Encounter resources with flexible filters. " +
      "Parameters (all optional): " +
      "patient — patient reference (e.g. 'Patient/patient-0001'); " +
      "date_ge / date_le — date range in YYYY-MM-DD, maps to FHIR date with ge/le prefixes; " +
      "status — exact match: 'planned', 'arrived', 'in-progress', 'finished', or 'cancelled'; " +
      "type — token with system|code for CPT (e.g. 'http://www.ama-assn.org/go/cpt|99213'); " +
      "practitioner — practitioner reference (e.g. 'Practitioner/practitioner-001'); " +
      "location — location reference (e.g. 'Location/location-001'); " +
      "reasonCode — token with system|code for ICD-10 (e.g. 'http://hl7.org/fhir/sid/icd-10-cm|E11.9'). " +
      "Returns a pipe-delimited summary: ID | patient | date | status | class | type | reasonCode | practitioner | location.",
    schema: z.object({
      patient: z.string().optional().describe("Patient reference, e.g. Patient/patient-0001"),
      date_ge: z.string().optional().describe("Start date (inclusive) in YYYY-MM-DD format"),
      date_le: z.string().optional().describe("End date (inclusive) in YYYY-MM-DD format"),
      status: z
        .enum(["planned", "arrived", "in-progress", "finished", "cancelled"])
        .optional()
        .describe("Encounter status filter"),
      type: z
        .string()
        .optional()
        .describe("Token search system|code, e.g. http://www.ama-assn.org/go/cpt|99213"),
      practitioner: z
        .string()
        .optional()
        .describe("Practitioner reference, e.g. Practitioner/practitioner-001"),
      location: z.string().optional().describe("Location reference, e.g. Location/location-001"),
      reasonCode: z
        .string()
        .optional()
        .describe("Token search system|code for reason, e.g. http://hl7.org/fhir/sid/icd-10-cm|E11.9"),
    }),
  }
)
