import { tool } from "@langchain/core/tools"
import { z } from "zod"

export const calculatorTool = tool(
  async ({ expression }) => {
    try {
      // Safe math evaluation — only allows numbers, operators, parentheses, and decimal points
      if (!/^[\d\s+\-*/().%]+$/.test(expression)) {
        return `Error: invalid expression. Only numbers and basic operators (+, -, *, /, %, parentheses) are allowed.`
      }
      const result = new Function(`"use strict"; return (${expression})`)()
      return `${expression} = ${result}`
    } catch (e) {
      return `Error evaluating "${expression}": ${e instanceof Error ? e.message : String(e)}`
    }
  },
  {
    name: "calculator",
    description: "Evaluate a mathematical expression. Use this for any calculations like percentages, ratios, arithmetic.",
    schema: z.object({
      expression: z.string().describe("A mathematical expression to evaluate, e.g. '(145000000 / 125000000) * 100'"),
    }),
  }
)
