"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";

export interface LogEntry {
  id: number;
  level: "log" | "info" | "warn" | "error";
  text: string;
  stack?: string | null;
  at: number;
}

export interface GameFrameHandle {
  restart: () => void;
  screenshot: () => Promise<string | null>;
  focus: () => void;
}

interface Props {
  /** Base URL of the game's index.html. */
  src: string;
  gameId: string;
  signedIn: boolean;
  /** Bumping this reloads the frame — used after the assistant edits files. */
  revision?: number;
  onLog?: (entry: LogEntry) => void;
  onStatus?: (status: "loading" | "running") => void;
  className?: string;
}

const localKey = (gameId: string) => `gs:save:${gameId}`;

function readLocalSave(gameId: string): Record<string, unknown> {
  try {
    return JSON.parse(localStorage.getItem(localKey(gameId)) ?? "{}");
  } catch {
    return {};
  }
}

/**
 * Hosts a game on an opaque origin and brokers everything it cannot do itself:
 * persistence, leaderboard writes, screenshots and diagnostics.
 */
export const GameFrame = forwardRef<GameFrameHandle, Props>(function GameFrame(
  { src, gameId, signedIn, revision = 0, onLog, onStatus, className },
  ref
) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [nonce, setNonce] = useState(0);
  const shotWaiters = useRef<((v: string | null) => void)[]>([]);
  const logSeq = useRef(0);

  const post = useCallback((msg: Record<string, unknown>) => {
    frameRef.current?.contentWindow?.postMessage({ __gsCmd: true, ...msg }, "*");
  }, []);

  useImperativeHandle(ref, () => ({
    restart: () => setNonce((n) => n + 1),
    focus: () => post({ cmd: "focus" }),
    screenshot: () =>
      new Promise<string | null>((resolve) => {
        shotWaiters.current.push(resolve);
        post({ cmd: "shot" });
        setTimeout(() => {
          const i = shotWaiters.current.indexOf(resolve);
          if (i !== -1) {
            shotWaiters.current.splice(i, 1);
            resolve(null);
          }
        }, 2500);
      }),
  }));

  const sendInitialSave = useCallback(async () => {
    let data: Record<string, unknown> = {};
    let player = { name: "Player", signedIn: false };

    if (signedIn) {
      try {
        const res = await fetch(`/api/games/${gameId}/save`);
        if (res.ok) {
          const body = await res.json();
          data = body.data ?? {};
          player = body.player ?? player;
        }
      } catch {
        data = readLocalSave(gameId);
      }
    } else {
      data = readLocalSave(gameId);
    }
    post({ cmd: "save:init", data, player });
  }, [gameId, signedIn, post]);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      const frame = frameRef.current;
      if (!frame || event.source !== frame.contentWindow) return;
      const d = event.data;
      if (!d || d.__gs !== true) return;

      switch (d.type) {
        case "boot":
          onStatus?.("loading");
          void sendInitialSave();
          break;

        case "ready":
          onStatus?.("running");
          break;

        case "console":
        case "error":
          onLog?.({
            id: ++logSeq.current,
            level: d.type === "error" ? "error" : d.level,
            text: String(d.text ?? ""),
            stack: d.stack ?? null,
            at: Date.now(),
          });
          break;

        case "shot": {
          const waiter = shotWaiters.current.shift();
          waiter?.(d.dataUrl ?? null);
          break;
        }

        case "save": {
          const data = d.data ?? {};
          try {
            localStorage.setItem(localKey(gameId), JSON.stringify(data));
          } catch {
            /* private mode or quota — the server copy is the real one */
          }
          if (signedIn) {
            void fetch(`/api/games/${gameId}/save`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ data }),
            }).catch(() => {});
          }
          break;
        }

        case "score": {
          const reqId = d.reqId;
          if (!signedIn) {
            post({ cmd: "score:ok", reqId, board: [] });
            break;
          }
          void fetch(`/api/games/${gameId}/score`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ score: d.score }),
          })
            .then((r) => (r.ok ? r.json() : { board: [] }))
            .catch(() => ({ board: [] }))
            .then((body) => post({ cmd: "score:ok", reqId, board: body.board ?? [] }));
          break;
        }
      }
    }

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [gameId, signedIn, onLog, onStatus, post, sendInitialSave]);

  const url = `${src}${src.includes("?") ? "&" : "?"}r=${revision}.${nonce}`;

  return (
    <iframe
      ref={frameRef}
      key={url}
      src={url}
      title="Game preview"
      className={className}
      // No allow-same-origin: the game gets an opaque origin and can never reach
      // this page's cookies or storage.
      sandbox="allow-scripts allow-pointer-lock allow-modals"
      allow="autoplay; gamepad"
    />
  );
});
