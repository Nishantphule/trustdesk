import { toast } from "sonner";
import { api } from "@/api";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Card, PageHeader } from "@/components/ui/layout";
import { useAdmin } from "./context";

export function OrgPage() {
  const { org, readOnly, refresh, setError } = useAdmin();
  if (!org) return <p className="text-sm text-muted">Loading organization settings.</p>;
  return (
    <form
      className="mx-auto grid max-w-xl gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        void api("/org/settings", {
          method: "PATCH",
          body: {
            name: String(form.get("name")),
            confidence_threshold_default: Number(form.get("threshold")),
            auto_send_enabled: false,
          },
        }).then(() => { toast("Organization settings saved"); return refresh(); }).catch((err) => setError(err.message));
      }}
    >
      <PageHeader title="Organization" detail="Name and default retrieval threshold." />
      <Card className="grid gap-3">
      <Field label="Name"><Input name="name" defaultValue={String(org.name ?? "")} disabled={readOnly} /></Field>
      <Field label="Default confidence threshold">
        <Input name="threshold" type="number" step="0.01" min="0.01" max="0.99" defaultValue={Number(org.confidence_threshold_default)} disabled={readOnly} />
      </Field>
      {!readOnly && <div className="sticky bottom-20 border-t border-line bg-surface py-3 md:bottom-0"><Button type="submit">Save</Button></div>}
      </Card>
    </form>
  );
}
