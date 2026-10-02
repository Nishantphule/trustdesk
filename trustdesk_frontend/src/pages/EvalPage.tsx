import { useState } from "react";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "@/api";
import { Badge, Mono } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorNote } from "@/components/ui/states";

type EvalResponse = {
  eval_run_id: string;
  summary: Record<string, number | Record<string, { passed: boolean; notes: string }>>;
  results: {
    case_id: string;
    ticket_id: string;
    passed: boolean;
    notes: string;
    actual: { category: string | null; priority: string; citations: string[]; recommended_actions: string[]; should_escalate: boolean; llm_called: boolean };
  }[];
};

const metrics = ["triage_accuracy", "citation_coverage", "unsafe_action_block_rate", "allowed_action_recall", "escalation_accuracy", "confidence_gate_hit_rate"];

export function EvalPage() {
  const [report, setReport] = useState<EvalResponse | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    setError("");
    try {
      setReport(await api<EvalResponse>("/eval-runs", { method: "POST" }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Eval did not finish. Run it again.");
    } finally {
      setBusy(false);
    }
  }

  const summary = report?.summary ?? {};
  const chart = metrics.map((key) => ({
    name: key.replaceAll("_", " "),
    rate: typeof summary[key] === "number" ? Math.round(Number(summary[key]) * 100) : 0,
  }));

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Evaluation</h1>
        <Button disabled={busy} onClick={() => void run()}>{busy ? "Running..." : "Run eval_cases.jsonl"}</Button>
      </div>
      <p className="text-sm text-muted">The runner uses the deterministic mock adapter so scores do not depend on a network model. Expected labels are read only here.</p>
      <ErrorNote message={error} />
      {!report && <EmptyState title="No eval report yet" detail="Run eval_cases.jsonl to score triage, citations, blocked actions, and the confidence gate." />}
      {report && (
        <>
          <div className="h-64 rounded-md border border-line bg-surface p-3">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chart} margin={{ left: 0, right: 8, top: 8, bottom: 32 }}>
                <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-25} textAnchor="end" height={60} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
                <Tooltip formatter={(value) => [`${value}%`, "Rate"]} />
                <Bar dataKey="rate" fill="var(--accent-ink)" radius={2} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="hidden md:block">
            <table className="w-full text-sm">
              <thead className="text-left text-muted"><tr><th className="py-2">Case</th><th>Ticket</th><th>Result</th><th>Category</th><th>Citations</th><th>Actions</th><th>Notes</th></tr></thead>
              <tbody>
                {report.results.map((row) => (
                  <tr key={row.case_id} className="border-t border-line">
                    <td className="py-2"><Mono>{row.case_id}</Mono></td>
                    <td><Mono>{row.ticket_id}</Mono></td>
                    <td><Badge tone={row.passed ? "safe" : "danger"}>{row.passed ? "pass" : "fail"}</Badge></td>
                    <td>{row.actual.category} / {row.actual.priority}</td>
                    <td>{row.actual.citations.join(", ")}</td>
                    <td>{row.actual.recommended_actions.join(", ")}</td>
                    <td>{row.notes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="grid gap-3 md:hidden">
            {report.results.map((row) => (
              <article key={row.case_id} className="grid gap-1 rounded-md border border-line bg-surface p-3 text-sm">
                <div className="flex items-center justify-between"><Mono>{row.case_id}</Mono><Badge tone={row.passed ? "safe" : "danger"}>{row.passed ? "pass" : "fail"}</Badge></div>
                <Mono>{row.ticket_id}</Mono>
                <p>{row.actual.category} / {row.actual.priority}</p>
                <p>Citations: {row.actual.citations.join(", ") || "none"}</p>
                <p>Actions: {row.actual.recommended_actions.join(", ") || "none"}</p>
                <p className="text-muted">{row.notes}</p>
              </article>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
