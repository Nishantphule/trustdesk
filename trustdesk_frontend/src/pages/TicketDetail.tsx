import { motion, useReducedMotion } from "framer-motion";
import { Bot, Lock, ShieldAlert, UserRound } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { toast } from "sonner";
import { api, currentUser } from "@/api";
import { Badge, Mono } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/field";
import { InfoPopover, Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/overlays";
import { EmptyState, ErrorNote } from "@/components/ui/states";

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
    mailbox_default_disagreed?: boolean;
  };
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
  module_collision: boolean;
  account: { id: string; name: string; email: string; metadata_json: { tier?: string } } | null;
  related_record: { id: string; record_ref: string; payload_json: { status?: string; total?: number; items?: { name?: string; sku?: string }[] } } | null;
  messages: { id: string; direction: string; author_type: string; body: string; created_at: string }[];
  drafts: Draft[];
  tool_actions: ToolAction[];
  traces: Trace[];
};

export function TicketPage() {
  const { id = "" } = useParams();
  const [ticket, setTicket] = useState<TicketDetail | null>(null);
  const [draftText, setDraftText] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [reveal, setReveal] = useState(0);
  const user = currentUser();
  const reduced = useReducedMotion();
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
    setReveal(0);
    setError("");
    void load().catch((err) => {
      if (visibleId.current === id) setError(err instanceof Error ? err.message : "The ticket did not load. Return to the queue and open it again.");
    });
  }, [id]);

  async function act(path: string, note: string, body?: unknown) {
    setBusy(true);
    setError("");
    try {
      await api(path, { method: "POST", body });
      toast(note);
      if (path.endsWith("/triage")) setReveal((value) => value + 1);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The action did not complete. Try it again.");
      await load().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }

  if (!ticket || ticket.id !== id) return <p className="text-sm text-muted">{error || "Loading ticket."}</p>;
  const draft = ticket.drafts[0];
  const trace = ticket.traces[0];
  const escalated = ticket.status === "escalated" || draft?.confidence_gate_result === "escalated" || trace?.confidence_gate_result === "escalated";
  const motionProps = reduced || reveal === 0 ? {} : { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { duration: 0.25, ease: "easeOut" as const } };

  const thread = <Thread ticket={ticket} />;
  const context = <Context ticket={ticket} userRole={user?.role} busy={busy} reload={load} setError={setError} />;
  const draftPanel = <DraftPanel ticket={ticket} draft={draft} trace={trace} draftText={draftText} setDraftText={setDraftText} busy={busy} act={act} reload={load} reveal={reveal} setError={setError} />;
  const actions = <Actions ticket={ticket} trace={trace} busy={busy} act={act} />;

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{ticket.subject}</h1>
          <div className="mt-2 flex flex-wrap gap-2">
            <Mono>{ticket.id}</Mono>
            <Badge tone={ticket.status === "escalated" ? "danger" : "neutral"}>{ticket.status}</Badge>
            {ticket.module_slug && <Badge>{ticket.module_slug}</Badge>}
            {ticket.priority && <Badge tone={ticket.priority}>{ticket.priority}</Badge>}
            {ticket.sentiment && <Badge>{ticket.sentiment}</Badge>}
            {ticket.intent && <Badge>{ticket.intent}</Badge>}
          </div>
        </div>
        <Button className="sticky top-2" disabled={busy} onClick={() => void act(`/tickets/${id}/triage`, "Triage finished")}>Run triage</Button>
      </div>
      <ErrorNote message={error} />
      {(escalated || ticket.escalation_reason) && (
        <motion.div
          className="rounded-md border-2 border-danger bg-danger-bg p-4 text-sm text-danger"
          initial={false}
          animate={{ borderColor: "var(--danger)" }}
          transition={{ duration: reduced ? 0 : 0.25, ease: "easeInOut" }}
          role="status"
        >
          <p className="flex items-center gap-2 text-base font-semibold"><ShieldAlert size={18} aria-hidden /> Escalated</p>
          <p className="mt-1">{ticket.escalation_reason || trace?.input_json?.gate?.reason || "A safety check stopped an automatic draft."}</p>
          {ticket.escalation_address && <p className="mt-1">Routed to {ticket.escalation_address}. A failed forward still leaves the ticket escalated.</p>}
          {trace && !trace.llm_called && <p className="mt-1">No drafting model call was made for this run.</p>}
        </motion.div>
      )}
      <div className="md:hidden">
        <Tabs defaultValue="thread">
          <TabsList>
            <TabsTrigger value="thread">Thread</TabsTrigger>
            <TabsTrigger value="context">Context</TabsTrigger>
            <TabsTrigger value="draft">Draft</TabsTrigger>
            <TabsTrigger value="actions">Actions</TabsTrigger>
          </TabsList>
          <TabsContent value="thread">{thread}</TabsContent>
          <TabsContent value="context">{context}</TabsContent>
          <TabsContent value="draft"><motion.div key={reveal} {...motionProps}>{draftPanel}</motion.div></TabsContent>
          <TabsContent value="actions">{actions}</TabsContent>
        </Tabs>
      </div>
      <div className="hidden gap-4 md:grid md:grid-cols-[1.4fr_0.8fr]">
        <div className="grid gap-4">
          {thread}
          <motion.div key={reveal} {...motionProps}>{draftPanel}</motion.div>
        </div>
        <div className="grid content-start gap-4">
          {context}
          {actions}
        </div>
      </div>
    </div>
  );
}

