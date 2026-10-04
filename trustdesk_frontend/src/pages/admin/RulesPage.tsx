import { toast } from "sonner";
import { api } from "@/api";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Card, PageHeader } from "@/components/ui/layout";
import { useAdmin } from "./context";

export function RulesPage() {
  const { rules, readOnly, refresh, setError } = useAdmin();
  if (!rules) return <p className="text-sm text-muted">Loading rule settings.</p>;
  return (
    <form className="mx-auto grid max-w-xl gap-4" onSubmit={(event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      void api("/rule-settings", {
        method: "PATCH",
        body: {
          extra_patterns: String(form.get("patterns")).split("\n").map((line) => line.trim()).filter(Boolean),
          confidence_threshold_default: Number(form.get("threshold")),
        },
      }).then(() => { toast("Settings saved"); return refresh(); }).catch((err) => setError(err.message));
    }}>
      <PageHeader title="Rules" detail="Retrieval threshold and extra block patterns." />
      <Card className="grid gap-3">
      <Field label="Default threshold"><Input name="threshold" type="number" step="0.01" defaultValue={rules.confidence_threshold_default} disabled={readOnly} /></Field>
      <Field label="Extra patterns, one per line"><Textarea name="patterns" defaultValue={(rules.extra_patterns ?? []).join("\n")} disabled={readOnly} /></Field>
      {!readOnly && <div className="sticky bottom-20 border-t border-line bg-surface py-3 md:bottom-0"><Button type="submit">Save tuning</Button></div>}
      </Card>
    </form>
  );
}
