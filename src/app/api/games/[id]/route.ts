import { deleteGame, getFiles, updateGameMeta } from "@/lib/games";
import { handler, HttpError, json, readJson, requireOwnedGame } from "@/lib/http";
import { MODEL_CHOICES } from "@/lib/tokens";

type Params = { params: Promise<{ id: string }> };

export const GET = handler(async (_req: Request, { params }: Params) => {
  const { game } = await requireOwnedGame((await params).id);
  return json({ game, files: getFiles(game.id) });
});

export const PATCH = handler(async (req: Request, { params }: Params) => {
  const { game } = await requireOwnedGame((await params).id);
  const body = await readJson<{ title?: string; tagline?: string; model?: string }>(req);

  if (body.model && !MODEL_CHOICES.some((m) => m.id === body.model)) {
    throw new HttpError("That model is not available.");
  }
  if (body.title !== undefined && !body.title.trim()) {
    throw new HttpError("A game needs a title.");
  }

  updateGameMeta(game.id, {
    ...(body.title !== undefined ? { title: body.title.trim().slice(0, 80) } : {}),
    ...(body.tagline !== undefined ? { tagline: body.tagline.trim().slice(0, 120) } : {}),
    ...(body.model ? { model: body.model } : {}),
  });
  return json({ ok: true });
});

export const DELETE = handler(async (_req: Request, { params }: Params) => {
  const { game } = await requireOwnedGame((await params).id);
  deleteGame(game.id);
  return json({ ok: true });
});