function Thread({ ticket }: { ticket: TicketDetail }) {
  return (
    <section className="grid gap-3">
      <h2 className="text-lg font-semibold">Thread</h2>
      {ticket.messages.length === 0 && <Message direction="inbound" author="customer" body={ticket.body_raw} />}
      {ticket.messages.map((message) => <Message key={message.id} direction={message.direction} author={message.author_type} body={message.body} />)}
    </section>
  );
}

function Message({ direction, author, body }: { direction: string; author: string; body: string }) {
  const internal = direction === "internal";
  const outbound = direction === "outbound";
  const ai = author === "ai";
  const Icon = ai ? Bot : internal ? Lock : UserRound;
  return (
    <article className={`rounded-md border p-3 text-sm ${internal ? "border-caution bg-caution-bg" : outbound ? "border-line bg-raised" : "border-line bg-surface"}`}>
      <p className="mb-1 flex items-center gap-2 text-xs text-muted"><Icon size={14} aria-hidden /> {direction} · {author}</p>
      <p className="whitespace-pre-wrap">{body}</p>
    </article>
  );
}

function DraftPanel({ ticket, draft, trace, draftText, setDraftText, busy, act, reload, reveal, setError }: {
  ticket: TicketDetail;
  draft: Draft | undefined;
  trace: Trace | undefined;
  draftText: string;
  setDraftText: (value: string) => void;
  busy: boolean;
  act: (path: string, note: string) => Promise<void>;
  reload: () => Promise<void>;
  reveal: number;
  setError: (message: string) => void;
}) {
  return (
    <section className="grid gap-3">
      <h2 className="text-lg font-semibold">Draft</h2>
      {!draft && <EmptyState title="No draft yet" detail={reveal ? "Triage did not produce a draft. Read the escalation banner before sending anything." : "Run triage to retrieve policy and draft, or to escalate."} />}
      {draft && (
        <>
          <div className="flex flex-wrap gap-2">
            {draft.citation_doc_ids.map((docId) => {
              const snippet = trace?.input_json.snippets?.find((item) => item.doc_id === docId);
              const score = snippet?.score ?? draft.retrieval_score;
              return (
                <InfoPopover key={docId} trigger={<button type="button" className="min-h-11 rounded-full border border-line px-3 font-mono text-xs">{docId} · {score != null ? Number(score).toFixed(3) : "n/a"}</button>}>
                  <p className="font-medium">{snippet?.title ?? docId}</p>
                  <Mono>{docId}</Mono>
                  <p className="mt-2">{snippet?.snippet ?? "No snippet was stored for this citation."}</p>
                  <p className="mt-2 font-mono text-xs">score {score != null ? Number(score).toFixed(3) : "n/a"}</p>
                </InfoPopover>
              );
            })}
            <Badge>{draft.status}</Badge>
            <Badge tone={draft.llm_called ? "safe" : "neutral"}>{draft.llm_called ? "model called" : "model not called"}</Badge>
          </div>
          <Textarea value={draftText} onChange={(e) => setDraftText(e.target.value)} aria-label="Draft reply" />
          <div className="sticky bottom-20 flex flex-wrap gap-2 bg-bg py-2 md:bottom-0">
            <Button variant="secondary" disabled={busy} onClick={() => void api(`/tickets/${ticket.id}/draft`, { method: "PATCH", body: { body: draftText, draft_id: draft.id } }).then(() => { toast("Draft edit saved"); return reload(); }).catch((err) => setError(err instanceof Error ? err.message : "The draft edit did not save. Try again."))}>Save edit</Button>
            <Button disabled={busy} onClick={() => void act(`/tickets/${ticket.id}/draft/approve`, "Draft approved")}>Approve draft</Button>
            <Button variant="secondary" disabled={busy} onClick={() => void act(`/tickets/${ticket.id}/draft/reject`, "Draft rejected")}>Reject</Button>
            <Button disabled={busy} onClick={() => void act(`/tickets/${ticket.id}/send`, "Reply sent")}>Send</Button>
          </div>
        </>
      )}
    </section>
  );
}

