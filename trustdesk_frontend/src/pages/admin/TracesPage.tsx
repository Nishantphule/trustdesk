import { useEffect } from "react";
import { Link } from "react-router-dom";
import { Badge, Mono } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/states";
import { useAdmin } from "./context";

export function TracesPage() {
  const { traces, loadTraces, setError } = useAdmin();
  useEffect(() => { void loadTraces().catch((err) => setError(err.message)); }, [loadTraces, setError]);
  return (
    <div className="grid gap-3">
      <h1 className="text-xl font-semibold">Traces</h1>
      {traces.length === 0 && <EmptyState title="No traces yet" detail="Open a ticket and run triage. Each run records the gate, the rules, and whether the model was called." />}
      <div className="hidden md:block">
        <table className="w-full text-sm">
          <thead className="text-left text-muted"><tr><th className="py-2">Run</th><th>Ticket</th><th>Module</th><th>Gate</th><th>Rules</th><th>Model</th></tr></thead>
          <tbody>{traces.map((trace) => <TraceLine key={trace.id} trace={trace} />)}</tbody>
        </table>
      </div>
      <div className="grid gap-3 md:hidden">{traces.map((trace) => <article key={trace.id} className="rounded-md border border-line bg-surface p-3"><TraceLine trace={trace} stacked /></article>)}</div>
    </div>
  );
}

function TraceLine({ trace, stacked }: { trace: ReturnType<typeof useAdmin>["traces"][number]; stacked?: boolean }) {
  const gate = <Badge tone={trace.confidence_gate_result === "pass" ? "safe" : "danger"}>{trace.confidence_gate_result}</Badge>;
  const rules = <Badge tone={trace.rule_layer_result === "blocked" ? "danger" : "neutral"}>{trace.rule_layer_result}</Badge>;
  if (stacked) {
    return <div className="grid gap-1 text-sm"><Mono>{trace.id}</Mono><Link to={`/tickets/${trace.ticket_id}`} className="font-medium">{trace.ticket_id}</Link><span className="text-muted">{trace.subject}</span><span>{trace.module_slug}</span><div className="flex gap-2">{gate}{rules}</div><span>{trace.llm_called ? "Model called" : "Model not called"}</span></div>;
  }
  return <tr className="border-t border-line"><td className="py-2"><Mono>{trace.id}</Mono></td><td><Link to={`/tickets/${trace.ticket_id}`}>{trace.ticket_id}</Link><div className="text-xs text-muted">{trace.subject}</div></td><td>{trace.module_slug}</td><td>{gate}</td><td>{rules}</td><td>{trace.llm_called ? "called" : "not called"}</td></tr>;
}
