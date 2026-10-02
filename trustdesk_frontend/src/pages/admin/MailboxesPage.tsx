import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { api, currentUser } from "@/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/states";
import { useAdmin, type Mailbox } from "./context";

export function MailboxesPage() {
  const { mailboxes, modules, moduleId, teams, users, readOnly, refresh, setError, connectGmail } = useAdmin();
  const [params] = useSearchParams();
  const me = currentUser();

  useEffect(() => {
    if (params.get("gmail") === "connected") toast("Gmail mailbox connected");
    if (params.get("gmail") === "error") setError("Gmail connection did not complete. Start the connection again.");
  }, [params, setError]);

  return (
    <div className="grid gap-4">
      <h1 className="text-xl font-semibold">Mailboxes</h1>
      {mailboxes.length === 0 && <EmptyState title="No mailboxes connected" detail="Connect a demo mailbox to ingest a sample email, or connect Gmail as an escalation target." />}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-sm">
          <thead className="text-left text-muted"><tr><th className="py-2">Address</th><th>Owner</th><th>Status</th><th>Default module</th><th>Escalation</th><th>Priority</th><th></th></tr></thead>
          <tbody>{mailboxes.map((box) => <MailboxRow key={box.id} box={box} />)}</tbody>
        </table>
      </div>
      <div className="grid gap-3 md:hidden">
        {mailboxes.map((box) => (
          <article key={box.id} className="grid gap-2 rounded-md border border-line bg-surface p-3">
            <strong>{box.address}</strong>
            <p className="text-sm text-muted">{box.provider} · {box.owner_name || box.owner_type}</p>
            <Badge tone={box.status === "error" ? "danger" : box.status === "connected" ? "safe" : "neutral"}>{box.status}</Badge>
            <label className="inline-flex min-h-11 items-center gap-2 text-sm">
              <input type="checkbox" className="size-5" checked={box.is_escalation_target} disabled={readOnly} aria-label={`Escalation target ${box.address}`} onChange={(event) => void api(`/mailboxes/${box.id}`, { method: "PATCH", body: { is_escalation_target: event.target.checked } }).then(refresh).catch((err) => setError(err.message))} />
              Escalation target
            </label>
            <Input type="number" defaultValue={box.escalation_priority ?? ""} disabled={readOnly} aria-label={`Priority for ${box.address}`} onBlur={(event) => { const value = event.target.value === "" ? null : Number(event.target.value); void api(`/mailboxes/${box.id}`, { method: "PATCH", body: { escalation_priority: value } }).then(refresh).catch((err) => setError(err.message)); }} />
            <MailboxControls box={box} />
          </article>
        ))}
      </div>
      {!readOnly && (
        <form className="grid gap-3 rounded-md border border-line bg-surface p-4" onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          const ownerType = String(form.get("ownerType"));
          const ownerId = ownerType === "team" ? String(form.get("teamId")) : ownerType === "user" ? String(form.get("userId")) : undefined;
          void connectGmail(ownerType, ownerId).catch((err) => setError(err.message));
        }}>
          <h2 className="text-lg font-semibold">Connect Gmail</h2>
          <Field label="Owner"><Select name="ownerType" defaultValue="org"><option value="org">Organization</option><option value="team">Team</option><option value="user">User</option></Select></Field>
          <Field label="Team"><Select name="teamId">{teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</Select></Field>
          <Field label="User"><Select name="userId">{users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}</Select></Field>
          <Button type="submit">Connect Gmail</Button>
        </form>
      )}
      {!readOnly && (
        <form className="grid gap-3 rounded-md border border-line bg-surface p-4" onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          void api("/mailboxes", { method: "POST", body: { provider: "demo", address: String(form.get("address")), signature: String(form.get("signature")), tone: String(form.get("tone")), module_default_id: moduleId || null } }).then(() => { toast("Demo mailbox connected"); return refresh(); }).catch((err) => setError(err.message));
        }}>
          <h2 className="text-lg font-semibold">Connect demo mailbox</h2>
          <Field label="Address"><Input name="address" type="email" required /></Field>
          <Field label="Signature"><Input name="signature" /></Field>
          <Field label="Tone"><Input name="tone" defaultValue="calm and plain" /></Field>
          <div className="sticky bottom-20 bg-surface py-2 md:bottom-0"><Button type="submit">Connect</Button></div>
        </form>
      )}
      {!readOnly && mailboxes.some((box) => box.provider === "demo") && (
        <form className="grid gap-3 rounded-md border border-line bg-surface p-4" onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          void api(`/mailboxes/${String(form.get("mailbox"))}/demo-messages`, { method: "POST", body: { from_email: String(form.get("from_email")), from_name: String(form.get("from_name")), subject: String(form.get("subject")), body: String(form.get("body")) } }).then(() => toast("Demo email queued. Ingest it from the mailbox row.")).catch((err) => setError(err.message));
        }}>
          <h2 className="text-lg font-semibold">Queue a demo email</h2>
          <Field label="Mailbox"><Select name="mailbox">{mailboxes.filter((box) => box.provider === "demo").map((box) => <option key={box.id} value={box.id}>{box.address}</option>)}</Select></Field>
          <Field label="From email"><Input name="from_email" type="email" required /></Field>
          <Field label="From name"><Input name="from_name" /></Field>
          <Field label="Subject"><Input name="subject" required /></Field>
          <Field label="Body"><Textarea name="body" required /></Field>
          <Button type="submit">Queue</Button>
        </form>
      )}
    </div>
  );

  function MailboxRow({ box }: { box: Mailbox }) {
    return (
      <tr className="border-t border-line align-top">
        <td className="py-2">{box.address}<div className="text-xs text-muted">{box.provider}</div></td>
        <td>{box.owner_name || box.owner_type}{box.owner_type !== "org" ? ` · ${box.owner_type}` : ""}</td>
        <td><Badge tone={box.status === "error" ? "danger" : box.status === "connected" ? "safe" : "neutral"}>{box.status}</Badge></td>
        <td><ModuleSelect box={box} /></td>
        <td><label className="inline-flex min-h-11 min-w-11 items-center"><input type="checkbox" className="size-5" checked={box.is_escalation_target} disabled={readOnly} aria-label={`Escalation target ${box.address}`} onChange={(event) => void api(`/mailboxes/${box.id}`, { method: "PATCH", body: { is_escalation_target: event.target.checked } }).then(refresh).catch((err) => setError(err.message))} /></label></td>
        <td><Input type="number" className="w-20" defaultValue={box.escalation_priority ?? ""} disabled={readOnly} aria-label={`Priority for ${box.address}`} onBlur={(event) => { const value = event.target.value === "" ? null : Number(event.target.value); void api(`/mailboxes/${box.id}`, { method: "PATCH", body: { escalation_priority: value } }).then(refresh).catch((err) => setError(err.message)); }} /></td>
        <td><MailboxControls box={box} /></td>
      </tr>
    );
  }

  function ModuleSelect({ box }: { box: Mailbox }) {
    return (
      <Select value={box.module_default_id ?? ""} disabled={readOnly} aria-label={`Default module for ${box.address}`} onChange={(event) => void api(`/mailboxes/${box.id}`, { method: "PATCH", body: { module_default_id: event.target.value || null } }).then(refresh).catch((err) => setError(err.message))}>
        <option value="">none</option>
        {modules.map((mod) => <option key={mod.id} value={mod.id}>{mod.name}</option>)}
      </Select>
    );
  }

  function MailboxControls({ box }: { box: Mailbox }) {
    const canDisconnect = box.provider === "gmail" && box.status !== "disconnected" && (!readOnly || (me && box.owner_type === "user" && box.owner_id === me.id));
    return (
      <div className="flex flex-wrap gap-2">
        {box.provider === "demo" && <Button variant="secondary" onClick={() => void api<{ ingested: number; ticket_ids: string[] }>(`/mailboxes/${box.id}/ingest-demo`, { method: "POST" }).then((result) => toast(`Ingested ${result.ingested}: ${result.ticket_ids.join(", ") || "inbox empty"}`)).catch((err) => setError(err.message))}>Ingest demo</Button>}
        {canDisconnect && <Button variant="secondary" onClick={() => void api(`/mailboxes/${box.id}/disconnect`, { method: "POST" }).then(() => { toast("Gmail disconnected"); return refresh(); }).catch((err) => setError(err.message))}>Disconnect</Button>}
      </div>
    );
  }
}
