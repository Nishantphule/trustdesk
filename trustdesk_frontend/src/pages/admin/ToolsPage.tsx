import { toast } from "sonner";
import { api } from "@/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/states";
import { useAdmin } from "./context";

export function ToolsPage() {
  const { catalog, modules, readOnly, refresh, setError } = useAdmin();
  return (
    <div className="grid gap-3">
      <h1 className="text-xl font-semibold">Tools</h1>
      {catalog.tools.length === 0 && <EmptyState title="No tools in the catalog" detail="The seed loads the retail tool catalog. Create a tenant only after that catalog exists." />}
      {catalog.tools.map((tool) => (
        <article key={tool.key} className="grid gap-2 rounded-md border border-line bg-surface p-3">
          <div className="flex flex-wrap items-center gap-2">
            <strong>{tool.key}</strong>
            <Badge tone={tool.risk_level === "high" ? "urgent" : tool.risk_level}>{tool.risk_level}</Badge>
            <span className="text-sm text-muted">approver {tool.required_role}</span>
          </div>
          {!readOnly && (
            <div className="flex flex-wrap gap-2">
              {modules.filter((mod) => mod.status === "active").map((mod) => {
                const enabled = catalog.module_tools.some((row) => row.module_id === mod.id && row.tool_key === tool.key && row.enabled);
                return (
                  <Button key={mod.id} variant={enabled ? "primary" : "secondary"} onClick={() => void api(`/modules/${mod.id}/tools`, { method: "PATCH", body: { tool_key: tool.key, enabled: !enabled } }).then(() => { toast(`${mod.slug}: ${tool.key} ${enabled ? "off" : "on"}`); return refresh(); }).catch((err) => setError(err.message))}>
                    {mod.slug}: {enabled ? "on" : "off"}
                  </Button>
                );
              })}
            </div>
          )}
        </article>
      ))}
    </div>
  );
}
