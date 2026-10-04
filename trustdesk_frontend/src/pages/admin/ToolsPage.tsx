import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, ListButton, PageHeader, SplitPane } from "@/components/ui/layout";
import { EmptyState } from "@/components/ui/states";
import { useAdmin } from "./context";

export function ToolsPage() {
  const { catalog, modules, readOnly, refresh, setError } = useAdmin();
  const [selectedKey, setSelectedKey] = useState("");
  const selected = catalog.tools.find((tool) => tool.key === selectedKey) ?? catalog.tools[0] ?? null;

  useEffect(() => {
    if (!catalog.tools.some((tool) => tool.key === selectedKey)) {
      setSelectedKey(catalog.tools[0]?.key ?? "");
    }
  }, [catalog.tools, selectedKey]);

  return (
    <div className="grid gap-4">
      <PageHeader title="Tools" detail="Enable a catalog tool on a module before triage can propose it." />
      <SplitPane
        list={
          <Card className="grid gap-1 p-2">
            {catalog.tools.length === 0 && <EmptyState title="No tools in the catalog" detail="Seed the org so the catalog exists." />}
            {catalog.tools.map((tool) => (
              <ListButton key={tool.key} active={selected?.key === tool.key} onClick={() => setSelectedKey(tool.key)}>
                <span className="flex items-center justify-between gap-2">
                  <strong>{tool.key}</strong>
                  <Badge tone={tool.risk_level === "high" ? "urgent" : tool.risk_level}>{tool.risk_level}</Badge>
                </span>
                <span className="text-muted">approver {tool.required_role}</span>
              </ListButton>
            ))}
          </Card>
        }
        editor={
          selected ? (
            <Card className="grid gap-3">
              <div>
                <h2 className="text-lg font-semibold">{selected.key}</h2>
                <p className="mt-1 text-sm text-muted">Risk {selected.risk_level}. Approver {selected.required_role}.</p>
              </div>
              {!readOnly && (
                <div className="grid gap-2">
                  {modules.filter((mod) => mod.status === "active").map((mod) => {
                    const enabled = catalog.module_tools.some((row) => row.module_id === mod.id && row.tool_key === selected.key && row.enabled);
                    return (
                      <div key={mod.id} className="flex min-h-11 items-center justify-between gap-3 rounded-card border border-line px-3">
                        <span className="text-sm">{mod.name}</span>
                        <Button variant={enabled ? "primary" : "secondary"} onClick={() => void api(`/modules/${mod.id}/tools`, { method: "PATCH", body: { tool_key: selected.key, enabled: !enabled } }).then(() => { toast(`${mod.slug}: ${selected.key} ${enabled ? "off" : "on"}`); return refresh(); }).catch((err) => setError(err.message))}>
                          {enabled ? "on" : "off"}
                        </Button>
                      </div>
                    );
                  })}
                </div>
              )}
              {readOnly && <p className="text-sm text-muted">Module toggles are read-only for this role.</p>}
            </Card>
          ) : null
        }
      />
    </div>
  );
}
