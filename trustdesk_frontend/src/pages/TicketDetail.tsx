import { motion } from "framer-motion";
import { Bot, Lock, ShieldAlert, UserRound } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";
import { api, currentUser } from "@/api";
import { Badge, Mono } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/field";
import { InfoPopover } from "@/components/ui/overlays";
import { Card, PageHeader } from "@/components/ui/layout";
import { EmptyState, ErrorNote } from "@/components/ui/states";

type NextAction = "triage" | "review_draft" | "approve_tool" | "send" | "handle_escalation" | "done";

type Draft = {
  id: string;
  body: string;
  citation_doc_ids: string[];
  retrieval_score: number | null;
  confidence_gate_result: string;
  status: string;
  llm_called: boolean;
};

type ToolAction = {
  id: string;
  tool_key: string;
  status: string;
  idempotency_key: string;
  snapshot_hash: string;
  risk_level: string;
  required_role: string;
  result_json: { reason?: string } | null;
};

type Trace = {
  id: string;
  llm_called: boolean;
  confidence_gate_result: string;
  rule_layer_result: string;
  retrieved_doc_ids: string[];
  retrieval_scores: number[];
  recommended_actions: string[];
  final_status: string;
  input_json: {
    gate?: { reason?: string };
    pre?: { reason?: string; matched?: string[] };
    snippets?: { doc_id: string; title: string; snippet: string; score: number }[];
  };
};

type Decision = {
  module: string | null;
  priority: string | null;
  gate: { result: string | null; reason: string | null };
  rules: { result: string | null; matched: string[] };
  retrieved: { doc_id: string; score: number | null }[];
  llm_called: boolean;
  citations: string[];
  recommended_actions: string[];
  next_action: NextAction;
};

type Lookup = {
  account: { id: string; name: string; email: string; tier: string | null; verified: boolean | null } | null;
  records: { id: string; record_type: string; record_ref: string; payload_json: Record<string, unknown> }[];
  facts: { kind: string; ref: string; summary: string }[];
  missing: string[];
  questions: string[];
  confident: boolean;
  already_refunded: boolean;
};

type TicketDetail = {
  id: string;
  subject: string;
  body_raw: string;
  status: string;
  priority: string | null;
  sentiment: string | null;
  intent: string | null;
  module_slug: string | null;
  escalation_reason: string | null;
  escalation_address?: string | null;
  next_action: NextAction;
  decision: Decision | null;
  lookup: Lookup | null;
  records: Lookup["records"];
  account: { id: string; name: string; email: string; metadata_json: { tier?: string; verified?: boolean } } | null;
  related_record: { id: string; record_ref: string; payload_json: { status?: string; total?: number; refund_status?: string; items?: { name?: string; sku?: string }[] } } | null;
  messages: { id: string; direction: string; author_type: string; body: string; created_at: string }[];
  drafts: Draft[];
  tool_actions: ToolAction[];
  traces: Trace[];
};

const primaryLabel: Record<NextAction, string> = {
  triage: "Run triage",
  review_draft: "Approve draft",
  approve_tool: "Approve action",
  send: "Send reply",
  handle_escalation: "Read why it stopped",
  done: "Closed",
};

const busyLabel: Partial<Record<NextAction, string>> = {
  triage: "Running triage…",
  review_draft: "Approving…",
  approve_tool: "Approving…",
  send: "Sending…",
};

