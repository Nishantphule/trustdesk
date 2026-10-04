import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Badge, Mono } from "@/components/ui/badge";
import { Card, ListButton, PageHeader, SplitPane } from "@/components/ui/layout";
import { EmptyState } from "@/components/ui/states";
import { useAdmin } from "./context";

export function TracesPage() {
  const { traces, loadTraces, setError } = useAdmin();
  const [selectedId, setSelectedId] = useState("");
  const selected = traces.find((trace) => trace.id === selectedId) ?? traces[0] ?? null;

  useEffect(() => { void loadTraces().catch((err) => setError(err.message)); }, [loadTraces, setError]);
  useEffect(() => {
    if (!traces.some((trace) => trace.id === selectedId)) {
      setSelectedId(traces[0]?.id ?? "");
    }
  }, [traces, selectedId]);

  return (
    <div className="grid gap-4">
      <PageHeader title="Traces" detail="Gate, rules, retrieval, and whether the model was called." />
      <SplitPane
        list={
          <Card className="grid gap-1 p-2">
            {traces.length === 0 && <EmptyState title="No traces yet" detail="Run triage on a ticket." />}
            {traces.map((trace) => (
              <ListButton key={trace.id} active={selected?.id === trace.id} onClick={() => setSelectedId(trace.id)}>
                <span className="flex items-center justify-between gap-2">
                  <Mono>{trace.id.slice(0, 8)}</Mono>
                  <Badge tone={trace.confidence_gate_result === "pass" ? "safe" : "danger"}>{trace.confidence_gate_result}</Badge>
                </span>
                <span className="truncate text-muted">{trace.subject || trace.ticket_id}</span>
              </ListButton>
            ))}
          </Card>
        }
        editor={
          selected ? (
            <Card className="grid gap-3">
              <div>
                <h2 className="text-lg font-semibold">Run {selected.id}</h2>
                <p className="mt-1 text-sm text-muted">{selected.subject || "No subject"}</p>
              </div>
              <p className="text-sm">Ticket <Link to={`/tickets/${selected.ticket_id}`} className="font-medium">{selected.ticket_id}</Link></p>
              <p className="text-sm text-muted">Module {selected.module_slug ?? "unclassified"}</p>
              <div className="flex flex-wrap gap-2">
                <Badge tone={selected.confidence_gate_result === "pass" ? "safe" : "danger"}>{selected.confidence_gate_result}</Badge>
                <Badge tone={selected.rule_layer_result === "blocked" ? "danger" : "neutral"}>{selected.rule_layer_result}</Badge>
              </div>
              <p className="text-sm">{selected.llm_called ? "Model called" : "Model not called"}</p>
            </Card>
          ) : null
        }
      />
    </div>
  );
}
