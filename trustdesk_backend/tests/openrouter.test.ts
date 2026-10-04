import { describe, expect, it } from "vitest";
import { OpenRouterAdapter, type FetchLike } from "../src/ai/adapters/openrouter.js";

const chunk = { doc_id: "KB-REFUND-001", title: "Refunds", content: "Damaged items can be reviewed.", score: 0.4 };

function adapter(fetchImpl: FetchLike) {
  return new OpenRouterAdapter({
    fetchImpl,
    apiKey: "test-key",
    modelClassify: "openai/gpt-4o-mini",
    modelDraft: "anthropic/claude-3.5-sonnet",
    referer: "http://localhost:5173",
  });
}

describe("OpenRouterAdapter", () => {
  it("parses a normal draft and sends the OpenRouter headers", async () => {
    const seen: { url: string; init?: RequestInit }[] = [];
    const fetchImpl: FetchLike = async (url, init) => {
      seen.push({ url, init });
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "Sorry about the damage. See KB-REFUND-001." } }],
        }),
        { status: 200 },
      );
    };
    const drafted = await adapter(fetchImpl).draft({
      subject: "Damaged earbuds",
      body: "They arrived cracked.",
      prompt: "Draft a reply using the untrusted context block.",
      policyChunks: [chunk],
    });
    expect(drafted.body).toBe("Sorry about the damage.");
    expect(drafted.citations).toEqual(["KB-REFUND-001"]);
    expect(drafted.usedLlm).toBe(true);
    expect(seen[0]?.url).toBe("https://openrouter.ai/api/v1/chat/completions");
    const headers = seen[0]?.init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer test-key");
    expect(headers["HTTP-Referer"]).toBe("http://localhost:5173");
    expect(headers["X-Title"]).toBe("TrustDesk");
    const body = JSON.parse(String(seen[0]?.init?.body));
    expect(body.model).toBe("anthropic/claude-3.5-sonnet");
  });

  it("does not escalate because the draft mentions escalation", async () => {
    const fetchImpl: FetchLike = async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "No escalation is required. See KB-REFUND-001." } }],
        }),
        { status: 200 },
      );
    const drafted = await adapter(fetchImpl).draft({
      subject: "Question",
      body: "Hello",
      prompt: "prompt",
      policyChunks: [chunk],
    });
    expect(drafted.escalate).toBe(false);
    expect(drafted.body).toContain("No escalation is required");
  });

  it("retries a 500 and then parses the draft", async () => {
    let calls = 0;
    const fetchImpl: FetchLike = async () => {
      calls += 1;
      if (calls === 1) return new Response("unavailable", { status: 500 });
      return new Response(
        JSON.stringify({ choices: [{ message: { content: "See KB-REFUND-001 for the return window." } }] }),
        { status: 200 },
      );
    };
    const drafted = await adapter(fetchImpl).draft({
      subject: "Question",
      body: "Hello",
      prompt: "prompt",
      policyChunks: [chunk],
    });
    expect(calls).toBe(2);
    expect(drafted.body).toContain("KB-REFUND-001");
  });

  it("returns the mock draft when the body is empty or malformed", async () => {
    const empty = adapter(async () => new Response(JSON.stringify({ choices: [{ message: { content: "  " } }] }), { status: 200 }));
    const malformed = adapter(async () => new Response("not-json", { status: 200 }));
    const input = {
      subject: "Question",
      body: "Hello",
      prompt: "prompt",
      policyChunks: [chunk],
    };
    const emptyDraft = await empty.draft(input);
    const malformedDraft = await malformed.draft(input);
    expect(emptyDraft.citations).toContain("KB-REFUND-001");
    expect(malformedDraft.citations).toContain("KB-REFUND-001");
    expect(emptyDraft.usedLlm).toBe(false);
    expect(emptyDraft.body.length).toBeGreaterThan(20);
    expect(emptyDraft.body).not.toBe("  ");
  });

  it("drops tool names that selectTools did not allow", async () => {
    const fetchImpl: FetchLike = async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ tools: ["issue_coupon", "start_refund_review"] }) } }] }), {
        status: 200,
      });
    const tools = await adapter(fetchImpl).recommendTools("Please refund order ord_5001", ["start_refund_review", "escalate_to_human"]);
    expect(tools).toEqual(["start_refund_review"]);
  });
});
