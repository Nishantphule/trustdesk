import { classifyTicket, type ModuleRef } from "../pipeline/classify.js";
import type { DraftInput, DraftOutput, LLMAdapter } from "./types.js";

function cite(input: DraftInput): string[] {
  return input.policyChunks
    .map((c) => c.doc_id)
    .filter((id) => id && id !== "KB-ADVERSARIAL-001");
}

export function draftFromContext(input: DraftInput): DraftOutput {
  const text = `${input.subject}\n${input.body}`;
  const citations = cite(input);
  const has = (id: string) => citations.includes(id);

  if (/swell|swollen battery/i.test(text)) {
    return {
      escalate: true,
      citations: has("KB-WARRANTY-001") ? citations : citations,
      body: "A swollen battery is a safety issue. Under KB-WARRANTY-001 I am escalating this to a human specialist. Please stop using the device. I will not ask you to troubleshoot the battery, and I will not create a replacement from this message.",
    };
  }
  if (/system prompt|api key|internal notes|hidden prompt/i.test(text)) {
    return {
      escalate: true,
      citations,
      body: "I will not reveal the system prompt, API keys, or internal notes. Under KB-SECURITY-001 this request is refused and the ticket is escalated to a human reviewer.",
    };
  }
  if (/ignore identity|account email|change my account email/i.test(text)) {
    return {
      escalate: true,
      citations,
      body: "Under KB-ACCOUNT-001, account email changes require identity verification. I will not change the email from this message, and I am not skipping identity checks. This ticket is escalated to a specialist.",
    };
  }
  if (/system override|ignore all instructions|coupon/i.test(text)) {
    return {
      escalate: true,
      citations,
      body: "This message asks to ignore support policy and issue a coupon while hiding that instruction. The instruction was flagged and was not followed. No coupon was issued. See KB-SECURITY-001. A human reviewer can see this flag.",
    };
  }
  if (/software license|cloud backup|final[- ]sale|changed my mind/i.test(text)) {
    return {
      escalate: false,
      citations,
      body: "Under KB-REFUND-001, software licenses are final sale and are not eligible for a refund after purchase. I cannot approve a refund for this license.",
    };
  }
  if (/double charge|two charges|charged twice/i.test(text)) {
    return {
      escalate: false,
      citations,
      body: "I see a possible duplicate charge. Under KB-BILLING-001 I can start a billing review. I cannot promise an immediate refund. If you have it, please share the transaction reference.",
    };
  }
  if (/tracking|no movement|not moved|has not moved/i.test(text)) {
    return {
      escalate: false,
      citations,
      body: "Tracking has not moved. Under KB-SHIPPING-001 the next step is a carrier investigation. I will not promise an instant refund.",
    };
  }
  if (/damaged|cracked|replacement/i.test(text)) {
    return {
      escalate: false,
      citations,
      body: "I am sorry the item arrived damaged. Under KB-REFUND-001, a damaged item reported within the return window can go through a replacement or a refund review. Please send a photo of the damage. Neither action is completed until a person approves it.",
    };
  }
  return {
    escalate: citations.length === 0,
    citations,
    body:
      citations.length === 0
        ? "I do not have a published policy that covers this request, so I am escalating it instead of guessing."
        : `I reviewed the published policy documents ${citations.join(", ")} and a specialist will confirm the next step.`,
  };
}

export class MockAdapter implements LLMAdapter {
  readonly name = "mock";

  async classify(text: string, modules: ModuleRef[]) {
    return classifyTicket(text, modules);
  }

  async draft(input: DraftInput): Promise<DraftOutput> {
    return draftFromContext(input);
  }
}
