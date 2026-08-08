import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { listPublicGames, type GallerySort } from "@/lib/games";
import { GameCard } from "@/components/GameCard";
import { HeroCabinet } from "@/components/HeroCabinet";
import { HeroPrompt } from "@/components/HeroPrompt";
import { SiteHeader } from "@/components/SiteHeader";

export const dynamic = "force-dynamic";

type Search = Promise<{ q?: string; sort?: string }>;

export default async function GalleryPage({ searchParams }: { searchParams: Search }) {
  const { q = "", sort = "recent" } = await searchParams;
  const user = await getCurrentUser();
  const sortKey: GallerySort = sort === "popular" ? "popular" : "recent";

  const games = listPublicGames({ q, sort: sortKey, viewerId: user?.id });
  const featured = listPublicGames({ sort: "popular", limit: 1 })[0] ?? null;

  return (
    <>
      <SiteHeader active="gallery" />

      <main className="mx-auto max-w-[1400px] px-4 sm:px-6">
        {/* --- Hero: a real game, running, is the whole argument ------------ */}
        <section className="grid items-center gap-10 py-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] lg:gap-14 lg:py-20">
          <div className="max-w-xl">
            <p className="u-label !text-amber">The arcade is open</p>
            <h1 className="u-display mt-4 text-[clamp(2.4rem,5vw,3.5rem)] text-balance">
              Games you make by talking.
            </h1>
            <p className="mt-5 max-w-[46ch] text-[1.0625rem] leading-relaxed text-muted">
              Describe it, watch it get built, and play it in the same window. Keep chatting to change
              anything — the jump height, the palette, the entire genre. Publish when it is good and
              anyone can play.
            </p>

            <div className="mt-8">
              <HeroPrompt signedIn={Boolean(user)} />
            </div>
          </div>

          <HeroCabinet
            src={featured ? `/g/p/${featured.id}/index.html` : "/g/demo/index.html"}
            gameId={featured?.id ?? "demo"}
            title={featured?.title ?? "Collect the motes"}
            hue={featured?.hue ?? 40}
            signedIn={Boolean(user)}
            attribution={featured ? `by ${featured.author}` : "the starter template"}
          />
        </section>

        {/* --- The arcade floor -------------------------------------------- */}
        <section className="border-t border-line py-10">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 className="u-display text-[1.75rem]">Published games</h2>
              <p className="mt-1 text-sm text-muted">
                {games.length > 0
                  ? `${games.length} cabinet${games.length === 1 ? "" : "s"} on the floor. Every one made here.`
                  : "Nothing published yet."}
              </p>
            </div>

            <form method="GET" className="flex items-center gap-2">
              <input
                type="search"
                name="q"
                defaultValue={q}
                placeholder="Search games"
                aria-label="Search games"
                className="field !h-9 !w-44 !py-0 text-sm sm:!w-56"
              />
              <input type="hidden" name="sort" value={sortKey} />
              <button type="submit" className="btn btn-sm">
                Search
              </button>
              <div className="ml-1 flex overflow-hidden rounded-lg border border-line">
                {(["recent", "popular"] as const).map((key) => (
                  <Link
                    key={key}
                    href={`/?sort=${key}${q ? `&q=${encodeURIComponent(q)}` : ""}`}
                    className={`u-label px-3 py-2 transition-colors ${
                      sortKey === key ? "bg-surface-2 !text-text" : "hover:!text-text"
                    }`}
                  >
                    {key === "recent" ? "Newest" : "Most played"}
                  </Link>
                ))}
              </div>
            </form>
          </div>

          {games.length > 0 ? (
            <div className="mt-7 grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-4">
              {games.map((game, i) => (
                <GameCard key={game.id} game={game} href={`/play/${game.id}`} index={i} />
              ))}
            </div>
          ) : (
            <div className="panel mt-7 grid place-items-center px-6 py-16 text-center">
              <p className="u-display text-xl">The floor is empty</p>
              <p className="mt-2 max-w-[42ch] text-sm text-muted">
                {q
                  ? "No games match that search. Try a different word."
                  : "Nobody has published a game yet. Build the first one and it lands right here."}
              </p>
              <Link href={user ? "/dashboard" : "/signup"} className="btn btn-primary mt-6">
                Build the first game
              </Link>
            </div>
          )}
        </section>
      </main>

      <footer className="mt-10 border-t border-line py-8">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-x-6 gap-y-2 px-4 text-[0.8125rem] text-dim sm:px-6">
          <span>GameSmith</span>
          <span className="text-line-bright">/</span>
          <span>Canvas games, written by talking, playable anywhere.</span>
        </div>
      </footer>
    </>
  );
}