export function TicketPage() {
  const { id = "" } = useParams();
  const [ticket, setTicket] = useState<TicketDetail | null>(null);
  const [draftText, setDraftText] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [busyAction, setBusyAction] = useState("");
  const [closedLoop, setClosedLoop] = useState(false);
  const user = currentUser();
  const visibleId = useRef(id);
  visibleId.current = id;

  async function load() {
    const ticketId = id;
    const data = await api<TicketDetail>(`/tickets/${ticketId}`);
    if (visibleId.current !== ticketId) return;
    setTicket(data);
    setDraftText(data.drafts[0]?.body ?? "");
  }

  useEffect(() => {
    setError("");
    setClosedLoop(false);
    void load().catch((err) => {
      if (visibleId.current === id) setError(err instanceof Error ? err.message : "The ticket did not load. Return to the queue and open it again.");
    });
  }, [id]);

  async function act(path: string, note: string, label?: string, body?: unknown, method = "POST") {
    setBusy(true);
    setBusyAction(label ?? note);
    setError("");
    try {
      await api(path, { method, body });
      toast(note);
      if (path.endsWith("/send") || path.endsWith("/execute")) setClosedLoop(true);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The action did not complete.");
      await load().catch(() => undefined);
    } finally {
      setBusy(false);
      setBusyAction("");
    }
  }

  if (!ticket || ticket.id !== id) return <p className="text-sm text-muted">{error || "Loading ticket."}</p>;
  const draft = ticket.drafts[0];
  const trace = ticket.traces[0];
  const next = ticket.next_action;
  const escalated = ticket.status === "escalated" || next === "handle_escalation";
  const proposed = ticket.tool_actions.find((action) => action.status === "proposed");

  function runPrimary() {
    if (next === "triage") return act(`/tickets/${id}/triage`, "Triage finished", "Running triage…");
    if (next === "review_draft") return act(`/tickets/${id}/draft/approve`, "Draft approved", "Approving…");
    if (next === "approve_tool" && proposed) return act(`/tool-actions/${proposed.id}/approve`, `${proposed.tool_key.replaceAll("_", " ")} approved`, "Approving…");
    if (next === "send") return act(`/tickets/${id}/send`, "Reply sent", "Sending…");
    return Promise.resolve();
  }

  const headerPrimary = busy && busyLabel[next] ? busyLabel[next] : primaryLabel[next] ?? next;

  return (
    <div className="grid gap-4">
      <PageHeader
        title={ticket.subject}
        detail={`${ticket.id} · ${ticket.status}${ticket.module_slug ? ` · ${ticket.module_slug}` : ""}`}
        action={
          <div className="flex flex-wrap gap-2">
            {(next === "done") ? (
              <Button asChild><Link to="/queue">Closed</Link></Button>
            ) : next === "handle_escalation" ? (
              <Button disabled>Read why it stopped</Button>
            ) : (
              <Button disabled={busy || (next === "approve_tool" && !proposed)} onClick={() => void runPrimary()}>{headerPrimary}</Button>
            )}
            {(closedLoop || next === "done" || escalated) && next !== "handle_escalation" && next !== "done" && (
              <Button variant="secondary" asChild><Link to="/queue">Back to queue</Link></Button>
            )}
          </div>
        }
      />
      <div className="flex flex-wrap gap-2">
        <Mono>{ticket.id}</Mono>
        <Badge tone={ticket.status === "escalated" ? "danger" : "neutral"}>{ticket.status}</Badge>
        {ticket.module_slug && <Badge>{ticket.module_slug}</Badge>}
        {ticket.priority && <Badge tone={ticket.priority}>{ticket.priority}</Badge>}
        <Badge>{primaryLabel[next] ?? next}</Badge>
      </div>
      <ErrorNote message={error} />
      {escalated && (
        <motion.div className="rounded-card border-2 border-danger bg-danger-bg p-4 text-sm text-danger" initial={false} role="status">
          <p className="flex items-center gap-2 text-base font-semibold"><ShieldAlert size={18} aria-hidden /> Escalated</p>
          <p className="mt-1">{ticket.escalation_reason || ticket.decision?.gate.reason || trace?.input_json?.gate?.reason || "A safety check stopped an automatic draft."}</p>
          {ticket.escalation_address && <p className="mt-1">Routed to {ticket.escalation_address}.</p>}
          {ticket.decision && !ticket.decision.llm_called && <p className="mt-1">Drafting model was not called.</p>}
        </motion.div>
      )}
      <div className="grid min-w-0 gap-4 lg:grid-cols-[1.2fr_1fr_1fr]">
        <Lane title="INPUT">
          <Thread ticket={ticket} />
          <CustomerRecord ticket={ticket} userRole={user?.role} busy={busy} act={act} />
        </Lane>
        <Lane title="PROCESS">
          <DecisionStrip ticket={ticket} trace={trace} />
        </Lane>
        <Lane title="OUTPUT">
          <DraftPanel ticket={ticket} draft={draft} trace={trace} draftText={draftText} setDraftText={setDraftText} busy={busy} busyAction={busyAction} next={next} act={act} />
          <Actions ticket={ticket} busy={busy} busyAction={busyAction} act={act} />
        </Lane>
      </div>
      {(closedLoop || next === "done" || escalated) && (
        <div className="flex justify-end"><Button variant="secondary" asChild><Link to="/queue">Back to queue</Link></Button></div>
      )}
    </div>
  );
}

function Lane({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid min-w-0 content-start gap-3">
      <h2 className="text-[10px] font-medium uppercase tracking-wider text-muted">{title}</h2>
      {children}
    </section>
  );
}

