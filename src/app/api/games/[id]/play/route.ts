import { getGame, recordPlay } from "@/lib/games";
import { handler, json } from "@/lib/http";

type Params = { params: Promise<{ id: string }> };

/** Public and deliberately forgiving — a missing game is not worth an error here. */
export const POST = handler(async (_req: Request, { params }: Params) => {
  const { id } = await params;
  const game = getGame(id);
  if (game && game.visibility === "public") recordPlay(id);
  return json({ ok: true });
});
