import { getGame, publishGame, unpublishGame } from "@/lib/games";
import { handler, HttpError, json, readJson, requireOwnedGame } from "@/lib/http";

type Params = { params: Promise<{ id: string }> };

export const POST = handler(async (req: Request, { params }: Params) => {
  const { game } = await requireOwnedGame((await params).id);
  const { publish = true } = await readJson<{ publish?: boolean }>(req);

  if (publish) {
    if (!game.title.trim() || game.title === "Untitled game") {
      throw new HttpError("Give the game a title before publishing it.");
    }
    try {
      publishGame(game.id);
    } catch (err) {
      throw new HttpError(err instanceof Error ? err.message : "Could not publish.", 400);
    }
  } else {
    unpublishGame(game.id);
  }

  return json({ game: getGame(game.id) });
});