function Thread({ ticket }: { ticket: TicketDetail }) {
  return (
    <Card className="grid gap-3">
      <h3 className="text-base font-semibold">Customer email</h3>
      {ticket.messages.length === 0 && <Message direction="inbound" author="customer" body={ticket.body_raw} />}
      {ticket.messages.map((message) => <Message key={message.id} direction={message.direction} author={message.author_type} body={message.body} />)}
    </Card>
  );
}

function Message({ direction, author, body }: { direction: string; author: string; body: string }) {
  const internal = direction === "internal";
  const outbound = direction === "outbound";
  const Icon = author === "ai" ? Bot : internal ? Lock : UserRound;
  return (
    <article className={`rounded-card border p-3 text-sm ${internal ? "border-caution bg-caution-bg" : outbound ? "border-line bg-raised" : "border-line bg-surface"}`}>
      <p className="mb-1 flex items-center gap-2 text-xs text-muted"><Icon size={14} aria-hidden /> {direction} · {author}</p>
      <p className="whitespace-pre-wrap">{body}</p>
    </article>
  );
}

function CustomerRecord({ ticket, userRole, busy, act }: { ticket: TicketDetail; userRole?: string; busy: boolean; act: (path: string, note: string, label?: string, body?: unknown, method?: string) => Promise<void> }) {
  const lookup = ticket.lookup;
  const account = lookup?.account ?? (ticket.account ? { id: ticket.account.id, name: ticket.account.name, email: ticket.account.email, tier: ticket.account.metadata_json?.tier ?? null, verified: ticket.account.metadata_json?.verified ?? null } : null);
  const records = ticket.records ?? [];
  const orders = records.filter((row) => row.record_type === "order");
  const txns = records.filter((row) => row.record_type === "transaction");
  const logins = records.filter((row) => row.record_type === "auth_event");
  if (!account && records.length === 0) {
    return <Card><h3 className="text-base font-semibold">Customer record</h3><p className="mt-2 text-sm text-muted">No account for this email — ask only for an order id or last four.</p></Card>;
  }
  return (
    <Card className="grid gap-3">
      <h3 className="text-base font-semibold">Customer record</h3>
      {account ? (
        <div className="grid gap-1 text-sm">
          <strong>{account.name}</strong>
          <span className="text-muted">{account.email}</span>
          <span>Tier {account.tier ?? "unknown"} · {account.verified ? "verified" : "not verified"}</span>
        </div>
      ) : <p className="text-sm text-muted">No account for this email — ask only for an order id or last four.</p>}
      {orders.map((order) => (
        <div key={order.id} className="grid gap-1 border-t border-line pt-2 text-sm">
          <Mono>{order.record_ref}</Mono>
          <span>Status {String(order.payload_json.status ?? "unknown")} · payment {String(order.payload_json.payment_status ?? "n/a")} · refund {String(order.payload_json.refund_status ?? "none")}</span>
          {(userRole === "supervisor" || userRole === "admin") && ticket.related_record?.id === order.id && (
            <Button variant="secondary" disabled={busy} onClick={() => void act(`/related-records/${order.id}`, "Order status updated", "Updating…", { status: "status_changed_after_recommendation" }, "PATCH")}>Change order status</Button>
          )}
        </div>
      ))}
      {txns.map((txn) => (
        <p key={txn.id} className="text-sm"><Mono>{txn.record_ref}</Mono> {String(txn.payload_json.status)} {String(txn.payload_json.amount ?? "")} last four {String(txn.payload_json.last_four ?? "n/a")}</p>
      ))}
      {logins.map((event) => (
        <p key={event.id} className="text-sm">{String(event.payload_json.event_type)} · {String(event.payload_json.at ?? "")}</p>
      ))}
    </Card>
  );
}

