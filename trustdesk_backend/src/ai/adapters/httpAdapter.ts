import { config } from "../../config.js";
import { classifyTicket, type ModuleRef } from "../pipeline/classify.js";
import { MockAdapter } from "./mockAdapter.js";
import type { DraftInput, DraftOutput, LLMAdapter } from "./types.js";

const fallback = new MockAdapter();

async function complete(prompt: string): Promise<string | null> {
  if (config.llmProvider === "gemini" && config.geminiApiKey) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.geminiModel}:generateContent?key=${config.geminiApiKey}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
      }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    return json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("\n") ?? null;
  }
  if (config.llmProvider === "groq" && config.groqApiKey) {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.groqApiKey}`,
      },
      body: JSON.stringify({
        model: config.groqModel,
        messages: [{ role: "user", content: prompt }],
        temperature: 0,
      }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return json.choices?.[0]?.message?.content ?? null;
  }
  return null;
}

export class HttpLLMAdapter implements LLMAdapter {
  readonly name = config.llmProvider;

  async classify(text: string, modules: ModuleRef[]) {
    const keyword = classifyTicket(text, modules);
    const prompt = [
      "Classify the support ticket into exactly one of these module slugs.",
      "Return JSON only: {\"moduleSlug\",\"priority\",\"sentiment\",\"intent\"}.",
      "If two modules are nearly tied, set moduleSlug to null.",
      modules.map((m) => `${m.slug}: ${m.name}. ${m.description ?? ""} keywords: ${(m.keywords ?? []).join(", ")}`).join("\n"),
      "<untrusted_context>",
      text,
      "</untrusted_context>",
    ].join("\n");
    try {
      const raw = await complete(prompt);
      if (!raw) return keyword;
      const match = raw.match(/\{[\s\S]*\}/);
      if (!match) return keyword;
      const parsed = JSON.parse(match[0]) as { moduleSlug?: string | null };
      if (parsed.moduleSlug && modules.some((m) => m.slug === parsed.moduleSlug)) {
        if (!keyword.moduleSlug || keyword.moduleSlug === "general") {
          return { ...keyword, moduleSlug: parsed.moduleSlug, reason: `${keyword.reason} LLM selected ${parsed.moduleSlug}.` };
        }
      }
      return keyword;
    } catch {
      return keyword;
    }
  }

  async draft(input: DraftInput): Promise<DraftOutput> {
    const safe = await fallback.draft(input);
    try {
      const raw = await complete(input.prompt);
      if (!raw) return { ...safe, usedLlm: false };
      return { body: raw, citations: safe.citations, escalate: safe.escalate, usedLlm: true };
    } catch {
      return { ...safe, usedLlm: false };
    }
  }
}
