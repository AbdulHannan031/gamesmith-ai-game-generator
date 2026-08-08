"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { GameFrame, type GameFrameHandle } from "./GameFrame";
import type { ScoreRow } from "@/lib/runtime";
import { IconHeart, IconPlay, IconRemix, IconRestart } from "./icons";

interface Props {
  gameId: string;
  hue: number;
  title: string;
  signedIn: boolean;
  initialLiked: boolean;
  initialLikes: number;
  initialBoard: ScoreRow[];
}

export function PlayStage({ gameId, hue, title, signedIn, initialLiked, initialLikes, initialBoard }: Props) {
  const router = useRouter();
  const frame = useRef<GameFrameHandle>(null);
  const [engaged, setEngaged] = useState(false);
  const [status, setStatus] = useState<"loading" | "running">("loading");
  const [liked, setLiked] = useState(initialLiked);
  const [likes, setLikes] = useState(initialLikes);
  const [board, setBoard] = useState(initialBoard);
  const [remixing, setRemixing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // Count the play once, when it actually starts running.
  const counted = useRef(false);
  useEffect(() => {
    if (status !== "running" || counted.current) return;
    counted.current = true;
    void fetch(`/api/games/${gameId}/play`, { method: "POST" }).catch(() => {});
  }, [status, gameId]);

  // The board only changes when a score is submitted from inside the frame.
  useEffect(() => {
    if (!engaged) return;
    const timer = setInterval(() => {
      void fetch(`/api/games/${gameId}/score`)
        .then((r) => (r.ok ? r.json() : null))
        .then((b) => b && setBoard(b.board))
        .catch(() => {});
    }, 15000);
    return () => clearInterval(timer);
  }, [engaged, gameId]);

  async function toggleLike() {
    if (!signedIn) {
      router.push("/login");
      return;
    }
    const res = await fetch(`/api/games/${gameId}/like`, { method: "POST" });
    if (!res.ok) return;
    const body = await res.json();
    setLiked(body.liked);
    setLikes(body.count);
  }

  async function remix() {
    if (!signedIn) {
      router.push("/login");
      return;
    }
    setRemixing(true);
    setNotice(null);
    try {
      const res = await fetch(`/api/games/${gameId}/fork`, { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Could not remix this game.");
      router.push(`/editor/${body.game.id}`);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Could not remix this game.");
      setRemixing(false);
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_260px]">
      <div className="cabinet vignette relative" style={{ ["--hue" as string]: hue }}>
        <div className="cabinet-glow" />

        <div className="relative z-[2] flex items-center gap-3 border-b border-line px-4 py-2.5">
          <span className={status === "running" ? "pulse-live" : "h-[7px] w-[7px] rounded-full bg-dim"} />
          <span className="u-marquee truncate text-[0.8125rem]" style={{ color: `hsl(${hue} 80% 76%)` }}>
            {title}
          </span>
          <button
            type="button"
            className="btn btn-ghost btn-sm ml-auto !h-7 !px-2"
            onClick={() => {
              frame.current?.restart();
              setEngaged(false);
            }}
          >
            <IconRestart className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Restart</span>
          </button>
        </div>

        <div className="screen relative aspect-[16/9]">
          <GameFrame
            ref={frame}
            src={`/g/p/${gameId}/index.html`}
            gameId={gameId}
            signedIn={signedIn}
            onStatus={setStatus}
            className="absolute inset-0 h-full w-full border-0"
          />

          {!engaged ? (
            <button
              type="button"
              onClick={() => {
                setEngaged(true);
                frame.current?.focus();
              }}
              className="absolute inset-0 z-[2] grid place-items-center bg-bg-deep/55 transition-colors hover:bg-bg-deep/40"
            >
              <span className="flex flex-col items-center gap-2.5">
                <span className="flex h-14 w-14 items-center justify-center rounded-full bg-amber text-[#1c1403]">
                  <IconPlay className="ml-0.5 h-5 w-5" />
                </span>
                <span className="u-label !text-text">Click to play</span>
              </span>
            </button>
          ) : null}
        </div>
      </div>

      <aside className="flex flex-col gap-4">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={toggleLike}
            className={`btn flex-1 ${liked ? "!border-live !text-live" : ""}`}
            aria-pressed={liked}
          >
            <IconHeart className="h-3.5 w-3.5" filled={liked} />
            {likes > 0 ? likes.toLocaleString() : "Like"}
          </button>
          <button type="button" onClick={remix} className="btn flex-1" disabled={remixing}>
            <IconRemix className="h-3.5 w-3.5" />
            {remixing ? "Copying…" : "Remix"}
          </button>
        </div>

        {notice ? (
          <p role="alert" className="text-[0.8125rem] text-danger">
            {notice}
          </p>
        ) : null}

        <div className="panel overflow-hidden">
          <h2 className="u-label border-b border-line px-3.5 py-2.5">High scores</h2>
          {board.length ? (
            <ol className="divide-y divide-line">
              {board.map((row, i) => (
                <li key={`${row.name}-${row.created_at}`} className="flex items-center gap-3 px-3.5 py-2">
                  <span className="u-num w-4 text-[0.6875rem] text-dim">{i + 1}</span>
                  <span className="truncate text-[0.8125rem]">{row.name}</span>
                  <span className="u-num ml-auto text-[0.8125rem]" style={{ color: `hsl(${hue} 80% 74%)` }}>
                    {row.score.toLocaleString()}
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="px-3.5 py-4 text-[0.8125rem] leading-relaxed text-dim">
              No scores yet.{" "}
              {signedIn
                ? "Play a round — if this game reports scores, yours lands here."
                : "Sign in and your scores get saved."}
            </p>
          )}
        </div>

        {!signedIn ? (
          <p className="text-[0.8125rem] leading-relaxed text-dim">
            Progress is saved in this browser. Sign in to keep it across devices.
          </p>
        ) : null}
      </aside>
    </div>
  );
}
