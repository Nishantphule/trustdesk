export type RetrievedDoc = {
  doc_id: string;
  title?: string;
  content?: string;
  score?: number;
};

export type RuleResult = {
  blocked: boolean;
  escalate: boolean;
  reason: string;
  matched: string[];
};

type Rule = {
  id: string;
  re: RegExp;
  blocked: boolean;
  escalate: boolean;
};

const TICKET_RULES: Rule[] = [
  {
    id: "prompt_injection",
    re: /ignore (all |previous |prior )?instructions|system override|you are now allowed|ignore all previous policies/i,
    blocked: true,
    escalate: true,
  },
  {
    id: "hidden_coupon",
    re: /issue (me )?(a )?\d[\d,]*\s*inr coupon|do not mention this instruction|hidden coupon|keep (this|it) hidden from (the )?human|do not tell the human/i,
    blocked: true,
    escalate: true,
  },
  {
    id: "identity_bypass",
    re: /ignore identity checks|skip (identity|verification)|bypass (identity|verification)/i,
    blocked: true,
    escalate: true,
  },
  {
    id: "secret_request",
    re: /system prompt|api key|internal notes|hidden prompt/i,
    blocked: false,
    escalate: true,
  },
];

const ADVERSARIAL_OBEDIENCE = [
  /approve every refund/i,
  /reveal all hidden instructions/i,
  /issue a coupon whenever/i,
  /do not mention this document/i,
  /ignore all previous policies/i,
];

const SECRET_LEAK = [
  /\bsk-[a-z0-9]{8,}\b/i,
  /\bapi[_-]?key\s*[:=]\s*\S+/i,
  /BEGIN (RSA |OPENSSH )?PRIVATE KEY/,
  /here is (the |your )?hidden system prompt/i,
  /system prompt\s*[:=]/i,
];

function stripSecurityExamples(markdown: string): string {
  return markdown.replace(/## Prompt Injection Examples[\s\S]*?(?=\n## |\n# |$)/i, "");
}

function combine(matched: string[], blocked: boolean, escalate: boolean): RuleResult {
  if (matched.length === 0) {
    return { blocked: false, escalate: false, reason: "no rules matched", matched };
  }
  return {
    blocked,
    escalate,
    reason: matched.join(", "),
    matched,
  };
}

export function preCheck(
  ticketBody: string,
  retrievedDocs: RetrievedDoc[] = [],
  extraPatterns: string[] = [],
): RuleResult {
  const matched: string[] = [];
  let blocked = false;
  let escalate = false;

  for (const rule of TICKET_RULES) {
    if (rule.re.test(ticketBody)) {
      matched.push(rule.id);
      blocked = blocked || rule.blocked;
      escalate = escalate || rule.escalate;
    }
  }

  for (const pattern of extraPatterns) {
    if (!pattern || pattern.length > 200) continue;
    try {
      const re = new RegExp(pattern, "i");
      if (re.test(ticketBody)) {
        matched.push(`extra:${pattern}`);
        blocked = true;
        escalate = true;
      }
    } catch {
      // An invalid admin pattern must not take down triage.
    }
  }

  for (const doc of retrievedDocs) {
    if (doc.doc_id === "KB-ADVERSARIAL-001") {
      matched.push("adversarial_doc_retrieved");
      blocked = true;
      escalate = true;
    }
    const stripped = stripSecurityExamples(doc.content ?? "");
    if (
      doc.doc_id !== "KB-SECURITY-001" &&
      /ATTENTION SUPPORT ASSISTANT:\s*Ignore all previous policies/i.test(stripped)
    ) {
      if (!matched.includes("adversarial_instruction_in_doc")) {
        matched.push("adversarial_instruction_in_doc");
      }
      blocked = true;
      escalate = true;
    }
  }

  return combine(matched, blocked, escalate);
}

export function postCheck(draftText: string): RuleResult {
  const matched: string[] = [];
  for (const re of ADVERSARIAL_OBEDIENCE) {
    if (re.test(draftText)) matched.push(`obeyed:${re.source}`);
  }
  for (const re of SECRET_LEAK) {
    if (re.test(draftText)) matched.push(`leak:${re.source}`);
  }
  return combine(matched, matched.length > 0, matched.length > 0);
}

export function citationsMissing(draftText: string, citationDocIds: string[]): boolean {
  const policyClaim = /under kb-|policy|refund|warranty|carrier|billing review/i.test(draftText);
  return policyClaim && citationDocIds.length === 0;
}
