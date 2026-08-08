import { createSession, createUser, setSessionCookie, validateCredentials } from "@/lib/auth";
import { handler, HttpError, json, readJson } from "@/lib/http";

export const POST = handler(async (req: Request) => {
  const { email, password, name } = await readJson<{ email?: string; password?: string; name?: string }>(req);
  if (!email || !password) throw new HttpError("Email and password are required.");

  const problem = validateCredentials(email, password);
  if (problem) throw new HttpError(problem);

  let user;
  try {
    user = createUser(email, password, name ?? "");
  } catch (err) {
    throw new HttpError(err instanceof Error ? err.message : "Could not create that account.", 409);
  }

  const { token, expiresAt } = createSession(user.id);
  await setSessionCookie(token, expiresAt);
  return json({ user });
});
