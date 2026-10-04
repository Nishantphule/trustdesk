import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@/api";
import { Badge, Mono } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Card, ListButton, PageHeader, SplitPane } from "@/components/ui/layout";
import { EmptyState } from "@/components/ui/states";
import { useAdmin, type Policy } from "./context";

type History = { id: string; version: string; status: string };
type Diff = { from: string; to: string; added: string[]; removed: string[] };

export function PoliciesPage() {
  const { modules, moduleId, setModuleId, policies, setPolicies, readOnly, setError } = useAdmin();
  const [selectedId, setSelectedId] = useState("");
  const [history, setHistory] = useState<History[]>([]);
  const [diff, setDiff] = useState<Diff | null>(null);
  const [against, setAgainst] = useState("");

  const selected = policies.find((policy) => policy.id === selectedId) ?? policies[0] ?? null;

  useEffect(() => {
    if (!policies.some((policy) => policy.id === selectedId)) {
      setSelectedId(policies[0]?.id ?? "");
    }
  }, [policies, selectedId]);

  useEffect(() => {
    const id = selected?.id;
    if (!id) {
      setHistory([]);
      setDiff(null);
      setAgainst("");
      return;
    }
    let ignore = false;
    void api<History[]>(`/policies/${id}/history`)
      .then((rows) => {
        if (ignore) return;
        setHistory(rows);
        setDiff(null);
        const other = rows.find((row) => row.id !== id);
        setAgainst(other?.id ?? "");
      })
      .catch((err) => {
        if (!ignore) setError(err instanceof Error ? err.message : "Policy history did not load.");
      });
    return () => {
      ignore = true;
    };
  }, [selected?.id, setError]);

  async function loadDiff() {
    if (!selected || !against) return;
    setDiff(await api<Diff>(`/policies/${selected.id}/diff?against=${against}`));
  }

  return (
    <div className="grid gap-4">
      <PageHeader
        title="Policies"
        detail="Draft, publish, and compare versions for the selected module."
        action={
          <Field label="Module">
            <Select value={moduleId} onChange={(e) => setModuleId(e.target.value)} aria-label="Policy module">
              {modules.map((mod) => <option key={mod.id} value={mod.id}>{mod.name}</option>)}
            </Select>
          </Field>
        }
      />
      <SplitPane
        list={
          <Card className="grid gap-1 p-2">
            {policies.length === 0 && <EmptyState title="No policies in this module" detail="Write a draft in the editor, then publish it." />}
            {policies.map((policy) => (
              <ListButton key={policy.id} active={selected?.id === policy.id} onClick={() => setSelectedId(policy.id)}>
                <span className="flex items-center justify-between gap-2">
                  <Mono>{policy.doc_id}</Mono>
                  <Badge tone={policy.status === "published" ? "safe" : "neutral"}>{policy.status}</Badge>
                </span>
                <span className="text-muted">{policy.version}</span>
              </ListButton>
            ))}
          </Card>
        }
        editor={
          <div className="grid gap-4">
            {selected && (
              <Card className="grid gap-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold">{selected.title}</h2>
                    <p className="mt-1 text-sm text-muted">{selected.doc_id} · {selected.version}</p>
                  </div>
                  <PolicyActions policy={selected} readOnly={readOnly} moduleId={moduleId} setPolicies={setPolicies} setError={setError} />
                </div>
                {history.length > 0 && (
                  <div className="grid gap-3 border-t border-line pt-3">
                    <h3 className="text-sm font-medium">History</h3>
                    <p className="text-sm text-muted">{history.map((row) => `${row.version} (${row.status})`).join(" → ")}</p>
                    <Field label="Compare the selected version with">
                      <Select value={against} onChange={(e) => setAgainst(e.target.value)}>
                        <option value="" disabled>Select a version</option>
                        {history.filter((row) => row.id !== selected.id).map((row) => <option key={row.id} value={row.id}>{row.version} ({row.status})</option>)}
                      </Select>
                    </Field>
                    <Button variant="secondary" disabled={!against} onClick={() => void loadDiff().catch((err) => setError(err.message))}>Show diff</Button>
                    {!against && <p className="text-sm text-muted">Only one version is stored, so there is nothing to compare yet.</p>}
                    {diff && (
                      <div className="grid gap-3 md:grid-cols-2">
                        <div>
                          <p className="text-sm font-medium text-danger">Removed from {diff.from}</p>
                          {diff.removed.length === 0 && <p className="text-sm text-muted">No removed lines.</p>}
                          {diff.removed.map((line, index) => <p key={`removed-${index}`} className="font-mono text-xs">{line}</p>)}
                        </div>
                        <div>
                          <p className="text-sm font-medium text-safe">Added in {diff.to}</p>
                          {diff.added.length === 0 && <p className="text-sm text-muted">No added lines.</p>}
                          {diff.added.map((line, index) => <p key={`added-${index}`} className="font-mono text-xs">{line}</p>)}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </Card>
            )}
            {!readOnly && (
              <form className="grid gap-3 rounded-card border border-line bg-surface p-4 shadow-card" onSubmit={(event) => {
                event.preventDefault();
                const formEl = event.currentTarget;
                const form = new FormData(formEl);
                void api(`/modules/${moduleId}/policies`, {
                  method: "POST",
                  body: {
                    doc_id: String(form.get("doc_id")),
                    title: String(form.get("title")),
                    version: String(form.get("version")),
                    content_md: String(form.get("content")),
                    audience: "external",
                  },
                }).then(() => api<Policy[]>(`/modules/${moduleId}/policies`).then((rows) => {
                  setPolicies(rows);
                  const created = rows.find((row) => row.doc_id === String(form.get("doc_id")) && row.version === String(form.get("version")));
                  if (created) setSelectedId(created.id);
                  toast("Policy draft saved");
                  formEl.reset();
                })).catch((err) => setError(err.message));
              }}>
                <h2 className="text-lg font-semibold">Write a policy version</h2>
                <Field label="Doc ID"><Input name="doc_id" required placeholder="KB-CLAIMS-001" /></Field>
                <Field label="Title"><Input name="title" required /></Field>
                <Field label="Version"><Input name="version" required defaultValue="2026.09" /></Field>
                <Field label="Markdown"><Textarea name="content" required /></Field>
                <div className="sticky bottom-20 bg-surface py-2 md:bottom-0"><Button type="submit">Save draft</Button></div>
              </form>
            )}
          </div>
        }
      />
    </div>
  );
}

function PolicyActions({ policy, readOnly, moduleId, setPolicies, setError }: {
  policy: Policy;
  readOnly: boolean;
  moduleId: string;
  setPolicies: (rows: Policy[]) => void;
  setError: (message: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {!readOnly && policy.status !== "published" && (
        <Button onClick={() => void api(`/policies/${policy.id}/publish`, { method: "POST" }).then(() => api<Policy[]>(`/modules/${moduleId}/policies`).then((rows) => { setPolicies(rows); toast("Policy published"); })).catch((err) => setError(err.message))}>Publish</Button>
      )}
    </div>
  );
}
