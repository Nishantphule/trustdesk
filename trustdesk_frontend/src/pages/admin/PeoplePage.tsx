import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@/api";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { Card, ListButton, PageHeader, SplitPane } from "@/components/ui/layout";
import { useAdmin } from "./context";

export function PeoplePage() {
  const { teams, users, readOnly, refresh, setError } = useAdmin();
  const [selectedId, setSelectedId] = useState("");
  const [pane, setPane] = useState<"user" | "invite" | "team">("user");
  const selected = users.find((user) => user.id === selectedId) ?? users[0] ?? null;

  useEffect(() => {
    if (pane !== "user") return;
    if (!users.some((user) => user.id === selectedId)) {
      setSelectedId(users[0]?.id ?? "");
    }
  }, [users, selectedId, pane]);

  return (
    <div className="grid gap-4">
      <PageHeader title="People" detail="Users and teams for this organization." />
      <SplitPane
        list={
          <Card className="grid gap-1 p-2">
            {teams.length > 0 && <p className="px-3 py-1 text-xs text-muted">{teams.map((team) => team.name).join(" · ")}</p>}
            {users.map((user) => (
              <ListButton key={user.id} active={pane === "user" && selected?.id === user.id} onClick={() => { setPane("user"); setSelectedId(user.id); }}>
                <strong>{user.name}</strong>
                <span className="text-muted">{user.role} · {user.email}</span>
              </ListButton>
            ))}
            {!readOnly && (
              <>
                <ListButton active={pane === "invite"} onClick={() => setPane("invite")}>
                  <strong>Invite user</strong>
                  <span className="text-muted">Agent, supervisor, or admin</span>
                </ListButton>
                <ListButton active={pane === "team"} onClick={() => setPane("team")}>
                  <strong>New team</strong>
                  <span className="text-muted">Group people for mailbox ownership</span>
                </ListButton>
              </>
            )}
          </Card>
        }
        editor={
          <div className="grid gap-4">
            {pane === "user" && selected && (
              <Card className="grid gap-3">
                <div>
                  <h2 className="text-lg font-semibold">{selected.name}</h2>
                  <p className="mt-1 text-sm text-muted">{selected.email}</p>
                </div>
                <p className="text-sm capitalize">{selected.role}</p>
              </Card>
            )}
            {pane === "invite" && !readOnly && (
              <form className="grid gap-3 rounded-card border border-line bg-surface p-4 shadow-card" onSubmit={(event) => {
                event.preventDefault();
                const form = new FormData(event.currentTarget);
                void api("/users", { method: "POST", body: { name: String(form.get("name")), email: String(form.get("email")), password: String(form.get("password")), role: String(form.get("role")), team_id: teams[0]?.id ?? null } }).then(() => { toast("User created"); setPane("user"); return refresh(); }).catch((err) => setError(err.message));
              }}>
                <h2 className="text-lg font-semibold">Invite user</h2>
                <Field label="Name"><Input name="name" required /></Field>
                <Field label="Email"><Input name="email" type="email" required /></Field>
                <Field label="Password"><Input name="password" type="password" required minLength={8} autoComplete="new-password" /></Field>
                <Field label="Role"><Select name="role"><option>agent</option><option>supervisor</option><option>admin</option></Select></Field>
                <Button type="submit">Create user</Button>
              </form>
            )}
            {pane === "team" && !readOnly && (
              <form className="grid gap-3 rounded-card border border-line bg-surface p-4 shadow-card" onSubmit={(event) => {
                event.preventDefault();
                const form = new FormData(event.currentTarget);
                void api("/teams", { method: "POST", body: { name: String(form.get("name")) } }).then(() => { toast("Team created"); setPane("user"); return refresh(); }).catch((err) => setError(err.message));
              }}>
                <h2 className="text-lg font-semibold">New team</h2>
                <Field label="Name"><Input name="name" required /></Field>
                <div className="sticky bottom-20 bg-surface py-2 md:bottom-0"><Button type="submit">Create team</Button></div>
              </form>
            )}
          </div>
        }
      />
    </div>
  );
}
