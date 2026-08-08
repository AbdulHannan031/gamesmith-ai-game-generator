import { getGame } from "@/lib/games";
import { handler, HttpError, json, readJson, requireUserOr401 } from "@/lib/http";
import { loadSave, storeSave } from "@/lib/player";

type Params = { params: Promise<{ id: string }> };

async function reachableGame(id: string, userId: string) {
  const game = getGame(id);
  if (!game || (game.visibility !== "public" && game.user_id !== userId)) {
    throw new HttpError("Game not found.", 404);
  }
  return game;
}

export const GET = handler(async (_req: Request, { params }: Params) => {
  const user = await requireUserOr401();
  const { id } = await params;
  await reachableGame(id, user.id);
  return json({ data: loadSave(id, user.id), player: { name: user.display_name, signedIn: true } });
});

export const PUT = handler(async (req: Request, { params }: Params) => {
  const user = await requireUserOr401();
  const { id } = await params;
  await reachableGame(id, user.id);
  const { data } = await readJson<{ data?: unknown }>(req);
  try {
    storeSave(id, user.id, data ?? {});
  } catch (err) {
    throw new HttpError(err instanceof Error ? err.message : "Could not save.", 413);
  }
  return json({ ok: true });
});
