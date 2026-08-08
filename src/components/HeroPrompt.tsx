"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { IconSpark } from "./icons";

const IDEAS = [
  "a ninja who grapples between rooftops",
  "top-down survival against waves of slimes",
  "a puzzle game about rerouting steam pipes",
  "one-button endless runner on a neon highway",
  "breakout, but the bricks fight back",
];

export function HeroPrompt({ signedIn }: { signedIn: boolean }) {
  const router = useRouter();
  const [idea, setIdea] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Server and client must agree on the first paint, so the shuffle happens
  // after mount rather than during render.
  const [placeholder, setPlaceholder] = useState(IDEAS[0]);
  useEffect(() => {
    setPlaceholder(IDEAS[Math.floor(Math.random() * IDEAS.length)]);
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const text = idea.trim();
    if (!text || busy) return;

    if (!signedIn) {
      router.push(`/signup?idea=${encodeURIComponent(text)}`);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/games", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Untitled game" }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Could not start a new game.");
      router.push(`/editor/${body.game.id}?idea=${encodeURIComponent(text)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start a new game.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="w-full">
      <label htmlFor="idea" className="u-label mb-2 block">
        Describe a game
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          id="idea"
          value={idea}
          onChange={(e) => setIdea(e.target.value)}
          placeholder={placeholder}
          className="field sm:flex-1"
          maxLength={300}
          autoComplete="off"
        />
        <button type="submit" className="btn btn-primary" disabled={busy || !idea.trim()}>
          <IconSpark className="h-3.5 w-3.5" />
          {busy ? "Starting…" : "Build it"}
        </button>
      </div>
      {error ? (
        <p role="alert" className="mt-2 text-[0.8125rem] text-danger">
          {error}
        </p>
      ) : (
        <p className="mt-2 text-[0.8125rem] text-dim">
          {signedIn ? "Opens a new project with this as the first instruction." : "Free account, then you are straight into the editor."}
        </p>
      )}
    </form>
  );
}
