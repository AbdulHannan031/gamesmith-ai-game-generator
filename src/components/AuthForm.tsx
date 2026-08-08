"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const router = useRouter();
  const search = useSearchParams();
  const idea = search.get("idea");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isSignup = mode === "signup";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const res = await fetch(`/api/auth/${isSignup ? "signup" : "login"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(isSignup ? { email, password, name } : { email, password }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Something went wrong.");

      // Carry a landing-page idea straight through into a new project.
      if (idea) {
        const created = await fetch("/api/games", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: "Untitled game" }),
        });
        const game = await created.json();
        if (created.ok) {
          router.push(`/editor/${game.game.id}?idea=${encodeURIComponent(idea)}`);
          router.refresh();
          return;
        }
      }

      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="w-full max-w-sm" noValidate>
      <h1 className="u-display text-[2rem]">{isSignup ? "Make an account" : "Welcome back"}</h1>
      <p className="mt-2 text-sm text-muted">
        {isSignup
          ? "Your games are saved to your account and you choose what gets published."
          : "Sign in to get back to your games."}
      </p>

      {idea ? (
        <p className="mt-4 rounded-lg border border-line bg-surface px-3 py-2.5 text-[0.8125rem] text-muted">
          Waiting to build: <span className="text-text">{idea}</span>
        </p>
      ) : null}

      <div className="mt-7 space-y-4">
        {isSignup ? (
          <div>
            <label htmlFor="name" className="u-label mb-1.5 block">
              Display name
            </label>
            <input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="field"
              placeholder="Shown on games you publish"
              autoComplete="nickname"
              maxLength={40}
            />
          </div>
        ) : null}

        <div>
          <label htmlFor="email" className="u-label mb-1.5 block">
            Email
          </label>
          <input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="field"
            autoComplete="email"
            inputMode="email"
          />
        </div>

        <div>
          <label htmlFor="password" className="u-label mb-1.5 block">
            Password
          </label>
          <input
            id="password"
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="field"
            autoComplete={isSignup ? "new-password" : "current-password"}
          />
          {isSignup ? <p className="mt-1.5 text-[0.75rem] text-dim">At least 8 characters.</p> : null}
        </div>
      </div>

      {error ? (
        <p role="alert" className="mt-4 text-[0.8125rem] text-danger">
          {error}
        </p>
      ) : null}

      <button type="submit" className="btn btn-primary mt-6 w-full" disabled={busy}>
        {busy ? "One moment…" : isSignup ? "Create account" : "Sign in"}
      </button>

      <p className="mt-5 text-[0.8125rem] text-muted">
        {isSignup ? "Already have an account? " : "No account yet? "}
        <Link
          href={isSignup ? "/login" : "/signup"}
          className="text-amber underline-offset-4 hover:underline"
        >
          {isSignup ? "Sign in" : "Make one"}
        </Link>
      </p>
    </form>
  );
}
