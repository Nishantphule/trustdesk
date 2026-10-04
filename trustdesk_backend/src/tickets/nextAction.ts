export type NextAction = "triage" | "review_draft" | "approve_tool" | "send" | "handle_escalation" | "done";
export type BoardColumn = "incoming" | "needs_review" | "escalated" | "done";

export function nextAction(input: { status: string; proposedTools?: number }): NextAction {
  const status = input.status;
  const proposed = input.proposedTools ?? 0;
  if (status === "new") return "triage";
  if (status === "escalated") return "handle_escalation";
  if (status === "sent" || status === "closed") return "done";
  if (status === "approved") return "send";
  if (status === "pending_approval") return "approve_tool";
  if ((status === "drafted" || status === "triaged") && proposed > 0) return "approve_tool";
  if (status === "drafted" || status === "triaged") return "review_draft";
  return "triage";
}

export function boardColumn(status: string): BoardColumn {
  if (status === "new") return "incoming";
  if (status === "escalated") return "escalated";
  if (status === "sent" || status === "closed") return "done";
  return "needs_review";
}

export function decorateTicket<T extends { status: string; proposed_tools?: number | string }>(row: T) {
  const proposed = Number(row.proposed_tools ?? 0);
  const action = nextAction({ status: row.status, proposedTools: proposed });
  return { ...row, next_action: action, board_column: boardColumn(row.status) };
}

export function groupBoard<T extends { board_column: BoardColumn }>(rows: T[]) {
  return {
    incoming: rows.filter((row) => row.board_column === "incoming"),
    needs_review: rows.filter((row) => row.board_column === "needs_review"),
    escalated: rows.filter((row) => row.board_column === "escalated"),
    done: rows.filter((row) => row.board_column === "done"),
  };
}
