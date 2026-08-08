import { getGame } from "@/lib/games";
import { handler, HttpError, json, readJson, requireUserOr401 } from "@/lib/http";
import { leaderboard, submitScore } from "@/lib/player";

type Params = { params: Promise<{ id: string }> };

export const GET = handler(async (_req: Request, { params }: Params) => {
  const { id } = await params;
  const game = getGame(id);
  if (!game) throw new HttpError("Game not found.", 404);
  return json({ board: leaderboard(id) });
});

export const POST = handler(async (req: Request, { params }: Params) => {
  const user = await requireUserOr401();
  const { id } = await params;
  const game = getGame(id);
  if (!game || (game.visibility !== "public" && game.user_id !== user.id)) {
    throw new HttpError("Game not found.", 404);
  }

  const { score } = await readJson<{ score?: number }>(req);
  if (typeof score !== "number" || !Number.isFinite(score)) throw new HttpError("Score must be a number.");

  submitScore(id, user.id, score);
  return json({ board: leaderboard(id) });
});
