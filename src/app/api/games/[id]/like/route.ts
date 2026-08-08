import { getGame, toggleLike } from "@/lib/games";
import { handler, HttpError, json, requireUserOr401 } from "@/lib/http";

type Params = { params: Promise<{ id: string }> };

export const POST = handler(async (_req: Request, { params }: Params) => {
  const user = await requireUserOr401();
  const { id } = await params;
  const game = getGame(id);
  if (!game || (game.visibility !== "public" && game.user_id !== user.id)) {
    throw new HttpError("Game not found.", 404);
  }
  return json(toggleLike(id, user.id));
});
