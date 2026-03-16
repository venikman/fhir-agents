import { tool } from "@langchain/core/tools"
import { z } from "zod"
import { fhirGet } from "./fhir.ts"

function summarizeProcedure(r: any): string {
  const id = `Procedure/${r.id}`
  const patient = r.subject?.reference ?? "unknown"

  // CPT code + display
  const coding = r.code?.coding?.[0]
  const cptCode = coding?.code ?? "unknown"
  const cptDisplay = coding?.display ?? ""
  const codeLabel = cptDisplay ? `${cptCode} ${cptDisplay}` : cptCode

  const status = r.status ?? "unknown"
  const performed = r.performedDateTime?.split("T")[0] ?? r.performedPeriod?.start?.split("T")[0] ?? "unknown"

  return `${id} | ${patient} | ${codeLabel} | ${status} | ${performed}`
}

export const searchProceduresTool = tool(
  async ({ patient, code }) => {
    const params = new URLSearchParams()
    if (patient) params.set("patient", patient)
    if (code) params.set("code", code)

    const bundle = await fhirGet(`/fhir/Procedure?${params}`)

    const total = bundle.total ?? bundle.entry?.length ?? 0
    if (!bundle.entry?.length) return `Procedures: ${total} result(s) -- no entries.`

    const summaries = bundle.entry.map((e: any) => summarizeProcedure(e.resource))
    return `Procedures: ${total} result(s)\n${summaries.join("\n")}`
  },
  {
    name: "fhir_search_procedures",
    description:
      "Search for FHIR Procedure resources. Filter by patient reference or CPT code. Code format: \"http://www.ama-assn.org/go/cpt|{code}\" (e.g. 99385 for preventive visit). Returns enriched summaries with CPT code, procedure name, status, and performed date.",
    schema: z.object({
      patient: z
        .string()
        .optional()
        .describe("Patient reference, e.g. Patient/patient-0001"),
      code: z
        .string()
        .optional()
        .describe(
          'Token search with system|code. CPT system: "http://www.ama-assn.org/go/cpt|{code}", e.g. 99385 for preventive visit'
        ),
    }),
  }
)
