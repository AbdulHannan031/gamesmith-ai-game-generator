import Link from "next/link";
import type { GameCard as Card } from "@/lib/games";
import { IconHeart, IconPlay } from "./icons";

/** Stand-in art when a game has no captured screenshot yet. */
function AttractPattern({ hue }: { hue: number }) {
  const bars = Array.from({ length: 9 }, (_, i) => i);
  return (
    <div className="absolute inset-0 overflow-hidden" aria-hidden>
      <div
        className="absolute inset-0"
        style={{
          background: `radial-gradient(120% 100% at 50% 0%, hsl(${hue} 62% 22%), hsl(${hue} 40% 8%) 62%, #08070a)`,
        }}
      />
      <div className="absolute inset-x-0 bottom-0 flex h-2/3 items-end justify-center gap-[3px] px-6 opacity-45">
        {bars.map((i) => {
          const h = 22 + ((i * 37) % 62);
          return (
            <span
              key={i}
              className="w-[7%] rounded-t-[2px]"
              style={{ height: `${h}%`, background: `hsl(${(hue + i * 9) % 360} 74% ${44 + (i % 3) * 9}%)` }}
            />
          );
        })}
      </div>
    </div>
  );
}

export function GameCard({ game, href, index = 0 }: { game: Card; href: string; index?: number }) {
  return (
    <Link
      href={href}
      className="cabinet rise group block hover:border-line-bright focus-visible:border-amber"
      style={{ ["--hue" as string]: game.hue, animationDelay: `${Math.min(index, 11) * 38}ms` }}
    >
      <div className="screen relative aspect-[16/10] overflow-hidden">
        {game.thumbnail ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={game.thumbnail}
            alt=""
            className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
          />
        ) : (
          <AttractPattern hue={game.hue} />
        )}

        <div className="absolute inset-0 grid place-items-center opacity-0 transition-opacity duration-200 group-hover:opacity-100">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-amber text-[#1c1403] shadow-lg">
            <IconPlay className="ml-0.5 h-4 w-4" />
          </span>
        </div>
      </div>

      <div className="cabinet-glow" />

      <div className="relative border-t border-line px-3.5 py-3">
        <h3
          className="u-marquee truncate text-[0.9375rem]"
          style={{ color: `hsl(${game.hue} 80% 78%)` }}
          title={game.title}
        >
          {game.title}
        </h3>
        {game.tagline ? (
          <p className="mt-1 line-clamp-2 text-[0.8125rem] leading-snug text-muted">{game.tagline}</p>
        ) : null}

        <div className="mt-2.5 flex items-center gap-3 text-[0.6875rem] text-dim">
          <span className="truncate">{game.author}</span>
          <span className="ml-auto u-num flex items-center gap-1">
            <IconPlay className="h-2.5 w-2.5" />
            {game.play_count.toLocaleString()}
          </span>
          {game.like_count > 0 ? (
            <span className="u-num flex items-center gap-1">
              <IconHeart className="h-3 w-3" />
              {game.like_count}
            </span>
          ) : null}
        </div>
      </div>
    </Link>
  );
}
