import { toast } from "sonner";
import { api, currentUser } from "@/api";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { useAdmin } from "./context";

export function PeoplePage() {
  const { teams, users, readOnly, refresh, setError, connectGmail } = useAdmin();
  const me = currentUser();
  return (
    <div className="grid gap-4">
      <h1 className="text-xl font-semibold">People</h1>
      <ul className="text-sm">{teams.map((team) => <li key={team.id}>{team.name}</li>)}</ul>
      <div className="hidden md:block">
        <table className="w-full text-sm">
          <thead className="text-left text-muted"><tr><th className="py-2">Name</th><th>Email</th><th>Role</th><th></th></tr></thead>
          <tbody>{users.map((user) => <UserRow key={user.id} user={user} />)}</tbody>
        </table>
      </div>
      <div className="grid gap-3 md:hidden">{users.map((user) => <article key={user.id} className="rounded-md border border-line bg-surface p-3"><UserRow user={user} stacked /></article>)}</div>
      {!readOnly && (
        <form className="grid gap-3 rounded-md border border-line bg-surface p-4" onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          void api("/users", { method: "POST", body: { name: String(form.get("name")), email: String(form.get("email")), password: String(form.get("password")), role: String(form.get("role")), team_id: teams[0]?.id ?? null } }).then(() => { toast("User created"); return refresh(); }).catch((err) => setError(err.message));
        }}>
          <h2 className="text-lg font-semibold">Invite user</h2>
          <Field label="Name"><Input name="name" required /></Field>
          <Field label="Email"><Input name="email" type="email" required /></Field>
          <Field label="Password"><Input name="password" required minLength={8} /></Field>
          <Field label="Role"><Select name="role"><option>agent</option><option>supervisor</option><option>admin</option></Select></Field>
          <Button type="submit">Create user</Button>
        </form>
      )}
      {!readOnly && (
        <form className="grid gap-3 rounded-md border border-line bg-surface p-4" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void api("/teams", { method: "POST", body: { name: String(form.get("name")) } }).then(() => { toast("Team created"); return refresh(); }).catch((err) => setError(err.message)); }}>
          <h2 className="text-lg font-semibold">New team</h2>
          <Field label="Name"><Input name="name" required /></Field>
          <div className="sticky bottom-20 bg-surface py-2 md:bottom-0"><Button type="submit">Create team</Button></div>
        </form>
      )}
    </div>
  );

  function UserRow({ user, stacked }: { user: { id: string; name: string; email: string; role: string }; stacked?: boolean }) {
    const self = me && (me.role === "admin" || me.role === "supervisor") && user.id === me.id && (user.role === "admin" || user.role === "supervisor");
    const connect = self ? <Button variant="secondary" onClick={() => void connectGmail("user", me.id).catch((err) => setError(err.message))}>Connect personal Gmail as escalation target</Button> : null;
    if (stacked) return <div className="grid gap-1"><strong>{user.name}</strong><span className="text-sm text-muted">{user.email}</span><span className="text-sm">{user.role}</span>{connect}</div>;
    return <tr className="border-t border-line"><td className="py-2">{user.name}</td><td>{user.email}</td><td>{user.role}</td><td>{connect}</td></tr>;
  }
}
