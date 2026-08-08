import { updateGameMeta } from "@/lib/games";
import { handler, HttpError, json, readJson, requireOwnedGame } from "@/lib/http";

type Params = { params: Promise<{ id: string }> };

const MAX_THUMB_CHARS = 400_000; // ~300 KB of base64

export const POST = handler(async (req: Request, { params }: Params) => {
  const { game } = await requireOwnedGame((await params).id);
  const { dataUrl } = await readJson<{ dataUrl?: string }>(req);

  if (!dataUrl || !/^data:image\/(webp|png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(dataUrl)) {
    throw new HttpError("Expected a base64 image data URL.");
  }
  if (dataUrl.length > MAX_THUMB_CHARS) throw new HttpError("That screenshot is too large.");

  updateGameMeta(game.id, { thumbnail: dataUrl });
  return json({ ok: true });
});
