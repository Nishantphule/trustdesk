import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@/api";
import { Badge, Mono } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { Card, ListButton, PageHeader, SplitPane } from "@/components/ui/layout";
import { EmptyState } from "@/components/ui/states";
import { useAdmin } from "./context";

export function ModulesPage() {
  const { modules, mailboxes, readOnly, refresh, setError } = useAdmin();
  const [selectedId, setSelectedId] = useState("");
  const [creating, setCreating] = useState(false);
  const targets = mailboxes.filter((box) => box.is_escalation_target);
  const selected = modules.find((mod) => mod.id === selectedId) ?? modules[0] ?? null;

  useEffect(() => {
    if (creating) return;
    if (!modules.some((mod) => mod.id === selectedId)) {
      setSelectedId(modules[0]?.id ?? "");
    }
  }, [modules, selectedId, creating]);

  return (
    <div className="grid gap-4">
      <PageHeader title="Modules" detail="Keywords, SLA, threshold override, and escalation mailbox." />
      <SplitPane
        list={
          <Card className="grid gap-1 p-2">
            {modules.length === 0 && !creating && <EmptyState title="No modules yet" detail="Create a module, then publish a policy for it." />}
            {modules.map((mod) => (
              <ListButton key={mod.id} active={!creating && selected?.id === mod.id} onClick={() => { setCreating(false); setSelectedId(mod.id); }}>
                <span className="flex items-center justify-between gap-2">
                  <strong>{mod.name}</strong>
                  <Badge>{mod.status}</Badge>
                </span>
                <span className="text-muted">{mod.slug}</span>
              </ListButton>
            ))}
            {!readOnly && (
              <ListButton active={creating} onClick={() => setCreating(true)}>
                <strong>New module</strong>
                <span className="text-muted">Name, slug, SLA, and keywords</span>
              </ListButton>
            )}
          </Card>
        }
        editor={
          <div className="grid gap-4">
            {creating && !readOnly && (
              <form className="grid gap-3 rounded-card border border-line bg-surface p-4 shadow-card" onSubmit={(event) => {
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
                }).then(() => { toast("Module created"); formEl.reset(); setCreating(false); return refresh(); }).catch((err) => setError(err.message));
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
            {!creating && selected && (
              <Card className="grid gap-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="text-lg font-semibold">{selected.name}</h2>
                    <p className="mt-1 text-sm text-muted"><Mono>{selected.slug}</Mono></p>
                  </div>
                  <Badge>{selected.status}</Badge>
                </div>
                <p className="text-sm">{selected.description || "No description."}</p>
                <p className="text-sm text-muted">{selected.sla_first_response_mins} min first response · threshold {selected.confidence_threshold_override ?? "org default"}</p>
                {(selected.keywords ?? []).length > 0 && <p className="text-sm text-muted">Keywords: {(selected.keywords ?? []).join(", ")}</p>}
                <Field label="Escalation mailbox">
                  <EscalationSelect mod={selected} targets={targets} readOnly={readOnly} refresh={refresh} setError={setError} />
                </Field>
              </Card>
            )}
          </div>
        }
      />
    </div>
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