function DecisionStrip({ ticket, trace }: { ticket: TicketDetail; trace: Trace | undefined }) {
  const decision = ticket.decision;
  if (!decision && !trace) {
    return <Card><p className="text-sm text-muted">No run yet. Triage to fill gate, rules, and citations.</p></Card>;
  }
  const gate = decision?.gate.result ?? trace?.confidence_gate_result;
  const rules = decision?.rules.result ?? trace?.rule_layer_result;
  const llm = decision?.llm_called ?? trace?.llm_called;
  const recommended = decision?.recommended_actions?.length ? decision.recommended_actions : (trace?.recommended_actions ?? []);
  const retrieved = decision?.retrieved?.length
    ? decision.retrieved
    : (trace?.retrieved_doc_ids ?? []).map((docId, index) => ({ doc_id: docId, score: trace?.retrieval_scores?.[index] ?? null }));
  return (
    <Card className="grid gap-3">
      <h3 className="text-base font-semibold">Decision</h3>
      <p className="text-sm">{decision?.module ?? ticket.module_slug ?? "unclassified"} · {decision?.priority ?? ticket.priority ?? "no priority"}</p>
      <div className="flex flex-wrap gap-2">
        <Badge tone={gate === "pass" ? "safe" : "danger"}>gate {gate ?? "n/a"}</Badge>
        <Badge tone={rules === "blocked" ? "danger" : "neutral"}>rules {rules ?? "n/a"}</Badge>
        <Badge tone={llm ? "safe" : "neutral"}>{llm ? "model called" : "model not called"}</Badge>
      </div>
      {decision?.gate.reason && <p className="text-sm text-muted">{decision.gate.reason}</p>}
      {(decision?.rules.matched?.length ?? 0) > 0 && <p className="font-mono text-xs text-muted">{decision!.rules.matched.join(", ")}</p>}
      {recommended.length > 0 && <p className="text-sm">Recommended: {recommended.join(", ")}</p>}
      {ticket.lookup && (
        <div className="grid gap-1 border-t border-line pt-2 text-sm">
          <Badge tone={ticket.lookup.confident ? "safe" : "neutral"}>
            {ticket.lookup.confident ? "lookup confident" : ticket.lookup.questions.length > 0 ? "need info" : "account on file"}
          </Badge>
          {ticket.lookup.already_refunded && <p>Refund already processed on the order.</p>}
          {ticket.lookup.facts.map((fact) => <p key={`${fact.kind}-${fact.ref}`}>{fact.summary}</p>)}
          {ticket.lookup.questions.length > 0 && <p>Ask only: {ticket.lookup.questions.join(", ")}</p>}
        </div>
      )}
      <div className="grid gap-1">
        {retrieved.map((item) => {
          const snippet = trace?.input_json?.snippets?.find((row) => row.doc_id === item.doc_id);
          return (
            <InfoPopover key={item.doc_id} trigger={<button type="button" className="min-h-11 rounded-card border border-line px-3 text-left font-mono text-xs">{item.doc_id} · {item.score != null ? Number(item.score).toFixed(3) : "n/a"}</button>}>
              <p className="font-medium">{snippet?.title ?? item.doc_id}</p>
              <p className="mt-2">{snippet?.snippet ?? "No snippet stored."}</p>
            </InfoPopover>
          );
        })}
        {retrieved.length === 0 && <p className="text-sm text-muted">No retrieved docs.</p>}
      </div>
    </Card>
  );
}

