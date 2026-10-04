import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { api } from "@/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Card, ListButton, PageHeader, SplitPane } from "@/components/ui/layout";
import { EmptyState } from "@/components/ui/states";
import { useAdmin } from "./context";

export function MailboxesPage() {
  const { mailboxes, modules, moduleId, readOnly, refresh, setError } = useAdmin();
  const navigate = useNavigate();
  const [selectedId, setSelectedId] = useState("");
  const [adding, setAdding] = useState(false);
  const selected = mailboxes.find((box) => box.id === selectedId) ?? mailboxes[0] ?? null;

  useEffect(() => {
    if (adding) return;
    if (!mailboxes.some((box) => box.id === selectedId)) {
      setSelectedId(mailboxes[0]?.id ?? "");
    }
  }, [mailboxes, selectedId, adding]);

  return (
    <div className="grid gap-4">
      <PageHeader title="Mailboxes" detail="Local inbox used to queue and ingest sample mail." />
      <SplitPane
        list={
          <Card className="grid gap-1 p-2">
            {mailboxes.length === 0 && !adding && <EmptyState title="No mailboxes" detail="Add a local inbox." />}
            {mailboxes.map((box) => (
              <ListButton key={box.id} active={!adding && selected?.id === box.id} onClick={() => { setAdding(false); setSelectedId(box.id); }}>
                <span className="flex items-center justify-between gap-2">
                  <strong className="truncate">{box.address}</strong>
                  <Badge tone={box.status === "error" ? "danger" : box.status === "connected" || box.status === "active" ? "safe" : "neutral"}>{box.status}</Badge>
                </span>
                <span className="text-muted">{box.owner_name || box.owner_type}</span>
              </ListButton>
            ))}
            {!readOnly && (
              <ListButton active={adding} onClick={() => setAdding(true)}>
                <strong>Add mailbox</strong>
                <span className="text-muted">Local inbox</span>
              </ListButton>
            )}
          </Card>
        }
        editor={
          <div className="grid gap-4">
            {!adding && selected && (
              <Card className="grid gap-3">
                <div>
                  <h2 className="text-lg font-semibold">{selected.address}</h2>
                  <p className="mt-1 text-sm text-muted">{selected.owner_name || selected.owner_type}</p>
                </div>
                <Field label="Default module">
                  <Select value={selected.module_default_id ?? ""} disabled={readOnly} aria-label={`Default module for ${selected.address}`} onChange={(event) => void api(`/mailboxes/${selected.id}`, { method: "PATCH", body: { module_default_id: event.target.value || null } }).then(refresh).catch((err) => setError(err.message))}>
                    <option value="">none</option>
                    {modules.map((mod) => <option key={mod.id} value={mod.id}>{mod.name}</option>)}
                  </Select>
                </Field>
                <label className="inline-flex min-h-11 items-center gap-2 text-sm">
                  <input type="checkbox" className="size-5" checked={selected.is_escalation_target} disabled={readOnly} aria-label={`Escalation target ${selected.address}`} onChange={(event) => void api(`/mailboxes/${selected.id}`, { method: "PATCH", body: { is_escalation_target: event.target.checked } }).then(refresh).catch((err) => setError(err.message))} />
                  Escalation target
                </label>
                <Field label="Escalation priority">
                  <Input type="number" defaultValue={selected.escalation_priority ?? ""} disabled={readOnly} aria-label={`Priority for ${selected.address}`} key={`${selected.id}-${selected.escalation_priority}`} onBlur={(event) => { const raw = event.target.value; const value = raw === "" ? null : Number(raw); if (value !== null && Number.isNaN(value)) return; void api(`/mailboxes/${selected.id}`, { method: "PATCH", body: { escalation_priority: value } }).then(refresh).catch((err) => setError(err.message)); }} />
                </Field>
                {selected.provider === "demo" && (
                  <Button variant="secondary" onClick={() => void api<{ ingested: number; ticket_ids: string[] }>(`/mailboxes/${selected.id}/ingest-demo`, { method: "POST" }).then((result) => {
                    toast(`Ingested ${result.ingested}: ${result.ticket_ids.join(", ") || "inbox empty"}`);
                    if (result.ticket_ids?.[0]) navigate(`/tickets/${result.ticket_ids[0]}`);
                    else navigate("/queue");
                  }).catch((err) => setError(err.message))}>Ingest</Button>
                )}
              </Card>
            )}
            {!readOnly && (adding || mailboxes.length === 0) && (
              <form className="grid gap-3 rounded-card border border-line bg-surface p-4 shadow-card" onSubmit={(event) => {
                event.preventDefault();
                const form = new FormData(event.currentTarget);
                void api("/mailboxes", { method: "POST", body: { provider: "demo", address: String(form.get("address")), signature: String(form.get("signature")), tone: String(form.get("tone")), module_default_id: moduleId || null } }).then(() => { toast("Mailbox connected"); setAdding(false); return refresh(); }).catch((err) => setError(err.message));
              }}>
                <h2 className="text-lg font-semibold">Local inbox</h2>
                <Field label="Address"><Input name="address" type="email" required /></Field>
                <Field label="Signature"><Input name="signature" /></Field>
                <Field label="Tone"><Input name="tone" defaultValue="calm and plain" /></Field>
                <div className="sticky bottom-20 bg-surface py-2 md:bottom-0"><Button type="submit">Connect</Button></div>
              </form>
            )}
            {!adding && selected?.provider === "demo" && (
              <form className="grid gap-3 rounded-card border border-line bg-surface p-4 shadow-card" onSubmit={(event) => {
                event.preventDefault();
                const form = new FormData(event.currentTarget);
                void api(`/mailboxes/${selected.id}/demo-messages`, { method: "POST", body: { from_email: String(form.get("from_email")), from_name: String(form.get("from_name")), subject: String(form.get("subject")), body: String(form.get("body")) } }).then(() => toast("Email queued. Ingest it from this mailbox.")).catch((err) => setError(err.message));
              }}>
                <h2 className="text-lg font-semibold">Queue an email</h2>
                <Field label="From email"><Input name="from_email" type="email" required /></Field>
                <Field label="From name"><Input name="from_name" /></Field>
                <Field label="Subject"><Input name="subject" required /></Field>
                <Field label="Body"><Textarea name="body" required /></Field>
                <Button type="submit">Queue</Button>
              </form>
            )}
          </div>
        }
      />
    </div>
  );
}