function Context({ ticket, userRole, busy, reload, setError }: { ticket: TicketDetail; userRole?: string; busy: boolean; reload: () => Promise<void>; setError: (message: string) => void }) {
  return (
    <section className="grid gap-3 rounded-md border border-line bg-surface p-3">
      <h2 className="text-lg font-semibold">Account</h2>
      {ticket.account ? (
        <>
          <div>{ticket.account.name}</div>
          <div className="text-sm text-muted">{ticket.account.email}</div>
          <div className="text-sm text-muted">Tier {ticket.account.metadata_json?.tier ?? "unknown"}</div>
        </>
      ) : <p className="text-sm text-muted">No linked account. Match the sender when the next email arrives.</p>}
      <h3 className="text-base font-semibold">Related record</h3>
      {ticket.related_record ? (
        <>
          <Mono>{ticket.related_record.record_ref}</Mono>
          <div className="text-sm">Status {ticket.related_record.payload_json.status}</div>
          <div className="text-sm">Total {ticket.related_record.payload_json.total}</div>
          {(userRole === "supervisor" || userRole === "admin") && (
            <Button variant="secondary" disabled={busy} onClick={() => void api(`/related-records/${ticket.related_record!.id}`, { method: "PATCH", body: { status: "status_changed_after_recommendation" } }).then(() => { toast("Order status changed. Approving the same action again should go stale."); return reload(); }).catch((err) => setError(err instanceof Error ? err.message : "The order status did not change. Try again."))}>Change order status</Button>
          )}
        </>
      ) : <p className="text-sm text-muted">No linked record.</p>}
    </section>
  );
}

function StaleNote() {
  const reduced = useReducedMotion();
  return (
    <motion.div className="rounded-md border border-stale bg-stale-bg p-3 text-sm text-stale" initial={reduced ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: reduced ? 0 : 0.2, ease: "easeInOut" }} role="status">
      Stale approval. The order or policy changed after this action was proposed, so it was not executed.
    </motion.div>
  );
}

