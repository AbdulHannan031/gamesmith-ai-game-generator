"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { GameCard as Card } from "@/lib/games";
import { IconGlobe, IconLock, IconPlay, IconPlus, IconTrash } from "./icons";

interface Props {
  games: (Card & { drifted: boolean })[];
}

function when(ts: number): string {
  const mins = Math.round((Date.now() - ts) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days < 30 ? `${days}d ago` : new Date(ts).toLocaleDateString();
}

export function DashboardGames({ games }: Props) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function newGame() {
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/games", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Untitled game" }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Could not create a game.");
      router.push(`/editor/${body.game.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create a game.");
      setCreating(false);
    }
  }

  async function remove(id: string) {
    const res = await fetch(`/api/games/${id}`, { method: "DELETE" });
    if (res.ok) {
      setPendingDelete(null);
      router.refresh();
    } else {
      setError("Could not delete that game.");
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="u-display text-[2rem]">Your games</h1>
          <p className="mt-1 text-sm text-muted">
            {games.length ? `${games.length} project${games.length === 1 ? "" : "s"}.` : "Nothing here yet."}
          </p>
        </div>
        <button type="button" onClick={newGame} className="btn btn-primary" disabled={creating}>
          <IconPlus className="h-3.5 w-3.5" />
          {creating ? "Creating…" : "New game"}
        </button>
      </div>

      {error ? (
        <p role="alert" className="mt-4 text-[0.8125rem] text-danger">
          {error}
        </p>
      ) : null}

      {games.length === 0 ? (
        <div className="panel mt-8 grid place-items-center px-6 py-20 text-center">
          <p className="u-display text-xl">Start with a sentence</p>
          <p className="mt-2 max-w-[44ch] text-sm leading-relaxed text-muted">
            Every new project opens with a playable arcade template. Tell the assistant what you want it
            to become and watch it change while you play.
          </p>
          <button type="button" onClick={newGame} className="btn btn-primary mt-6" disabled={creating}>
            <IconPlus className="h-3.5 w-3.5" />
            {creating ? "Creating…" : "New game"}
          </button>
        </div>
      ) : (
        <div className="mt-7 grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
          {games.map((game, i) => {
            const published = game.visibility === "public";
            return (
              <div
                key={game.id}
                className="cabinet rise flex flex-col"
                style={{ ["--hue" as string]: game.hue, animationDelay: `${Math.min(i, 11) * 38}ms` }}
              >
                <Link href={`/editor/${game.id}`} className="screen relative block aspect-[16/10] overflow-hidden">
                  {game.thumbnail ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={game.thumbnail} alt="" className="absolute inset-0 h-full w-full object-cover" />
                  ) : (
                    <div
                      className="absolute inset-0"
                      style={{
                        background: `radial-gradient(120% 100% at 50% 0%, hsl(${game.hue} 55% 20%), #08070a 70%)`,
                      }}
                    />
                  )}
                </Link>

                <div className="cabinet-glow" />

                <div className="relative flex flex-1 flex-col border-t border-line p-3.5">
                  <Link href={`/editor/${game.id}`} className="min-w-0">
                    <h2
                      className="u-marquee truncate text-[0.9375rem]"
                      style={{ color: `hsl(${game.hue} 80% 78%)` }}
                    >
                      {game.title}
                    </h2>
                  </Link>
                  {game.tagline ? (
                    <p className="mt-1 line-clamp-1 text-[0.8125rem] text-muted">{game.tagline}</p>
                  ) : null}

                  <div className="mt-2.5 flex items-center gap-2 text-[0.6875rem] text-dim">
                    <span className={`chip !h-5 ${published ? "!text-good" : ""}`}>
                      {published ? <IconGlobe className="h-2.5 w-2.5" /> : <IconLock className="h-2.5 w-2.5" />}
                      {published ? "Public" : "Draft"}
                    </span>
                    {published && game.drifted ? (
                      <span className="chip !h-5 !border-amber-deep !text-amber">Unpublished edits</span>
                    ) : null}
                    <span className="ml-auto">{when(game.updated_at)}</span>
                  </div>

                  <div className="mt-3.5 flex items-center gap-2 border-t border-line pt-3">
                    <Link href={`/editor/${game.id}`} className="btn btn-sm flex-1">
                      Edit
                    </Link>
                    {published ? (
                      <Link href={`/play/${game.id}`} className="btn btn-sm !px-2.5" aria-label="Play published version">
                        <IconPlay className="h-3 w-3" />
                      </Link>
                    ) : null}
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm !px-2.5 hover:!text-danger"
                      onClick={() => setPendingDelete(game.id)}
                      aria-label={`Delete ${game.title}`}
                    >
                      <IconTrash className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                {pendingDelete === game.id ? (
                  <div className="absolute inset-0 z-10 grid place-items-center bg-bg-deep/92 p-5 text-center">
                    <div>
                      <p className="text-sm">
                        Delete <span className="font-semibold">{game.title}</span>?
                      </p>
                      <p className="mt-1 text-[0.8125rem] text-muted">
                        The files and the whole conversation go with it. This cannot be undone.
                      </p>
                      <div className="mt-4 flex justify-center gap-2">
                        <button type="button" className="btn btn-sm" onClick={() => setPendingDelete(null)}>
                          Keep it
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm !border-danger !bg-danger !text-[#2a0d09]"
                          onClick={() => remove(game.id)}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
