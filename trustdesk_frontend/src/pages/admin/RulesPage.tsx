import { toast } from "sonner";
import { api } from "@/api";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { useAdmin } from "./context";

export function RulesPage() {
  const { rules, readOnly, refresh, setError } = useAdmin();
  if (!rules) return <p className="text-sm text-muted">Loading rule settings.</p>;
  return (
    <form className="mx-auto grid max-w-xl gap-3" onSubmit={(event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      void api("/rule-settings", {
        method: "PATCH",
        body: {
          extra_patterns: String(form.get("patterns")).split("\n").map((line) => line.trim()).filter(Boolean),
          confidence_threshold_default: Number(form.get("threshold")),
        },
      }).then(() => { toast("Threshold and extra patterns saved. The gate and rule layer stay on."); return refresh(); }).catch((err) => setError(err.message));
    }}>
      <h1 className="text-xl font-semibold">Rule layer and confidence gate</h1>
      <p className="text-sm text-muted">These controls cannot be switched off. You can tune the threshold and add patterns.</p>
      <Field label="Default threshold"><Input name="threshold" type="number" step="0.01" defaultValue={rules.confidence_threshold_default} disabled={readOnly} /></Field>
      <Field label="Extra patterns, one per line"><Textarea name="patterns" defaultValue={(rules.extra_patterns ?? []).join("\n")} disabled={readOnly} /></Field>
      {!readOnly && <div className="sticky bottom-20 border-t border-line bg-bg py-3 md:bottom-0"><Button type="submit">Save tuning</Button></div>}
    </form>
  );
}
