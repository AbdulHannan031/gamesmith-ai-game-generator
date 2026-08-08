import { createGame, listUserGames } from "@/lib/games";
import { handler, json, readJson, requireUserOr401 } from "@/lib/http";

export const GET = handler(async () => {
  const user = await requireUserOr401();
  return json({ games: listUserGames(user.id) });
});

export const POST = handler(async (req: Request) => {
  const user = await requireUserOr401();
  const { title } = await readJson<{ title?: string }>(req);
  const game = createGame(user.id, title ?? "Untitled game");
  return json({ game }, 201);
});
