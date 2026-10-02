import { toast } from "sonner";
import { api } from "@/api";
import { Badge, Mono } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/states";
import { useAdmin } from "./context";

export function ModulesPage() {
  const { modules, mailboxes, readOnly, refresh, setError } = useAdmin();
  const targets = mailboxes.filter((box) => box.is_escalation_target);
  return (
    <div className="grid gap-4">
      <h1 className="text-xl font-semibold">Modules</h1>
      {modules.length === 0 && <EmptyState title="No modules yet" detail="Create a module such as Claims, then publish a policy for it." />}
      <div className="hidden md:block">
        <table className="w-full text-sm">
          <thead className="text-left text-muted"><tr><th className="py-2">Name</th><th>Slug</th><th>SLA</th><th>Threshold</th><th>Escalation mailbox</th><th>Status</th></tr></thead>
          <tbody>{modules.map((mod) => <ModuleRow key={mod.id} mod={mod} targets={targets} readOnly={readOnly} refresh={refresh} setError={setError} />)}</tbody>
        </table>
      </div>
      <div className="grid gap-3 md:hidden">
        {modules.map((mod) => (
          <article key={mod.id} className="grid gap-2 rounded-md border border-line bg-surface p-3">
            <div className="flex items-center justify-between"><strong>{mod.name}</strong><Badge>{mod.status}</Badge></div>
            <Mono>{mod.slug}</Mono>
            <p className="text-sm text-muted">{mod.sla_first_response_mins} min first response</p>
            <EscalationSelect mod={mod} targets={targets} readOnly={readOnly} refresh={refresh} setError={setError} />
          </article>
        ))}
      </div>
      {!readOnly && (
        <form className="grid gap-3 rounded-md border border-line bg-surface p-4" onSubmit={(event) => {
          event.preventDefault();
          const formEl = event.currentTarget;
          const form = new FormData(formEl);
          void api("/modules", {
            method: "POST",
            body: {
              name: String(form.get("name")),
              slug: String(form.get("slug")),
              description: String(form.get("description")),
              keywords: String(form.get("keywords")).split(",").map((k) => k.trim()).filter(Boolean),
              confidence_threshold_override: form.get("threshold") ? Number(form.get("threshold")) : null,
              sla_first_response_mins: Number(form.get("sla") || 240),
            },
          }).then(() => { toast("Module created"); formEl.reset(); return refresh(); }).catch((err) => setError(err.message));
        }}>
          <h2 className="text-lg font-semibold">New module</h2>
          <Field label="Name"><Input name="name" required /></Field>
          <Field label="Slug"><Input name="slug" required placeholder="claims" /></Field>
          <Field label="Description"><Input name="description" /></Field>
          <Field label="Keywords, comma separated"><Input name="keywords" placeholder="claim, adjuster, policyholder" /></Field>
          <Field label="Confidence override"><Input name="threshold" type="number" step="0.01" /></Field>
          <Field label="First response SLA minutes"><Input name="sla" type="number" defaultValue={240} /></Field>
          <div className="sticky bottom-20 bg-surface py-2 md:bottom-0"><Button type="submit">Create module</Button></div>
        </form>
      )}
    </div>
  );
}

function ModuleRow({ mod, targets, readOnly, refresh, setError }: RowProps) {
  return (
    <tr className="border-t border-line">
      <td className="py-2">{mod.name}</td>
      <td><Mono>{mod.slug}</Mono></td>
      <td>{mod.sla_first_response_mins} min</td>
      <td>{mod.confidence_threshold_override ?? "org default"}</td>
      <td><EscalationSelect mod={mod} targets={targets} readOnly={readOnly} refresh={refresh} setError={setError} /></td>
      <td><Badge>{mod.status}</Badge></td>
    </tr>
  );
}

type RowProps = {
  mod: ReturnType<typeof useAdmin>["modules"][number];
  targets: ReturnType<typeof useAdmin>["mailboxes"];
  readOnly: boolean;
  refresh: () => Promise<void>;
  setError: (message: string) => void;
};

function EscalationSelect({ mod, targets, readOnly, refresh, setError }: RowProps) {
  return (
    <Select value={mod.escalation_mailbox_id ?? ""} disabled={readOnly} aria-label={`Escalation mailbox for ${mod.name}`} onChange={(event) => {
      const escalation_mailbox_id = event.target.value || null;
      void api(`/modules/${mod.id}`, { method: "PATCH", body: { escalation_mailbox_id } }).then(() => { toast("Escalation mailbox updated"); return refresh(); }).catch((err) => setError(err.message));
    }}>
      <option value="">none</option>
      {mod.escalation_mailbox_id && !targets.some((box) => box.id === mod.escalation_mailbox_id) && (
        <option value={mod.escalation_mailbox_id}>{mod.escalation_mailbox_id}</option>
      )}
      {targets.map((box) => <option key={box.id} value={box.id}>{box.address}</option>)}
    </Select>
  );
}
