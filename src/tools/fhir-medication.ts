import { tool } from "@langchain/core/tools"
import { z } from "zod"
import { fhirGet } from "./fhir.ts"

function summarizeMedicationRequest(r: any): string {
  const id = `MedicationRequest/${r.id}`
  const patient = r.subject?.reference ?? "unknown"

  // RxNorm code + display
  const coding = r.medicationCodeableConcept?.coding?.[0]
  const rxCode = coding?.code ?? "unknown"
  const rxDisplay = coding?.display ?? ""
  const codeLabel = rxDisplay ? `${rxCode} ${rxDisplay}` : rxCode

  const status = r.status ?? "unknown"
  const authoredOn = r.authoredOn?.split("T")[0] ?? "unknown"

  return `${id} | ${patient} | ${codeLabel} | ${status} | ${authoredOn}`
}

export const searchMedicationsTool = tool(
  async ({ patient, status, code }) => {
    const params = new URLSearchParams()
    if (patient) params.set("patient", patient)
    if (status) params.set("status", status)
    if (code) params.set("code", code)

    const bundle = await fhirGet(`/fhir/MedicationRequest?${params}`)

    const total = bundle.total ?? bundle.entry?.length ?? 0
    if (!bundle.entry?.length) return `MedicationRequests: ${total} result(s) -- no entries.`

    const summaries = bundle.entry.map((e: any) => summarizeMedicationRequest(e.resource))
    return `MedicationRequests: ${total} result(s)\n${summaries.join("\n")}`
  },
  {
    name: "fhir_search_medications",
    description:
      "Search for FHIR MedicationRequest resources. Filter by patient reference, status, or RxNorm code. Code format: \"http://www.nlm.nih.gov/research/umls/rxnorm|{code}\" (e.g. 860975 for Metformin). Returns enriched summaries with RxNorm code, medication name, status, and authored date.",
    schema: z.object({
      patient: z
        .string()
        .optional()
        .describe("Patient reference, e.g. Patient/patient-0001"),
      status: z
        .enum(["active", "on-hold", "cancelled", "completed", "stopped"])
        .optional()
        .describe("MedicationRequest status filter"),
      code: z
        .string()
        .optional()
        .describe(
          'Token search with system|code. RxNorm system: "http://www.nlm.nih.gov/research/umls/rxnorm|{code}", e.g. 860975 for Metformin'
        ),
    }),
  }
)
