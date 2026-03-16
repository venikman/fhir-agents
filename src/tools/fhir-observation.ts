import { tool } from "@langchain/core/tools"
import { z } from "zod"
import { fhirGet } from "./fhir.ts"

function formatValue(r: any): string {
  if (r.valueQuantity) {
    return `${r.valueQuantity.value} ${r.valueQuantity.unit ?? ""}`.trim()
  }
  if (r.valueString) {
    return r.valueString
  }
  if (r.component && Array.isArray(r.component)) {
    return r.component
      .map((c: any) => {
        const code = c.code?.coding?.[0]?.display ?? c.code?.coding?.[0]?.code ?? ""
        const val = c.valueQuantity
          ? `${c.valueQuantity.value} ${c.valueQuantity.unit ?? ""}`.trim()
          : ""
        return `${code}: ${val}`
      })
      .join(" / ")
  }
  return ""
}

function summarizeObservation(r: any): string {
  const id = `Observation/${r.id}`
  const patient = r.subject?.reference ?? ""
  const coding = r.code?.coding?.[0]
  const loincCode = coding?.code ?? ""
  const display = coding?.display ?? ""
  const value = formatValue(r)
  const date = r.effectiveDateTime?.split("T")[0] ?? ""
  const status = r.status ?? ""

  return `${id} | ${patient} | ${loincCode} ${display} | ${value} | ${date} | ${status}`
}

export const searchObservationsTool = tool(
  async ({ code, patient, category, date_ge, date_le }) => {
    const params = new URLSearchParams()
    if (code) params.set("code", code)
    if (patient) params.set("patient", patient)
    if (category) params.set("category", category)
    if (date_ge) params.append("date", `ge${date_ge}`)
    if (date_le) params.append("date", `le${date_le}`)

    const bundle = await fhirGet(`/fhir/Observation?${params}`)
    const total = bundle.total ?? bundle.entry?.length ?? 0

    if (!bundle.entry?.length) return `Observations: ${total} result(s) — no entries.`

    const lines = bundle.entry.map((e: any) => `  ${summarizeObservation(e.resource)}`)
    return `Observations: ${total} result(s)\n${lines.join("\n")}`
  },
  {
    name: "fhir_search_observations",
    description:
      "Search for FHIR Observation resources by LOINC code, patient, category, and/or date range. Returns enriched summaries including values and units. Use category 'vital-signs' for blood pressure, heart rate, BMI; use 'laboratory' for lab results like HbA1c, cholesterol, glucose.",
    schema: z.object({
      code: z
        .string()
        .optional()
        .describe(
          "LOINC code token as system|code. Common codes: 4548-4 (HbA1c), 2339-0 (Glucose), 2093-3 (Total Cholesterol), 8480-6 (Systolic BP), 8867-4 (Heart rate), 39156-5 (BMI). Example: http://loinc.org|4548-4"
        ),
      patient: z
        .string()
        .optional()
        .describe("Patient reference, e.g. Patient/patient-0001"),
      category: z
        .enum(["vital-signs", "laboratory"])
        .optional()
        .describe(
          "Observation category. 'vital-signs' includes blood pressure, heart rate, BMI, temperature. 'laboratory' includes HbA1c, cholesterol, glucose, triglycerides, and other lab panels."
        ),
      date_ge: z
        .string()
        .optional()
        .describe("Observations on or after this date (YYYY-MM-DD)"),
      date_le: z
        .string()
        .optional()
        .describe("Observations on or before this date (YYYY-MM-DD)"),
    }),
  }
)
