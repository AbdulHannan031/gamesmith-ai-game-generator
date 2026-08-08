import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db, plain } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { getGame, latestBuild, listPublicGames } from "@/lib/games";
import { leaderboard } from "@/lib/player";
import { GameCard } from "@/components/GameCard";
import { PlayStage } from "@/components/PlayStage";
import { SiteHeader } from "@/components/SiteHeader";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const game = getGame((await params).id);
  if (!game || game.visibility !== "public") return { title: "Game not found" };
  return { title: game.title, description: game.tagline || "A 2D game made on GameSmith." };
}

export default async function PlayPage({ params }: Params) {
  const { id } = await params;
  const game = getGame(id);
  if (!game || game.visibility !== "public" || !latestBuild(id)) notFound();

  const user = await getCurrentUser();

  const author = plain<{ display_name: string }>(
    db.prepare("SELECT display_name FROM users WHERE id = ?").get(game.user_id)
  );
  const likes = plain<{ c: number }>(
    db.prepare("SELECT COUNT(*) AS c FROM likes WHERE game_id = ?").get(id)
  );
  const liked = user
    ? Boolean(db.prepare("SELECT 1 FROM likes WHERE game_id = ? AND user_id = ?").get(id, user.id))
    : false;

  const more = listPublicGames({ sort: "popular", limit: 5 }).filter((g) => g.id !== id).slice(0, 4);

  return (
    <>
      <SiteHeader active="gallery" />

      <main className="mx-auto max-w-[1400px] px-4 py-7 sm:px-6">
        <nav className="mb-5 flex items-center gap-2 text-[0.8125rem] text-dim">
          <Link href="/" className="transition-colors hover:text-text">
            Arcade
          </Link>
          <span aria-hidden>/</span>
          <span className="truncate text-muted">{game.title}</span>
        </nav>

        <header className="mb-5 flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <h1 className="u-display text-[clamp(1.75rem,4vw,2.5rem)]">{game.title}</h1>
            {game.tagline ? <p className="mt-1.5 max-w-[60ch] text-muted">{game.tagline}</p> : null}
          </div>
          <div className="u-num flex items-center gap-4 text-[0.8125rem] text-dim">
            <span>by {author.display_name}</span>
            <span>{game.play_count.toLocaleString()} plays</span>
          </div>
        </header>

        <PlayStage
          gameId={id}
          hue={game.hue}
          title={game.title}
          signedIn={Boolean(user)}
          initialLiked={liked}
          initialLikes={likes.c}
          initialBoard={leaderboard(id)}
        />

        {more.length ? (
          <section className="mt-14 border-t border-line pt-8">
            <h2 className="u-label mb-4">More from the arcade</h2>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-4">
              {more.map((g, i) => (
                <GameCard key={g.id} game={g} href={`/play/${g.id}`} index={i} />
              ))}
            </div>
          </section>
        ) : null}
      </main>
    </>
  );
}
