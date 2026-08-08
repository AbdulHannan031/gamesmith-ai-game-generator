"use client";

import { useRef, useState } from "react";
import { GameFrame, type GameFrameHandle } from "./GameFrame";
import { IconPlay, IconRestart } from "./icons";

interface Props {
  src: string;
  gameId: string;
  title: string;
  hue: number;
  signedIn: boolean;
  /** Shown under the marquee — e.g. "by Ana" or "the starter template". */
  attribution: string;
}

/**
 * The landing hero is a real, running game rather than a screenshot of one.
 * It is the most honest possible claim about what this thing does.
 */
export function HeroCabinet({ src, gameId, title, hue, signedIn, attribution }: Props) {
  const frame = useRef<GameFrameHandle>(null);
  const [engaged, setEngaged] = useState(false);
  const [status, setStatus] = useState<"loading" | "running">("loading");

  return (
    <div className="cabinet vignette relative" style={{ ["--hue" as string]: hue }}>
      <div className="cabinet-glow" />

      <div className="relative z-[2] flex items-center gap-3 border-b border-line px-4 py-2.5">
        <span className={status === "running" ? "pulse-live" : "h-[7px] w-[7px] rounded-full bg-dim"} />
        <span className="u-marquee text-[0.8125rem]" style={{ color: `hsl(${hue} 80% 76%)` }}>
          {title}
        </span>
        <span className="ml-auto hidden text-[0.6875rem] text-dim sm:inline">{attribution}</span>
        <button
          type="button"
          className="btn btn-ghost btn-sm !h-7 !px-2"
          onClick={() => {
            frame.current?.restart();
            setEngaged(false);
          }}
          aria-label="Restart the demo"
        >
          <IconRestart className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="screen relative aspect-[16/9]">
        <GameFrame
          ref={frame}
          src={src}
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
            className="absolute inset-0 z-[2] grid place-items-center bg-bg-deep/55 backdrop-blur-[1px] transition-opacity hover:bg-bg-deep/40"
          >
            <span className="flex flex-col items-center gap-2.5">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-amber text-[#1c1403]">
                <IconPlay className="ml-0.5 h-4.5 w-4.5" />
              </span>
              <span className="u-label !text-text">Click to play</span>
            </span>
          </button>
        ) : null}
      </div>
    </div>
  );
}
