import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { Navigate, Outlet, useSearchParams } from "react-router-dom";
import { api, currentUser } from "@/api";

export type Module = {
  id: string;
  name: string;
  slug: string;
  description: string;
  keywords: string[];
  sla_first_response_mins: number;
  confidence_threshold_override: number | null;
  status: string;
  escalation_mailbox_id: string | null;
};

export type Policy = { id: string; doc_id: string; title: string; version: string; status: string; content_md?: string };
export type Mailbox = {
  id: string;
  address: string;
  provider: string;
  signature: string;
  tone: string;
  status: string;
  module_default_id: string | null;
  owner_type: string;
  owner_id: string | null;
  owner_name: string | null;
  is_escalation_target: boolean;
  escalation_priority: number | null;
};
export type Team = { id: string; name: string };
export type OrgUser = { id: string; email: string; name: string; role: string };
export type TraceRow = { id: string; ticket_id: string; run_type: string; rule_layer_result: string; confidence_gate_result: string; module_slug: string | null; subject: string | null; llm_called: boolean };
export type Catalog = { tools: { key: string; risk_level: string; required_role: string }[]; module_tools: { module_id: string; tool_key: string; enabled: boolean }[] };
export type Rules = { extra_patterns: string[]; confidence_threshold_default?: number; can_disable: boolean };

type AdminState = {
  readOnly: boolean;
  error: string;
  setError: (message: string) => void;
  org: Record<string, unknown> | null;
  modules: Module[];
  moduleId: string;
  setModuleId: (id: string) => void;
  policies: Policy[];
  setPolicies: (rows: Policy[]) => void;
  mailboxes: Mailbox[];
  catalog: Catalog;
  teams: Team[];
  users: OrgUser[];
  traces: TraceRow[];
  loadTraces: () => Promise<void>;
  rules: Rules | null;
  refresh: () => Promise<void>;
  connectGmail: (ownerType: string, ownerId?: string) => Promise<void>;
};

const AdminContext = createContext<AdminState | null>(null);

export function useAdmin() {
  const value = useContext(AdminContext);
  if (!value) throw new Error("Admin data is unavailable");
  return value;
}

const tabs = ["org", "modules", "policies", "mailboxes", "tools", "rules", "people", "traces", "tenant"];

export function AdminRedirect() {
  const [params] = useSearchParams();
  const tab = params.get("tab");
  const gmail = params.get("gmail");
  const dest = tab && tabs.includes(tab) ? `/admin/${tab}` : "/admin/org";
  return <Navigate to={gmail ? `${dest}?gmail=${gmail}` : dest} replace />;
}

export function AdminProvider() {
  const me = currentUser();
  const [error, setError] = useState("");
  const [org, setOrg] = useState<Record<string, unknown> | null>(null);
  const [modules, setModules] = useState<Module[]>([]);
  const [moduleId, setModuleId] = useState("");
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [mailboxes, setMailboxes] = useState<Mailbox[]>([]);
  const [catalog, setCatalog] = useState<Catalog>({ tools: [], module_tools: [] });
  const [teams, setTeams] = useState<Team[]>([]);
  const [users, setUsers] = useState<OrgUser[]>([]);
  const [traces, setTraces] = useState<TraceRow[]>([]);
  const [rules, setRules] = useState<Rules | null>(null);

  async function refresh() {
    const [orgRow, moduleRows, mailboxRows, toolRows, teamRows, userRows, ruleRow] = await Promise.all([
      api<Record<string, unknown>>("/org/settings"),
      api<Module[]>("/modules"),
      api<Mailbox[]>("/mailboxes"),
      api<Catalog>("/tool-catalog"),
      api<Team[]>("/teams"),
      api<OrgUser[]>("/users"),
      api<Rules>("/rule-settings"),
    ]);
    setOrg(orgRow);
    setModules(moduleRows);
    setMailboxes(mailboxRows);
    setCatalog(toolRows);
    setTeams(teamRows);
    setUsers(userRows);
    setRules(ruleRow);
    setModuleId((current) => current || moduleRows[0]?.id || "");
  }

  useEffect(() => {
    void refresh().catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    if (!moduleId) return;
    void api<Policy[]>(`/modules/${moduleId}/policies`).then(setPolicies).catch((err) => setError(err.message));
  }, [moduleId]);

  const loadTraces = useCallback(async () => {
    setTraces(await api<TraceRow[]>("/traces"));
  }, []);

  async function connectGmail(ownerType: string, ownerId?: string) {
    const params = new URLSearchParams({ ownerType, mode: "json" });
    if (ownerId) params.set("ownerId", ownerId);
    const result = await api<{ authorization_url: string }>(`/mailboxes/oauth/start?${params}`);
    window.location.href = result.authorization_url;
  }

  const value: AdminState = {
    readOnly: me?.role !== "admin",
    error,
    setError,
    org,
    modules,
    moduleId,
    setModuleId,
    policies,
    setPolicies,
    mailboxes,
    catalog,
    teams,
    users,
    traces,
    loadTraces,
    rules,
    refresh,
    connectGmail,
  };

  return (
    <AdminContext.Provider value={value}>
      {error && <p className="mb-3 text-sm text-danger" role="alert">{error} Reload this page and try again.</p>}
      <Outlet />
    </AdminContext.Provider>
  );
}
