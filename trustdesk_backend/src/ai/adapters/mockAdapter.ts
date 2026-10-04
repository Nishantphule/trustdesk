import { classifyTicket, type ModuleRef } from "../pipeline/classify.js";
import type { DraftInput, DraftOutput, LLMAdapter } from "./types.js";

function cite(input: DraftInput): string[] {
  return input.policyChunks
    .map((c) => c.doc_id)
    .filter((id) => id && id !== "KB-ADVERSARIAL-001");
}

function factLine(input: DraftInput, kind: string): string | undefined {
  return input.lookup?.facts.find((fact) => fact.kind === kind)?.summary;
}

function firstName(input: DraftInput): string | null {
  const fromAccount = input.lookup?.facts.find((fact) => fact.kind === "account")?.summary.split(" · ")[0]?.trim();
  const first = fromAccount?.split(/\s+/)[0];
  return first && first.length > 1 ? first : null;
}

function say(input: DraftInput, clause: string): string {
  const name = firstName(input);
  const rest = clause.trim();
  if (!name) return rest.charAt(0).toUpperCase() + rest.slice(1);
  if (/^I\b/.test(rest)) return `Hi ${name}, ${rest}`;
  return `Hi ${name}, ${rest.charAt(0).toLowerCase()}${rest.slice(1)}`;
}

function orderBits(input: DraftInput): { ref: string; item: string; tracking: string | null } {
  const summary = factLine(input, "order") ?? "";
  const ref = summary.match(/ord_\d+/i)?.[0] ?? "";
  const parts = summary.split(" · ").map((part) => part.trim());
  const item = parts[1] && parts[1] !== "item" ? parts[1] : mentionedItem(input);
  const trackingPart = parts.find((part) => part.toLowerCase().startsWith("tracking "));
  const tracking = trackingPart?.replace(/^tracking\s+/i, "") ?? null;
  return { ref, item, tracking: tracking && tracking !== "n/a" ? tracking : null };
}

function mentionedItem(input: DraftInput): string {
  const text = `${input.subject}\n${input.body}`;
  const match = text.match(
    /BlueBuds Air|PulseBuds Mini|Phone Case Pro|phone case|BlueWatch|HomeCam Mini|cloud backup license|BlueTab 10|tablet|earbuds/i,
  );
  return match?.[0] ?? "your order";
}

function askOnly(input: DraftInput): string {
  const questions = input.lookup?.questions?.length ? input.lookup.questions.join(", ") : "the order id or last four";
  return `Could you send ${questions}? That's all I need — no password, OTP, or full card number.`;
}

