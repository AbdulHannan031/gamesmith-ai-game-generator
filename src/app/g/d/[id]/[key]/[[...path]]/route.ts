import { getFiles, getGame } from "@/lib/games";
import { corsPreflight, serveGameFile } from "@/lib/serve";

type Params = { params: Promise<{ id: string; key: string; path?: string[] }> };

export const dynamic = "force-dynamic";

/**
 * Live draft files for the editor preview. Authorised by the game's preview key
 * rather than a session, because the sandboxed frame cannot send cookies.
 */
export async function GET(req: Request, { params }: Params) {
  const { id, key, path } = await params;
  const game = getGame(id);

  if (!game || !game.preview_key || game.preview_key !== key) {
    return new Response("Not found", {
      status: 404,
      headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" },
    });
  }

  return serveGameFile(getFiles(id), path, req);
}

export const OPTIONS = () => corsPreflight();
