import { useState } from "react";
import { toast } from "sonner";
import { api } from "@/api";
import { Badge, Mono } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/states";
import { useAdmin, type Policy } from "./context";

type History = { id: string; version: string; status: string };
type Diff = { from: string; to: string; added: string[]; removed: string[] };

export function PoliciesPage() {
  const { modules, moduleId, setModuleId, policies, setPolicies, readOnly, setError } = useAdmin();
  const [history, setHistory] = useState<History[]>([]);
  const [diff, setDiff] = useState<Diff | null>(null);
  const [against, setAgainst] = useState("");
  const [activeId, setActiveId] = useState("");

  async function openHistory(policy: Policy) {
    const rows = await api<History[]>(`/policies/${policy.id}/history`);
    setHistory(rows);
    setActiveId(policy.id);
    setDiff(null);
    const other = rows.find((row) => row.id !== policy.id);
    setAgainst(other?.id ?? "");
    toast(rows.map((row) => `${row.version} (${row.status})`).join(" → ") || "No earlier versions");
  }

  async function loadDiff() {
    if (!activeId || !against) return;
    setDiff(await api<Diff>(`/policies/${activeId}/diff?against=${against}`));
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-xl font-semibold">Policies</h1>
        <Field label="Module">
          <Select value={moduleId} onChange={(e) => setModuleId(e.target.value)} aria-label="Policy module">
            {modules.map((mod) => <option key={mod.id} value={mod.id}>{mod.name}</option>)}
          </Select>
        </Field>
      </div>
      {policies.length === 0 && <EmptyState title="No policies in this module" detail="Write a version below, then publish it so retrieval can cite it." />}
      <div className="hidden md:block">
        <table className="w-full text-sm">
          <thead className="text-left text-muted"><tr><th className="py-2">Doc</th><th>Title</th><th>Version</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {policies.map((policy) => (
              <tr key={policy.id} className="border-t border-line">
                <td className="py-2"><Mono>{policy.doc_id}</Mono></td>
                <td>{policy.title}</td>
                <td>{policy.version}</td>
                <td><Badge tone={policy.status === "published" ? "safe" : "neutral"}>{policy.status}</Badge></td>
                <td className="flex gap-2 py-2"><PolicyActions policy={policy} readOnly={readOnly} moduleId={moduleId} setPolicies={setPolicies} setError={setError} onHistory={openHistory} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="grid gap-3 md:hidden">
        {policies.map((policy) => (
          <article key={policy.id} className="grid gap-2 rounded-md border border-line bg-surface p-3">
            <Mono>{policy.doc_id}</Mono>
            <strong>{policy.title}</strong>
            <p className="text-sm text-muted">{policy.version}</p>
            <Badge tone={policy.status === "published" ? "safe" : "neutral"}>{policy.status}</Badge>
            <PolicyActions policy={policy} readOnly={readOnly} moduleId={moduleId} setPolicies={setPolicies} setError={setError} onHistory={openHistory} />
          </article>
        ))}
      </div>
      {history.length > 0 && (
        <section className="grid gap-3 rounded-md border border-line bg-surface p-4">
          <h2 className="text-lg font-semibold">Version diff</h2>
          <Field label="Compare the selected version with">
            <Select value={against} onChange={(e) => setAgainst(e.target.value)}>
              {history.filter((row) => row.id !== activeId).map((row) => <option key={row.id} value={row.id}>{row.version} ({row.status})</option>)}
            </Select>
          </Field>
          <Button variant="secondary" disabled={!against} onClick={() => void loadDiff().catch((err) => setError(err.message))}>Show diff</Button>
          {!against && <p className="text-sm text-muted">Only one version is stored, so there is nothing to compare yet.</p>}
          {diff && (
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <p className="text-sm font-medium text-danger">Removed from {diff.from}</p>
                {diff.removed.length === 0 && <p className="text-sm text-muted">No removed lines.</p>}
                {diff.removed.map((line) => <p key={line} className="font-mono text-xs">{line}</p>)}
              </div>
              <div>
                <p className="text-sm font-medium text-safe">Added in {diff.to}</p>
                {diff.added.length === 0 && <p className="text-sm text-muted">No added lines.</p>}
                {diff.added.map((line) => <p key={line} className="font-mono text-xs">{line}</p>)}
              </div>
            </div>
          )}
        </section>
      )}
      {!readOnly && (
        <form className="grid gap-3 rounded-md border border-line bg-surface p-4" onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          void api(`/modules/${moduleId}/policies`, {
            method: "POST",
            body: {
              doc_id: String(form.get("doc_id")),
              title: String(form.get("title")),
              version: String(form.get("version")),
              content_md: String(form.get("content")),
              audience: "external",
            },
          }).then(() => api<Policy[]>(`/modules/${moduleId}/policies`).then((rows) => { setPolicies(rows); toast("Policy draft saved"); })).catch((err) => setError(err.message));
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
  );
}

function PolicyActions({ policy, readOnly, moduleId, setPolicies, setError, onHistory }: {
  policy: Policy;
  readOnly: boolean;
  moduleId: string;
  setPolicies: (rows: Policy[]) => void;
  setError: (message: string) => void;
  onHistory: (policy: Policy) => Promise<void>;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="secondary" onClick={() => void onHistory(policy).catch((err) => setError(err.message))}>History</Button>
      {!readOnly && policy.status !== "published" && (
        <Button onClick={() => void api(`/policies/${policy.id}/publish`, { method: "POST" }).then(() => api<Policy[]>(`/modules/${moduleId}/policies`).then((rows) => { setPolicies(rows); toast("Policy published"); })).catch((err) => setError(err.message))}>Publish</Button>
      )}
    </div>
  );
}
