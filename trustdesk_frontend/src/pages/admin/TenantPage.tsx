import { toast } from "sonner";
import { api, currentUser } from "@/api";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Card, PageHeader } from "@/components/ui/layout";
import { useAdmin } from "./context";

export function TenantPage() {
  const { setError } = useAdmin();
  if (currentUser()?.role !== "admin") return <p className="text-sm text-muted">Only an admin can create another organization.</p>;
  return (
    <form className="mx-auto grid max-w-xl gap-4" onSubmit={(event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      void api("/orgs", {
        method: "POST",
        body: {
          name: String(form.get("name")),
          slug: String(form.get("slug")),
          admin_email: String(form.get("email")),
          admin_name: String(form.get("admin")),
          password: String(form.get("password")),
          confidence_threshold_default: Number(form.get("threshold") || 0.2),
        },
      }).then((created) => toast(`Created ${(created as { name: string }).name}`)).catch((err) => setError(err.message));
    }}>
      <PageHeader title="New tenant" detail="Creates another organization. This session stays on the current org." />
      <Card className="grid gap-3">
      <Field label="Organization name"><Input name="name" required /></Field>
      <Field label="Slug"><Input name="slug" required /></Field>
      <Field label="Admin name"><Input name="admin" required /></Field>
      <Field label="Admin email"><Input name="email" type="email" required /></Field>
      <Field label="Password"><Input name="password" type="password" required minLength={8} autoComplete="new-password" /></Field>
      <Field label="Confidence threshold"><Input name="threshold" type="number" step="0.01" defaultValue={0.2} /></Field>
      <div className="sticky bottom-20 border-t border-line bg-surface py-3 md:bottom-0"><Button type="submit">Create organization</Button></div>
      </Card>
    </form>
  );
}
