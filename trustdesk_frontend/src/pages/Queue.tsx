import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/api";
import { Badge } from "@/components/ui/badge";
import { Input, Select } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/layout";
import { EmptyState, ErrorNote, Skeleton } from "@/components/ui/states";

type NextAction = "triage" | "review_draft" | "approve_tool" | "send" | "handle_escalation" | "done";
type BoardColumn = "incoming" | "needs_review" | "escalated" | "done";

type Ticket = {
  id: string;
  subject: string;
  status: string;
  priority: string | null;
  module_slug: string | null;
  account_name: string | null;
  sla_due_at: string | null;
  next_action: NextAction;
  board_column: BoardColumn;
};

type Board = {
  incoming: Ticket[];
  needs_review: Ticket[];
  escalated: Ticket[];
  done: Ticket[];
};

const columns: { key: BoardColumn; title: string }[] = [
  { key: "incoming", title: "Incoming" },
  { key: "needs_review", title: "Needs review" },
  { key: "escalated", title: "Escalated" },
  { key: "done", title: "Done" },
];

const actionLabel: Record<NextAction, string> = {
  triage: "Run triage",
  review_draft: "Approve draft",
  approve_tool: "Approve action",
  send: "Send reply",
  handle_escalation: "Read why it stopped",
  done: "Closed",
};

function breached(ticket: Ticket) {
  return Boolean(ticket.sla_due_at && new Date(ticket.sla_due_at).getTime() < Date.now() && !["sent", "closed"].includes(ticket.status));
}

export function QueuePage() {
  const [board, setBoard] = useState<Board>({ incoming: [], needs_review: [], escalated: [], done: [] });
  const [status, setStatus] = useState("");
  const [priority, setPriority] = useState("");
  const [module, setModule] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const params = new URLSearchParams({ board: "1" });
    if (status) params.set("status", status);
    if (priority) params.set("priority", priority);
    if (module) params.set("module", module);
    let ignore = false;
    setLoading(true);
    api<Board | Ticket[]>(`/tickets?${params}`)
      .then((rows) => {
        if (ignore) return;
        const grouped = Array.isArray(rows)
          ? {
              incoming: rows.filter((row) => row.board_column === "incoming"),
              needs_review: rows.filter((row) => row.board_column === "needs_review"),
              escalated: rows.filter((row) => row.board_column === "escalated"),
              done: rows.filter((row) => row.board_column === "done"),
            }
          : {
              incoming: rows.incoming ?? [],
              needs_review: rows.needs_review ?? [],
              escalated: rows.escalated ?? [],
              done: rows.done ?? [],
            };
        setBoard(grouped);
        setError("");
      })
      .catch((err) => {
        if (!ignore) setError(err instanceof Error ? err.message : "The queue did not load. Refresh the page.");
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, [status, priority, module]);

  const total = columns.reduce((sum, column) => sum + board[column.key].length, 0);

  return (
    <div className="grid gap-4">
      <PageHeader title="Queue" detail="Customer mail in. Next job on each card." />
      <div className="grid gap-2 sm:grid-cols-3">
        <Input placeholder="module slug" value={module} onChange={(e) => setModule(e.target.value)} aria-label="Filter by module slug" />
        <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status">
          <option value="">any status</option>
          {["new", "triaged", "drafted", "pending_approval", "approved", "sent", "closed", "escalated"].map((item) => <option key={item}>{item}</option>)}
        </Select>
        <Select value={priority} onChange={(e) => setPriority(e.target.value)} aria-label="Filter by priority">
          <option value="">any priority</option>
          {["low", "medium", "high", "urgent"].map((item) => <option key={item}>{item}</option>)}
        </Select>
      </div>
      <ErrorNote message={error} />
      {loading && <div className="grid gap-2 md:grid-cols-4">{[0, 1, 2, 3].map((item) => <Skeleton key={item} className="h-40" />)}</div>}
      {!loading && total === 0 && <EmptyState title="No tickets" detail="Clear filters or ingest mail from Mailboxes." />}
      {!loading && total > 0 && (
        <div className="grid gap-3 md:grid-cols-4">
          {columns.map((column) => (
            <section key={column.key} className="grid content-start gap-2">
              <h2 className="flex items-center justify-between text-sm font-semibold">
                {column.title}
                <span className="text-muted">{board[column.key].length}</span>
              </h2>
              {board[column.key].map((ticket) => <QueueCard key={ticket.id} ticket={ticket} />)}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function QueueCard({ ticket }: { ticket: Ticket }) {
  const late = breached(ticket);
  return (
    <Link to={`/tickets/${ticket.id}`} className={`grid min-h-11 gap-1 rounded-card border bg-surface p-3 shadow-card ${late ? "border-urgent" : ticket.status === "escalated" ? "border-danger" : "border-line"}`}>
      <span className="font-medium">{ticket.subject}</span>
      <span className="text-sm text-muted">{ticket.account_name ?? "No customer"} · {ticket.module_slug ?? "unclassified"}</span>
      <span className="flex flex-wrap gap-2">
        {ticket.priority && <Badge tone={ticket.priority}>{ticket.priority}</Badge>}
        <Badge tone={ticket.status === "escalated" ? "danger" : "neutral"}>{actionLabel[ticket.next_action] ?? ticket.status}</Badge>
        {late && <span className="text-sm font-medium text-urgent">SLA breached</span>}
      </span>
    </Link>
  );
}
