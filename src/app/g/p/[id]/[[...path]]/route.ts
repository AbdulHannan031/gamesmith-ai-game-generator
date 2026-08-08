import { getGame, publishedFiles } from "@/lib/games";
import { corsPreflight, serveGameFile } from "@/lib/serve";

type Params = { params: Promise<{ id: string; path?: string[] }> };

export const dynamic = "force-dynamic";

/** The published snapshot — what the public plays. Never the author's draft. */
export async function GET(req: Request, { params }: Params) {
  const { id, path } = await params;
  const game = getGame(id);
  const files = game && game.visibility === "public" ? publishedFiles(id) : null;

  if (!files) {
    return new Response("This game is not published.", {
      status: 404,
      headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" },
    });
  }

  return serveGameFile(files, path, req);
}

export const OPTIONS = () => corsPreflight();
