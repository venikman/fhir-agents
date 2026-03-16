import { tool } from "@langchain/core/tools"
import { z } from "zod"
import { fhirGet } from "./fhir.ts"

function summarizeAllergyIntolerance(r: any): string {
  const id = `AllergyIntolerance/${r.id}`
  const patient = r.patient?.reference ?? "unknown"

  // Substance/code + display
  const coding = r.code?.coding?.[0]
  const substance = coding?.display ?? coding?.code ?? "unknown"

  // Clinical status
  const clinicalStatus = r.clinicalStatus?.coding?.[0]?.code ?? "unknown"

  // Criticality
  const criticality = r.criticality ?? "unknown"

  return `${id} | ${patient} | ${substance} | ${clinicalStatus} | ${criticality}`
}

export const searchAllergiesTool = tool(
  async ({ patient }) => {
    const params = new URLSearchParams()
    params.set("patient", patient)

    const bundle = await fhirGet(`/fhir/AllergyIntolerance?${params}`)

    const total = bundle.total ?? bundle.entry?.length ?? 0
    if (!bundle.entry?.length) return `AllergyIntolerances: ${total} result(s) -- no entries.`

    const summaries = bundle.entry.map((e: any) => summarizeAllergyIntolerance(e.resource))
    return `AllergyIntolerances: ${total} result(s)\n${summaries.join("\n")}`
  },
  {
    name: "fhir_search_allergies",
    description:
      "Search for FHIR AllergyIntolerance resources by patient reference. Returns enriched summaries with substance name, clinical status, and criticality.",
    schema: z.object({
      patient: z
        .string()
        .describe("Patient reference, e.g. Patient/patient-0001"),
    }),
  }
)
