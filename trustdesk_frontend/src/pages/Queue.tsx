import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, currentUser } from "@/api";
import { Badge, Mono } from "@/components/ui/badge";
import { Input, Select } from "@/components/ui/field";
import { EmptyState, ErrorNote, Skeleton } from "@/components/ui/states";

type Ticket = {
  id: string;
  subject: string;
  status: string;
  priority: string | null;
  module_slug: string | null;
  channel_type: string | null;
  account_name: string | null;
  sla_due_at: string | null;
  created_at: string;
  escalation_address: string | null;
  escalation_owner_id: string | null;
};

const statuses = ["new", "triaged", "drafted", "pending_approval", "approved", "sent", "closed", "escalated"];
const priorities = ["low", "medium", "high", "urgent"];

function breached(ticket: Ticket) {
  return Boolean(ticket.sla_due_at && new Date(ticket.sla_due_at).getTime() < Date.now() && !["sent", "closed"].includes(ticket.status));
}

function slaLabel(ticket: Ticket) {
  if (breached(ticket)) return "SLA breached";
  if (!ticket.sla_due_at) return "SLA not set";
  return new Date(ticket.sla_due_at).toLocaleString();
}

export function QueuePage() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [status, setStatus] = useState("");
  const [priority, setPriority] = useState("");
  const [module, setModule] = useState("");
  const [sort, setSort] = useState("newest");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const me = currentUser();

  useEffect(() => {
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (priority) params.set("priority", priority);
    if (module) params.set("module", module);
    let ignore = false;
    setLoading(true);
    api<Ticket[]>(`/tickets?${params.toString()}`)
      .then((rows) => {
        if (ignore) return;
        setTickets(rows);
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

  const rows = useMemo(() => {
    const copy = [...tickets];
    const rank: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };
    if (sort === "sla") copy.sort((a, b) => new Date(a.sla_due_at ?? "9999").getTime() - new Date(b.sla_due_at ?? "9999").getTime());
    if (sort === "priority") copy.sort((a, b) => (rank[a.priority ?? "low"] ?? 4) - (rank[b.priority ?? "low"] ?? 4));
    return copy;
  }, [tickets, sort]);

  return (
    <div className="grid gap-4">
      <h1 className="text-xl font-semibold">Ticket queue</h1>
      <div className="grid gap-2 sm:grid-cols-4">
        <Input placeholder="module slug" value={module} onChange={(e) => setModule(e.target.value)} aria-label="Filter by module slug" />
        <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status">
          <option value="">any status</option>
          {statuses.map((item) => <option key={item}>{item}</option>)}
        </Select>
        <Select value={priority} onChange={(e) => setPriority(e.target.value)} aria-label="Filter by priority">
          <option value="">any priority</option>
          {priorities.map((item) => <option key={item}>{item}</option>)}
        </Select>
        <Select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort tickets">
          <option value="newest">Newest</option>
          <option value="sla">SLA soonest</option>
          <option value="priority">Priority</option>
        </Select>
      </div>
      <ErrorNote message={error} />
      {loading && <div className="grid gap-2">{[0, 1, 2, 3].map((item) => <Skeleton key={item} className="h-16" />)}</div>}
      {!loading && rows.length === 0 && <EmptyState title="No tickets match" detail="Clear the filters, or ingest a demo email from Mailboxes." />}
      {!loading && rows.length > 0 && (
        <>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-sm">
              <thead className="text-left text-muted"><tr><th className="py-2">Ticket</th><th>Customer</th><th>Module</th><th>Priority</th><th>Status</th><th>Escalation</th><th>SLA</th></tr></thead>
              <tbody>{rows.map((ticket) => <QueueRow key={ticket.id} ticket={ticket} mine={me?.id === ticket.escalation_owner_id} />)}</tbody>
            </table>
          </div>
          <div className="grid gap-3 md:hidden">
            {rows.map((ticket) => <QueueCard key={ticket.id} ticket={ticket} mine={me?.id === ticket.escalation_owner_id} />)}
          </div>
        </>
      )}
    </div>
  );
}

function QueueRow({ ticket, mine }: { ticket: Ticket; mine: boolean }) {
  const late = breached(ticket);
  return (
    <tr className={late ? "border-t border-line bg-urgent-bg" : "border-t border-line"}>
      <td className="py-3"><Link className="font-medium" to={`/tickets/${ticket.id}`}>{ticket.subject}</Link><div><Mono>{ticket.id}</Mono></div></td>
      <td>{ticket.account_name ?? "—"}</td>
      <td>{ticket.module_slug ?? "—"}</td>
      <td>{ticket.priority ? <Badge tone={ticket.priority}>{ticket.priority}</Badge> : "—"}</td>
      <td><Badge tone={ticket.status === "escalated" ? "danger" : "neutral"}>{ticket.status}{mine ? " · yours" : ""}</Badge></td>
      <td>{ticket.escalation_address ?? "—"}</td>
      <td className={late ? "font-medium text-urgent" : ""}>{slaLabel(ticket)}</td>
    </tr>
  );
}

function QueueCard({ ticket, mine }: { ticket: Ticket; mine: boolean }) {
  const late = breached(ticket);
  return (
    <Link to={`/tickets/${ticket.id}`} className={`grid min-h-11 gap-1 rounded-md border bg-surface p-3 ${late ? "border-urgent" : "border-line"}`}>
      <span className="font-medium">{ticket.subject}</span>
      <span className="text-sm text-muted">{ticket.account_name ?? "No customer"} · {ticket.module_slug ?? "unclassified"}</span>
      <span className="flex flex-wrap gap-2">
        {ticket.priority && <Badge tone={ticket.priority}>{ticket.priority}</Badge>}
        <Badge tone={ticket.status === "escalated" ? "danger" : "neutral"}>{ticket.status}{mine ? " · yours" : ""}</Badge>
        <span className={late ? "text-sm font-medium text-urgent" : "text-sm text-muted"}>{slaLabel(ticket)}</span>
      </span>
    </Link>
  );
}
