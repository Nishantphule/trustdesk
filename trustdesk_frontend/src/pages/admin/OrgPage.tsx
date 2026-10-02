import { toast } from "sonner";
import { api } from "@/api";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { useAdmin } from "./context";

export function OrgPage() {
  const { org, readOnly, refresh, setError } = useAdmin();
  if (!org) return <p className="text-sm text-muted">Loading organization settings.</p>;
  return (
    <form
      className="mx-auto grid max-w-xl gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        void api("/org/settings", {
          method: "PATCH",
          body: {
            name: String(form.get("name")),
            confidence_threshold_default: Number(form.get("threshold")),
            auto_send_enabled: false,
            forward_user_escalations: form.get("forward") === "on",
          },
        }).then(() => { toast("Organization settings saved"); return refresh(); }).catch((err) => setError(err.message));
      }}
    >
      <h1 className="text-xl font-semibold">Organization</h1>
      <Field label="Name"><Input name="name" defaultValue={String(org.name ?? "")} disabled={readOnly} /></Field>
      <Field label="Default confidence threshold">
        <Input name="threshold" type="number" step="0.01" min="0.01" max="0.99" defaultValue={Number(org.confidence_threshold_default)} disabled={readOnly} />
      </Field>
      <label className="flex min-h-11 items-center gap-2 text-sm">
        <input name="forward" type="checkbox" defaultChecked={org.forward_user_escalations !== false} disabled={readOnly} />
        Forward user escalations into the owner's Gmail
      </label>
      <p className="text-sm text-muted">Auto-send is off and cannot be enabled. A failed Gmail forward does not un-escalate the ticket.</p>
      {!readOnly && <div className="sticky bottom-20 border-t border-line bg-bg py-3 md:bottom-0"><Button type="submit">Save</Button></div>}
    </form>
  );
}
