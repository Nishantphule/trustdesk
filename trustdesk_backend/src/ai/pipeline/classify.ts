export type ModuleRef = {
  id?: string;
  slug: string;
  name: string;
  description?: string;
  keywords: string[];
  status?: string;
};

export type Classified = {
  moduleSlug: string | null;
  intent: string;
  priority: "low" | "medium" | "high" | "urgent";
  sentiment: string;
  confidence: number;
  moduleScores: { slug: string; score: number }[];
  collision: boolean;
  shouldEscalate: boolean;
  reason: string;
};

const COLLISION_DELTA = 0.1;

function keywordScore(text: string, keywords: string[]): number {
  const hay = text.toLowerCase();
  const hits = keywords.filter((k) => k && hay.includes(k.toLowerCase())).length;
  if (hits === 0) return 0;
  return Math.min(1, 0.62 + (hits - 1) * 0.12);
}

export function triageMeta(text: string): Pick<Classified, "intent" | "priority" | "sentiment" | "shouldEscalate" | "reason"> {
  if (/swell|swollen battery|overheat|burning smell|electric shock/i.test(text)) {
    return {
      intent: "safety_hazard",
      priority: "urgent",
      sentiment: "worried",
      shouldEscalate: true,
      reason: "Safety language (battery swelling or similar) requires a human specialist.",
    };
  }
  if (/ignore identity checks|skip identity|skip verification/i.test(text)) {
    return {
      intent: "account_change_bypass",
      priority: "high",
      sentiment: "neutral",
      shouldEscalate: true,
      reason: "Account change asks to skip identity verification.",
    };
  }
  if (/system prompt|api key|internal notes|hidden prompt/i.test(text)) {
    return {
      intent: "secret_exfiltration",
      priority: "high",
      sentiment: "neutral",
      shouldEscalate: true,
      reason: "Request asks for hidden prompts, keys, or internal notes.",
    };
  }
  if (/system override|ignore all instructions|ignore previous instructions/i.test(text)) {
    return {
      intent: "prompt_injection",
      priority: "medium",
      sentiment: "neutral",
      shouldEscalate: true,
      reason: "Message tries to override support policy.",
    };
  }
  if (/can'?t log ?in|cannot log ?in|can'?t sign in|locked out|password reset/i.test(text)) {
    return {
      intent: "login_issue",
      priority: "high",
      sentiment: "frustrated",
      shouldEscalate: false,
      reason: "Login issue. Verification path only. Do not collect a password or change the account email.",
    };
  }
  if (/double charge|two charges|charged twice/i.test(text)) {
    return {
      intent: "duplicate_charge",
      priority: "high",
      sentiment: "frustrated",
      shouldEscalate: false,
      reason: "Duplicate charge report. Billing review, no immediate refund promise.",
    };
  }
  if (/no movement|not moved|has not moved|business days/i.test(text)) {
    return {
      intent: "stale_tracking",
      priority: "high",
      sentiment: "frustrated",
      shouldEscalate: false,
      reason: "Tracking has stalled. Carrier investigation is the next step.",
    };
  }
  if (/software license|cloud backup license|final[- ]sale|changed my mind/i.test(text)) {
    return {
      intent: "final_sale_refund",
      priority: "low",
      sentiment: "neutral",
      shouldEscalate: false,
      reason: "Refund requested for a final-sale or software license.",
    };
  }
  if (/damaged|cracked|defective|replacement/i.test(text)) {
    return {
      intent: "damaged_item",
      priority: "medium",
      sentiment: "frustrated",
      shouldEscalate: false,
      reason: "Damaged physical item. Replacement or refund review if the return window is open.",
    };
  }
  return {
    intent: "general_question",
    priority: "medium",
    sentiment: "neutral",
    shouldEscalate: false,
    reason: "No stronger module-specific signal.",
  };
}

export function classifyTicket(text: string, modules: ModuleRef[]): Classified {
  const active = modules.filter((m) => m.status !== "archived");
  const moduleScores = active
    .map((m) => ({ slug: m.slug, score: keywordScore(text, m.keywords ?? []) }))
    .sort((a, b) => b.score - a.score);

  const meta = triageMeta(text);
  const top = moduleScores[0];
  const second = moduleScores[1];
  const collision = Boolean(
    top && second && top.score > 0 && second.score > 0 && top.score - second.score < COLLISION_DELTA,
  );

  if (collision) {
    return {
      moduleSlug: null,
      ...meta,
      confidence: top?.score ?? 0,
      moduleScores,
      collision: true,
      shouldEscalate: true,
      reason: `Module collision between ${top?.slug} and ${second?.slug} (delta < ${COLLISION_DELTA}). A human must pick the module.`,
    };
  }

  if (!top || top.score === 0) {
    const general = active.find((m) => m.slug === "general");
    return {
      moduleSlug: general?.slug ?? null,
      ...meta,
      confidence: general ? 0.2 : 0,
      moduleScores,
      collision: false,
      reason: general
        ? `${meta.reason} No keyword hit; fallback module is general so retrieval can still be scored.`
        : "No module keywords matched.",
    };
  }

  return {
    moduleSlug: top.slug,
    ...meta,
    confidence: top.score,
    moduleScores,
    collision: false,
  };
}

export function applyMailboxPrior(
  classification: Classified,
  mailboxModuleSlug: string | null,
): { classification: Classified; mailboxDefaultDisagreed: boolean } {
  if (!mailboxModuleSlug || classification.moduleSlug === mailboxModuleSlug) {
    return { classification, mailboxDefaultDisagreed: false };
  }
  if (!classification.collision && classification.confidence <= 0.2) {
    return {
      mailboxDefaultDisagreed: false,
      classification: {
        ...classification,
        moduleSlug: mailboxModuleSlug,
        reason: `${classification.reason} Mailbox default module ${mailboxModuleSlug} applied because classification confidence is ${classification.confidence}.`,
      },
    };
  }
  return {
    mailboxDefaultDisagreed: true,
    classification: {
      ...classification,
      reason: `${classification.reason} mailbox_default_disagreed (${mailboxModuleSlug}).`,
    },
  };
}
