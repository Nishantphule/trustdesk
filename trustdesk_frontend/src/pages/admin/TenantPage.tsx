import { toast } from "sonner";
import { api, currentUser } from "@/api";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { useAdmin } from "./context";

export function TenantPage() {
  const { setError } = useAdmin();
  if (currentUser()?.role !== "admin") return <p className="text-sm text-muted">Only an admin can create another organization.</p>;
  return (
    <form className="mx-auto grid max-w-xl gap-3" onSubmit={(event) => {
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
      }).then((created) => toast(`Created ${(created as { name: string }).name}. Sign in as the new admin to configure modules. This session still belongs to the current org.`)).catch((err) => setError(err.message));
    }}>
      <h1 className="text-xl font-semibold">New tenant</h1>
      <p className="text-sm text-muted">Example: Northwind Mutual, module Claims, then publish a policy and ingest a demo email while signed in as that admin.</p>
      <Field label="Organization name"><Input name="name" defaultValue="Northwind Mutual" /></Field>
      <Field label="Slug"><Input name="slug" defaultValue="northwind-mutual" /></Field>
      <Field label="Admin name"><Input name="admin" defaultValue="Northwind Admin" /></Field>
      <Field label="Admin email"><Input name="email" type="email" defaultValue="admin@northwind.example" /></Field>
      <Field label="Password"><Input name="password" defaultValue="TrustDesk123!" /></Field>
      <Field label="Confidence threshold"><Input name="threshold" type="number" step="0.01" defaultValue={0.2} /></Field>
      <div className="sticky bottom-20 border-t border-line bg-bg py-3 md:bottom-0"><Button type="submit">Create organization</Button></div>
    </form>
  );
}
