import { NextResponse } from "next/server";
import { getCurrentUser } from "./auth";
import { getOwnedGame } from "./games";
import type { Game, PublicUser } from "./types";

export const json = <T>(data: T, status = 200) => NextResponse.json(data, { status });

export const fail = (message: string, status = 400) => NextResponse.json({ error: message }, { status });

export async function readJson<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new HttpError("Request body was not valid JSON.", 400);
  }
}

export class HttpError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

/** Wraps a handler so thrown errors become clean JSON instead of a 500 page. */
export function handler<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (err) {
      if (err instanceof HttpError) return fail(err.message, err.status);
      const message = err instanceof Error ? err.message : "Something went wrong.";
      console.error("[api]", err);
      return fail(message, 500);
    }
  };
}

export async function requireUserOr401(): Promise<PublicUser> {
  const user = await getCurrentUser();
  if (!user) throw new HttpError("Sign in to continue.", 401);
  return user;
}

export async function requireOwnedGame(gameId: string): Promise<{ user: PublicUser; game: Game }> {
  const user = await requireUserOr401();
  const game = getOwnedGame(gameId, user.id);
  if (!game) throw new HttpError("Game not found.", 404);
  return { user, game };
}