function DraftPanel({ ticket, draft, trace, draftText, setDraftText, busy, busyAction, next, act }: {
  ticket: TicketDetail;
  draft: Draft | undefined;
  trace: Trace | undefined;
  draftText: string;
  setDraftText: (value: string) => void;
  busy: boolean;
  busyAction: string;
  next: NextAction;
  act: (path: string, note: string, label?: string, body?: unknown, method?: string) => Promise<void>;
}) {
  const citations = Array.isArray(draft?.citation_doc_ids) ? draft.citation_doc_ids : [];
  const llmCalled = ticket.decision?.llm_called ?? draft?.llm_called ?? false;
  if (ticket.status === "escalated") {
    return (
      <Card className="grid gap-2">
        <h3 className="text-base font-semibold">Reply</h3>
        <p className="text-sm text-muted">
          {llmCalled
            ? "This ticket is escalated. A human must handle it; do not approve or send from here."
            : "No customer reply. The drafting model was not called."}
        </p>
      </Card>
    );
  }
  return (
    <Card className="grid gap-3">
      <h3 className="text-base font-semibold">Reply</h3>
      {!draft && <EmptyState title="No draft yet" detail="Run triage to retrieve policy and draft." />}
      {draft && (
        <>
          <div className="flex flex-wrap gap-2">
            {citations.map((docId) => {
              const snippet = trace?.input_json?.snippets?.find((item) => item.doc_id === docId);
              const fromDecision = ticket.decision?.retrieved?.find((row) => row.doc_id === docId)?.score;
              const traceIndex = trace?.retrieved_doc_ids?.indexOf(docId) ?? -1;
              const fromTrace = traceIndex >= 0 ? trace?.retrieval_scores?.[traceIndex] ?? null : null;
              const score = snippet?.score ?? fromDecision ?? fromTrace ?? draft.retrieval_score;
              return (
                <InfoPopover key={docId} trigger={<button type="button" className="min-h-11 rounded-full border border-line px-3 font-mono text-xs">{docId} · {score != null ? Number(score).toFixed(3) : "n/a"}</button>}>
                  <p className="font-medium">{snippet?.title ?? docId}</p>
                  <p className="mt-2">{snippet?.snippet ?? "No snippet stored."}</p>
                </InfoPopover>
              );
            })}
            <Badge>{draft.status}</Badge>
          </div>
          <Textarea value={draftText} onChange={(e) => setDraftText(e.target.value)} aria-label="Draft reply" disabled={ticket.status === "closed" || ticket.status === "sent" || draft.status === "sent"} />
          {ticket.status !== "closed" && ticket.status !== "sent" && draft.status !== "sent" && (
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" disabled={busy} onClick={() => void act(`/tickets/${ticket.id}/draft`, "Draft edit saved", "Saving…", { body: draftText, draft_id: draft.id }, "PATCH")}>Save edit</Button>
            {next !== "review_draft" && (
              <Button variant="secondary" disabled={busy || draft.status === "approved"} onClick={() => void act(`/tickets/${ticket.id}/draft/approve`, "Draft approved", "Approving…")}>{draft.status === "approved" ? "Approved" : "Approve draft"}</Button>
            )}
            <Button variant="secondary" disabled={busy || draft.status === "rejected"} onClick={() => void act(`/tickets/${ticket.id}/draft/reject`, "Draft rejected", "Rejecting…")}>{draft.status === "rejected" ? "Rejected" : "Reject"}</Button>
            {next !== "send" && (
              <Button variant="secondary" disabled={busy || draft.status !== "approved"} onClick={() => void act(`/tickets/${ticket.id}/send`, "Reply sent", "Sending…")}>{draft.status === "sent" ? "Sent" : busyAction === "Sending…" ? "Sending…" : "Send reply"}</Button>
            )}
          </div>
          )}
        </>
      )}
    </Card>
  );
}

function Actions({ ticket, busy, busyAction, act }: { ticket: TicketDetail; busy: boolean; busyAction: string; act: (path: string, note: string, label?: string) => Promise<void> }) {
  return (
    <Card className="grid gap-3">
      <h3 className="text-base font-semibold">Tools</h3>
      {ticket.tool_actions.length === 0 && <p className="text-sm text-muted">No actions proposed.</p>}
      {ticket.tool_actions.map((action) => (
        <article key={action.id} className="grid gap-2 border-t border-line pt-3">
          <strong>{action.tool_key}</strong>
          <div className="flex flex-wrap gap-2">
            <Badge tone={action.risk_level === "high" ? "urgent" : action.risk_level}>{action.risk_level}</Badge>
            <Badge tone={action.status === "stale_blocked" ? "stale" : action.status === "executed" ? "safe" : "neutral"}>{action.status}</Badge>
          </div>
          <p><Mono>idempotency {action.idempotency_key}</Mono></p>
          {action.status === "stale_blocked" && (
            <p className="rounded-card border border-stale bg-stale-bg p-3 text-sm text-stale">Stale approval. The order or policy changed after this action was proposed.</p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy || !["proposed", "pending_approval"].includes(action.status)} onClick={() => void act(`/tool-actions/${action.id}/approve`, `${action.tool_key.replaceAll("_", " ")} approved`, "Approving…")}>{action.status === "approved" || action.status === "executed" ? "Approved" : busyAction === "Approving…" ? "Approving…" : "Approve"}</Button>
            <Button variant="secondary" disabled={busy || !["proposed", "pending_approval"].includes(action.status)} onClick={() => void act(`/tool-actions/${action.id}/reject`, "Action rejected", "Rejecting…")}>{action.status === "rejected" ? "Rejected" : "Reject"}</Button>
            <Button disabled={busy || action.status !== "approved"} onClick={() => void act(`/tool-actions/${action.id}/execute`, `${action.tool_key} executed`, "Executing…")}>{action.status === "executed" ? "Executed" : busyAction === "Executing…" ? "Executing…" : "Execute"}</Button>
          </div>
          <p className="text-xs text-muted">Execute is simulated. It records a result.</p>
        </article>
      ))}
    </Card>
  );
}
