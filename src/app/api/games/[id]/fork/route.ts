import { forkGame } from "@/lib/games";
import { handler, HttpError, json, requireUserOr401 } from "@/lib/http";

type Params = { params: Promise<{ id: string }> };

export const POST = handler(async (_req: Request, { params }: Params) => {
  const user = await requireUserOr401();
  try {
    const game = forkGame((await params).id, user.id);
    return json({ game }, 201);
  } catch (err) {
    throw new HttpError(err instanceof Error ? err.message : "Could not remix that game.", 400);
  }
});