export function draftFromContext(input: DraftInput): DraftOutput {
  const text = `${input.subject}\n${input.body}`;
  const citations = cite(input);
  const lookup = input.lookup;
  const order = orderBits(input);
  const orderRef = order.ref ? ` ${order.ref}` : "";

  if (lookup && !lookup.confident && lookup.questions.length > 0) {
    return {
      escalate: false,
      citations,
      body: say(input, `I want to help with this, but I don't have a matching order on the account yet. ${askOnly(input)}`),
    };
  }
  if (lookup?.already_refunded) {
    return {
      escalate: false,
      citations,
      body: say(
        input,
        `I checked${orderRef || " the order"} and a refund is already on it, so I'm not starting a second one. Reply if you need the original refund reference and a teammate will pull it.`,
      ),
    };
  }
  if (/can'?t log ?in|cannot log ?in|can'?t sign in|locked out|password reset/i.test(text)) {
    const failures = factLine(input, "auth_event");
    const extra = failures?.includes("failed") ? ` I can see ${failures.toLowerCase()}.` : "";
    return {
      escalate: false,
      citations,
      body: say(
        input,
        `Your account is on file and verified.${extra} I won't send a password over email. Use the reset path while signed in with the address we already have, and write back if that still fails.`,
      ),
    };
  }

  if (/swell|swollen battery/i.test(text)) {
    return {
      escalate: true,
      citations,
      body: say(
        input,
        `A swelling battery is a safety issue, so please stop using the ${mentionedItem(input)} and I'll hand this to a specialist today. I'm not going to walk you through any battery troubleshooting from this email.`,
      ),
    };
  }
  if (/system prompt|api key|internal notes|hidden prompt/i.test(text)) {
    return {
      escalate: true,
      citations,
      body: "I can't share internal prompts, keys, or notes. A reviewer will take this from here.",
    };
  }
  if (/ignore identity|account email|change my account email/i.test(text)) {
    return {
      escalate: true,
      citations,
      body: say(
        input,
        "I can't change the account email from this message, and I won't skip the usual identity checks. A specialist will pick this up on the email we already have on file.",
      ),
    };
  }
  if (/system override|ignore all instructions|coupon/i.test(text)) {
    return {
      escalate: true,
      citations,
      body: "That coupon request isn't something I can do, and I didn't create one. A reviewer has the flagged message.",
    };
  }
  if (/software license|cloud backup|final[- ]sale|changed my mind/i.test(text)) {
    return {
      escalate: false,
      citations,
      body: say(
        input,
        "The cloud backup license is a final-sale software item, so I can't refund it after purchase. If the license itself is broken, tell me what you're seeing and we'll look at that.",
      ),
    };
  }
  if (/double charge|two charges|charged twice/i.test(text)) {
    const txns = lookup?.facts.filter((fact) => fact.kind === "transaction") ?? [];
    const product = order.item;
    if (txns.length >= 2) {
      return {
        escalate: false,
        citations,
        body: say(
          input,
          `I see two captured payments on${orderRef || " this order"} (${product}). I'm sending this for a billing review so payments can check the duplicate. Any credit has to be approved by a teammate — I can't put money back from this email.`,
        ),
      };
    }
    if (order.ref) {
      return {
        escalate: false,
        citations,
        body: say(
          input,
          `I have${orderRef} (${product}) on your account. I'm starting a billing review for the extra charge you saw. A teammate has to approve any credit.`,
        ),
      };
    }
    return {
      escalate: false,
      citations,
      body: say(input, `I want to check the extra charge. ${askOnly(input)}`),
    };
  }
  if (/tracking|no movement|not moved|has not moved/i.test(text)) {
    const product = order.item;
    const track = order.tracking ? ` Tracking is ${order.tracking}.` : "";
    const travel = /travel|next week/i.test(text)
      ? " I know you need it before you travel next week, so I'm marking this as urgent."
      : "";
    return {
      escalate: false,
      citations,
      body: say(
        input,
        `I pulled up${orderRef || " your order"} — ${product} is still in transit.${track} Six business days with no movement is past our threshold.${travel} I'm asking a teammate to open a carrier investigation. I can't refund it from here while the parcel is still with the carrier; I'll write when we hear back.`,
      ),
    };
  }
  if (/damaged|cracked|replacement/i.test(text)) {
    const product = order.item;
    return {
      escalate: false,
      citations,
      body: say(
        input,
        order.ref
          ? `I'm sorry the ${product} arrived damaged. I have${orderRef} on file and the payment isn't refunded. If you can send a photo of the damage, I can put a replacement or refund review in front of a teammate — nothing ships or refunds until they approve it.`
          : `I'm sorry the ${product} arrived damaged. If you can send a photo of the damage, I can put a replacement or refund review in front of a teammate.`,
      ),
    };
  }
  return {
    escalate: citations.length === 0,
    citations,
    body: say(
      input,
      citations.length === 0
        ? "I don't have a published policy that covers this, so I'm passing it to a teammate instead of guessing."
        : "I read through what you wrote and I'm passing the next step to a teammate so we stay inside the published policy.",
    ),
  };
}

export class MockAdapter implements LLMAdapter {
  readonly name = "mock";

  async classify(text: string, modules: ModuleRef[]) {
    return classifyTicket(text, modules);
  }

  async draft(input: DraftInput): Promise<DraftOutput> {
    return { ...draftFromContext(input), usedLlm: false };
  }
}
