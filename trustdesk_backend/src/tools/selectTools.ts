import type { RuleResult } from "../ai/rule-layer/ruleLayer.js";
import { isReturnWindowOpen } from "./policyWindow.js";

export type OrderSnapshot = {
  id: string;
  status: string;
  total: number;
  tracking_number: string | null;
  eligible_return_until: string | null;
  delivered_at: string | null;
  items: { sku: string; name?: string; final_sale?: boolean; category?: string }[];
};

export type ToolProposal = {
  toolKey: string;
  reason: string;
  payload: Record<string, unknown>;
};

export function selectTools(input: {
  text: string;
  moduleSlug: string | null;
  enabledTools: string[];
  ticketId: string;
  ticketCreatedAt: string;
  order: OrderSnapshot | null;
  pre: RuleResult;
  shouldEscalate: boolean;
}): ToolProposal[] {
  const enabled = new Set(input.enabledTools);
  const proposals: ToolProposal[] = [];
  const text = input.text;
  const order = input.order;

  const allow = (key: string) => enabled.has(key);

  const pushEscalate = (reason: string) => {
    if (!allow("escalate_to_human")) return;
    proposals.push({
      toolKey: "escalate_to_human",
      reason,
      payload: {
        ticket_id: input.ticketId,
        reason,
        queue: input.moduleSlug ?? "general",
      },
    });
  };

  if (input.pre.blocked || input.pre.matched.includes("prompt_injection") || input.pre.matched.includes("hidden_coupon")) {
    const reason = input.pre.matched.includes("confidence_gate")
      ? "Retrieval score was below the confidence threshold, so no operational action was proposed."
      : "Unsafe instruction blocked. No coupon or account change will be made.";
    pushEscalate(reason);
    return proposals;
  }

  if (input.pre.matched.includes("secret_request") || input.pre.matched.includes("identity_bypass")) {
    pushEscalate("Sensitive request requires a human. No account lock or email change will be made.");
    return proposals;
  }

  if (/swell|swollen battery|overheat|burning smell/i.test(text)) {
    pushEscalate("Safety issue. Do not troubleshoot or replace automatically.");
    return proposals;
  }

  if (input.moduleSlug === "shipping" && order && allow("open_carrier_investigation")) {
    proposals.push({
      toolKey: "open_carrier_investigation",
      reason: "Tracking is stale. Policy allows a carrier investigation and not an instant replacement.",
      payload: {
        order_id: order.id,
        tracking_number: order.tracking_number,
        reason: "No tracking movement reported by the customer",
      },
    });
  }

  if (input.moduleSlug === "billing" && order && allow("start_refund_review")) {
    proposals.push({
      toolKey: "start_refund_review",
      reason: "Duplicate charge with a single order. Start a billing review without promising an immediate refund.",
      payload: {
        order_id: order.id,
        reason: "Possible duplicate charge",
        amount: order.total,
      },
    });
  }

  if (input.moduleSlug === "refund" && order) {
    const finalSale =
      order.items.some((item) => item.final_sale || item.category === "software") ||
      /software license|final[- ]sale/i.test(text);
    const damaged = /damaged|cracked|defective/i.test(text);
    const windowOpen = isReturnWindowOpen(input.ticketCreatedAt, order.eligible_return_until);
    if (!finalSale && damaged && windowOpen) {
      const sku = order.items[0]?.sku ?? "";
      if (allow("create_replacement_order")) {
        proposals.push({
          toolKey: "create_replacement_order",
          reason: "Damaged physical item reported inside the return window measured from the ticket timestamp.",
          payload: {
            order_id: order.id,
            sku,
            reason: "Damaged on arrival",
          },
        });
      }
      if (allow("start_refund_review")) {
        proposals.push({
          toolKey: "start_refund_review",
          reason: "Refund policy also allows a human refund review for damaged items inside the window.",
          payload: {
            order_id: order.id,
            reason: "Damaged on arrival",
            amount: order.total,
          },
        });
      }
    }
  }

  if (input.shouldEscalate) pushEscalate("Triage marked this ticket for a human.");

  const seen = new Set<string>();
  return proposals.filter((p) => {
    if (seen.has(p.toolKey)) return false;
    seen.add(p.toolKey);
    return true;
  });
}
