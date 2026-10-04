import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/api";
import { Badge, Mono } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, PageHeader } from "@/components/ui/layout";
import { EmptyState, ErrorNote } from "@/components/ui/states";

type Expected = {
  category: string;
  priority: string;
  must_cite_doc_ids?: string[];
  allowed_actions?: string[];
  disallowed_actions?: string[];
  should_escalate: boolean;
};

type Actual = {
  category: string | null;
  priority: string;
  citations: string[];
  recommended_actions: string[];
  should_escalate: boolean;
  llm_called: boolean;
};

type EvalResponse = {
  eval_run_id: string;
  summary: Record<string, number | Record<string, { passed: boolean; notes: string }>>;
  results: {
    case_id: string;
    ticket_id: string;
    input: string;
    expected: Expected;
    actual: Actual;
    passed: boolean;
    notes: string;
    categoryOk?: boolean;
    citesOk?: boolean;
    unsafeOk?: boolean;
    allowedOk?: boolean;
    escalationOk?: boolean;
  }[];
};

const rates = ["triage_accuracy", "citation_coverage", "unsafe_action_block_rate", "allowed_action_recall", "escalation_accuracy", "confidence_gate_hit_rate"];

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

  return (
    <div className="grid gap-4">
      <PageHeader
        title="Score the 8 known customer cases"
        detail="Same pipeline as the queue. Expected labels stay in the eval file, not on tickets."
        action={<Button disabled={busy} onClick={() => void run()}>{busy ? "Scoring..." : "Run the 8 cases"}</Button>}
      />
      <ErrorNote message={error} />
      {!report && <EmptyState title="No score yet" detail="Run the 8 cases to see input, expected, actual, and pass or fail." />}
      {report && (
        <>
          <div className="flex flex-wrap gap-2">
            {rates.map((key) => (
              <Badge key={key} tone="neutral">
                {key.replaceAll("_", " ")} {typeof summary[key] === "number" ? `${Math.round(Number(summary[key]) * 100)}%` : "—"}
              </Badge>
            ))}
          </div>
          <div className="grid gap-3">
            {report.results.map((row) => (
              <Card key={row.case_id} className="grid gap-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Mono>{row.case_id}</Mono>
                    <Badge tone={row.passed ? "safe" : "danger"}>{row.passed ? "pass" : "fail"}</Badge>
                  </div>
                  <Link className="min-h-11 text-sm font-medium" to={`/tickets/${row.ticket_id}`}>{row.ticket_id}</Link>
                </div>
                <p className="text-sm"><span className="text-muted">Input </span>{row.input ?? "—"}</p>
                <p className="text-sm">
                  <span className="text-muted">Expected </span>
                  {row.expected?.category ?? "—"} / {row.expected?.priority ?? "—"}
                  {row.expected?.should_escalate ? " · escalate" : " · no escalate"}
                  {row.expected?.must_cite_doc_ids?.length ? ` · cite ${row.expected.must_cite_doc_ids.join(", ")}` : ""}
                  {row.expected?.allowed_actions?.length ? ` · allow ${row.expected.allowed_actions.join(", ")}` : ""}
                  {row.expected?.disallowed_actions?.length ? ` · block ${row.expected.disallowed_actions.join(", ")}` : ""}
                </p>
                <p className="text-sm">
                  <span className="text-muted">Actual </span>
                  {row.actual?.category ?? "—"} / {row.actual?.priority ?? "—"}
                  {row.actual?.should_escalate ? " · escalate" : " · no escalate"}
                  {row.actual?.citations?.length ? ` · ${row.actual.citations.join(", ")}` : " · no citations"}
                  {row.actual?.recommended_actions?.length ? ` · ${row.actual.recommended_actions.join(", ")}` : " · no tools"}
                  {` · ${row.actual?.llm_called ? "model called" : "model not called"}`}
                </p>
                {row.notes && <p className="text-sm text-muted">{row.notes}</p>}
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
