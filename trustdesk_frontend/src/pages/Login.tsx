import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, setSession, type User } from "@/api";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { ErrorNote } from "@/components/ui/states";

export function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("agent@acme.example");
  const [password, setPassword] = useState("TrustDesk123!");
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    try {
      const result = await api<{ token: string; user: User }>("/auth/login", {
        method: "POST",
        body: { email, password },
      });
      setSession(result.token, result.user);
      navigate("/queue");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed. Check the email and password.");
    }
  }

  return (
    <div className="grid min-h-screen place-items-center bg-bg px-4">
      <form className="grid w-full max-w-md gap-3 rounded-md border border-line bg-surface p-5" onSubmit={submit}>
        <h1 className="text-2xl font-semibold">TrustDesk</h1>
        <p className="text-sm text-muted">AI drafts the reply. A person approves anything that changes an order.</p>
        <Field label="Email"><Input value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" /></Field>
        <Field label="Password"><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" /></Field>
        <ErrorNote message={error} />
        <Button type="submit">Sign in</Button>
        <p className="text-xs text-muted">Demo: agent@, supervisor@, or admin@ acme.example / TrustDesk123!</p>
      </form>
    </div>
  );
}
