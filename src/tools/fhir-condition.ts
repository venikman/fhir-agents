import { tool } from "@langchain/core/tools"
import { z } from "zod"
import { fhirGet } from "./fhir.ts"

function summarizeCondition(r: any): string {
  const id = `Condition/${r.id}`
  const patient = r.subject?.reference ?? "unknown"

  // ICD-10 code + display
  const coding = r.code?.coding?.[0]
  const icdCode = coding?.code ?? "unknown"
  const icdDisplay = coding?.display ?? ""
  const codeLabel = icdDisplay ? `${icdCode} ${icdDisplay}` : icdCode

  // Clinical status
  const clinicalStatus = r.clinicalStatus?.coding?.[0]?.code ?? "unknown"

  // Category
  const category = r.category?.[0]?.coding?.[0]?.code ?? "unknown"

  // Recorded date
  const recordedDate = r.recordedDate ?? r.onsetDateTime ?? "unknown"

  return `${id} | ${patient} | ${codeLabel} | ${clinicalStatus} | ${category} | ${recordedDate}`
}

export const searchConditionsTool = tool(
  async ({ patient, code, clinicalStatus, category }) => {
    const params = new URLSearchParams()
    if (patient) params.set("patient", patient)
    if (code) params.set("code", code)
    if (clinicalStatus) params.set("clinical-status", clinicalStatus)
    if (category) params.set("category", category)

    const bundle = await fhirGet(`/fhir/Condition?${params}`)

    const total = bundle.total ?? bundle.entry?.length ?? 0
    if (!bundle.entry?.length) return `Conditions: ${total} result(s) -- no entries.`

    const summaries = bundle.entry.map((e: any) => summarizeCondition(e.resource))
    return `Conditions: ${total} result(s)\n${summaries.join("\n")}`
  },
  {
    name: "fhir_search_conditions",
    description:
      "Search for FHIR Condition resources. Filter by patient reference, ICD-10 code, clinical status, or category. Returns enriched summaries with ICD-10 code, display name, clinical status, category, and recorded date.",
    schema: z.object({
      patient: z
        .string()
        .optional()
        .describe("Patient reference, e.g. Patient/patient-0001"),
      code: z
        .string()
        .optional()
        .describe(
          'Token search with system|code. ICD-10 system: "http://hl7.org/fhir/sid/icd-10-cm|{code}". Prefix search is supported -- E11 matches E11.*'
        ),
      clinicalStatus: z
        .enum(["active", "recurrence", "relapse", "inactive", "remission", "resolved"])
        .optional()
        .describe("Clinical status filter"),
      category: z
        .enum(["problem-list-item", "encounter-diagnosis"])
        .optional()
        .describe("Condition category filter"),
    }),
  }
)
