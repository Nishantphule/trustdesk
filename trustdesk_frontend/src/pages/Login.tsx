import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, setSession, type User } from "@/api";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Card } from "@/components/ui/layout";
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
    <div className="grid h-dvh place-items-center overflow-y-auto bg-bg px-4">
      <div className="absolute inset-x-0 top-0 h-48 bg-raised" />
      <Card className="relative grid w-full max-w-md gap-3 p-6">
        <form className="grid gap-3" onSubmit={submit}>
          <div className="flex items-center gap-2">
            <span className="grid size-8 place-items-center rounded-card bg-accent-ink text-xs font-semibold text-white dark:bg-accent dark:text-[#0f1115]">TD</span>
            <h1 className="text-2xl font-semibold tracking-tight">TrustDesk</h1>
          </div>
          <p className="text-sm text-muted">Drafts from policy. A person approves order changes.</p>
          <Field label="Email"><Input value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" /></Field>
          <Field label="Password"><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" /></Field>
          <ErrorNote message={error} />
          <Button type="submit">Sign in</Button>
        </form>
      </Card>
    </div>
  );
}
