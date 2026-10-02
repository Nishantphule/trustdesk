import { config } from "../../config.js";
import { HttpLLMAdapter } from "./httpAdapter.js";
import { MockAdapter } from "./mockAdapter.js";
import { OpenRouterAdapter } from "./openrouter.js";
import type { LLMAdapter } from "./types.js";

export function getAdapter(forceMock = false): LLMAdapter {
  if (forceMock || config.llmProvider === "mock") return new MockAdapter();
  if (config.llmProvider === "openrouter") {
    if (!config.openRouterApiKey) return new MockAdapter();
    return new OpenRouterAdapter();
  }
  if (config.llmProvider === "gemini" || config.llmProvider === "groq") return new HttpLLMAdapter();
  return new MockAdapter();
}

export type { LLMAdapter } from "./types.js";
