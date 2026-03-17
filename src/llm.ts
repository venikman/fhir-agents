import type { LanguageModelLike } from "@langchain/core/language_models/base"
import { ChatGoogleGenerativeAI } from "@langchain/google-genai"

export const PRIMARY_GEMINI_MODEL = "gemini-3-flash-preview"
export const FALLBACK_GEMINI_MODEL = "gemini-3.1-flash-lite-preview"

type GeminiTools = Parameters<ChatGoogleGenerativeAI["bindTools"]>[0]

function createChatModel(model: typeof PRIMARY_GEMINI_MODEL | typeof FALLBACK_GEMINI_MODEL) {
  return new ChatGoogleGenerativeAI({
    model,
    apiKey: process.env.GOOGLE_API_KEY,
  })
}

export function createGeminiFallbackModel(): LanguageModelLike {
  const primaryModel = createChatModel(PRIMARY_GEMINI_MODEL)
  const fallbackModel = createChatModel(FALLBACK_GEMINI_MODEL)
  return primaryModel.withFallbacks([fallbackModel])
}

// LangGraph auto-binds static models for tool-calling agents, so bind first, then compose fallbacks.
export function createGeminiToolFallbackModel(tools: GeminiTools): LanguageModelLike {
  const primaryModel = createChatModel(PRIMARY_GEMINI_MODEL).bindTools(tools)
  const fallbackModel = createChatModel(FALLBACK_GEMINI_MODEL).bindTools(tools)
  return primaryModel.withFallbacks([fallbackModel])
}
