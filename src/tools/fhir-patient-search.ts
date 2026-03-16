import { tool } from "@langchain/core/tools"
import { z } from "zod"
import { fhirGet } from "./fhir.ts"

function summarizePatientBundle(bundle: any): string {
  const total = bundle.total ?? bundle.entry?.length ?? 0
  if (!bundle.entry?.length) return `Patient search: ${total} result(s) — no entries.`

  const lines = bundle.entry.map((e: any) => {
    const r = e.resource
    const names = Array.isArray(r.name)
      ? r.name
          .map((n: any) =>
            [n.prefix, n.given?.join(" "), n.family]
              .filter(Boolean)
              .join(" ")
          )
          .join("; ")
      : r.name ?? "Unknown"

    const gender = r.gender ?? "unknown"
    const dob = r.birthDate ? `DOB ${r.birthDate}` : "DOB unknown"

    const addr = r.address?.[0]
    const location =
      addr && (addr.city || addr.state)
        ? [addr.city, addr.state].filter(Boolean).join(", ")
        : null

    const gp = r.generalPractitioner?.[0]?.reference ?? null

    const parts = [
      `Patient/${r.id}: ${names}`,
      gender,
      dob,
      location,
      gp ? `GP: ${gp}` : null,
    ].filter(Boolean)

    return `  ${parts.join(" | ")}`
  })

  return `Patient search: ${total} result(s)\n${lines.join("\n")}`
}

export const searchPatientsTool = tool(
  async ({ name, gender, birthdate_ge, birthdate_le, generalPractitioner }) => {
    const params = new URLSearchParams()
    if (name) params.set("name", name)
    if (gender) params.set("gender", gender)
    if (birthdate_ge) params.append("birthdate", `ge${birthdate_ge}`)
    if (birthdate_le) params.append("birthdate", `le${birthdate_le}`)
    if (generalPractitioner) params.set("general-practitioner", generalPractitioner)

    const bundle = await fhirGet(`/fhir/Patient?${params}`)
    return summarizePatientBundle(bundle)
  },
  {
    name: "fhir_search_patients",
    description:
      "Search for Patient resources by name (partial match), gender (male/female/other/unknown), birthdate range (ge/le dates), or assigned general practitioner reference. All parameters are optional and can be combined to narrow results.",
    schema: z.object({
      name: z
        .string()
        .optional()
        .describe(
          "Partial text match on patient name (searches both given and family names), e.g. 'Smith'"
        ),
      gender: z
        .enum(["male", "female", "other", "unknown"])
        .optional()
        .describe("Administrative gender: male, female, other, or unknown"),
      birthdate_ge: z
        .string()
        .optional()
        .describe(
          "Lower bound for birth date (inclusive), ISO format YYYY-MM-DD, e.g. '1960-01-01'"
        ),
      birthdate_le: z
        .string()
        .optional()
        .describe(
          "Upper bound for birth date (inclusive), ISO format YYYY-MM-DD, e.g. '2000-12-31'"
        ),
      generalPractitioner: z
        .string()
        .optional()
        .describe(
          "Reference to the assigned general practitioner, e.g. 'PractitionerRole/practitionerrole-001'"
        ),
    }),
  }
)