function Actions({ ticket, trace, busy, act }: { ticket: TicketDetail; trace: Trace | undefined; busy: boolean; act: (path: string, note: string) => Promise<void> }) {
  return (
    <>
      <section className="grid gap-3 rounded-md border border-line bg-surface p-3">
        <h2 className="text-lg font-semibold">Tool actions</h2>
        {ticket.tool_actions.length === 0 && <EmptyState title="No actions proposed" detail="Run triage. Recommendations stay proposed until a person approves them." />}
        {ticket.tool_actions.map((action) => (
          <article key={action.id} className="grid gap-2 border-t border-line pt-3">
            <strong>{action.tool_key}</strong>
            <div className="flex flex-wrap gap-2">
              <Badge tone={action.risk_level === "high" ? "urgent" : action.risk_level}>{action.risk_level}</Badge>
              <Badge tone={action.status === "stale_blocked" ? "stale" : action.status === "executed" ? "safe" : "neutral"}>{action.status}</Badge>
            </div>
            <p><Mono>idempotency {action.idempotency_key}</Mono></p>
            <p><Mono>hash {(action.snapshot_hash || "").slice(0, 12)}…</Mono></p>
            {action.status === "stale_blocked" && <StaleNote />}
            <div className="flex flex-wrap gap-2">
              <Button disabled={busy} onClick={() => void act(`/tool-actions/${action.id}/approve`, action.tool_key === "start_refund_review" ? "Refund review approved — awaiting execution" : `${action.tool_key.replaceAll("_", " ")} approved — awaiting execution`)}>Approve</Button>
              <Button variant="secondary" disabled={busy} onClick={() => void act(`/tool-actions/${action.id}/reject`, "Action rejected")}>Reject</Button>
              <Button disabled={busy} onClick={() => void act(`/tool-actions/${action.id}/execute`, `${action.tool_key} executed`)}>Execute</Button>
            </div>
          </article>
        ))}
      </section>
      <TraceTimeline trace={trace} />
    </>
  );
}

function TraceTimeline({ trace }: { trace: Trace | undefined }) {
  const [open, setOpen] = useState(false);
  if (!trace) return <section className="rounded-md border border-line bg-surface p-3"><h2 className="text-lg font-semibold">Trace</h2><p className="mt-2 text-sm text-muted">No AI run yet. Run triage to record the pipeline.</p></section>;
  const stages = [
    { label: "Retrieval", detail: (Array.isArray(trace.retrieved_doc_ids) ? trace.retrieved_doc_ids : []).map((docId, index) => `${docId} ${Number(trace.retrieval_scores?.[index] ?? 0).toFixed(3)}`).join(", ") || "No documents" },
    { label: "Rules", detail: (trace.input_json.pre?.matched ?? []).join(", ") || trace.rule_layer_result },
    { label: "Confidence gate", detail: `${trace.confidence_gate_result}${trace.input_json.gate?.reason ? ` — ${trace.input_json.gate.reason}` : ""}` },
    { label: "Model", detail: trace.llm_called ? "Drafting model was called." : "Drafting model was not called." },
    { label: "Actions", detail: (Array.isArray(trace.recommended_actions) ? trace.recommended_actions : []).join(", ") || "None" },
  ];
  return (
    <section className="grid gap-3 rounded-md border border-line bg-surface p-3">
      <h2 className="text-lg font-semibold">Trace</h2>
      <ol className="grid gap-3 border-l border-line pl-3">
        {stages.map((stage) => (
          <li key={stage.label}>
            <p className="text-sm font-medium">{stage.label}</p>
            <p className="font-mono text-xs text-muted">{stage.detail}</p>
          </li>
        ))}
      </ol>
      {trace.input_json.mailbox_default_disagreed && <p className="text-sm text-muted">Mailbox default disagreed with the keyword classification. The keyword result was kept.</p>}
      <Button variant="secondary" onClick={() => setOpen((value) => !value)} aria-expanded={open}>{open ? "Hide raw trace" : "Show raw trace"}</Button>
      {open && <pre className="whitespace-pre-wrap rounded-md bg-raised p-3 font-mono text-xs">{JSON.stringify({ recommended: trace.recommended_actions, final: trace.final_status, run: trace.id }, null, 2)}</pre>}
    </section>
  );
}
