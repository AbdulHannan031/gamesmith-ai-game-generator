import { authenticate, createSession, setSessionCookie } from "@/lib/auth";
import { handler, HttpError, json, readJson } from "@/lib/http";

export const POST = handler(async (req: Request) => {
  const { email, password } = await readJson<{ email?: string; password?: string }>(req);
  if (!email || !password) throw new HttpError("Email and password are required.");

  const user = authenticate(email, password);
  if (!user) throw new HttpError("That email and password do not match an account.", 401);

  const { token, expiresAt } = createSession(user.id);
  await setSessionCookie(token, expiresAt);
  return json({ user });
});
