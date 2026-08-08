import { cookies } from "next/headers";
import { randomBytes, scryptSync, timingSafeEqual, createHash } from "node:crypto";
import { db, newId, now, plain } from "./db";
import type { PublicUser, User } from "./types";

const COOKIE = "gs_session";
const SESSION_TTL = 1000 * 60 * 60 * 24 * 30; // 30 days
const SCRYPT_KEYLEN = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const key = scryptSync(password, salt, SCRYPT_KEYLEN).toString("hex");
  return `scrypt$${salt}$${key}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, salt, key] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !key) return false;
  const expected = Buffer.from(key, "hex");
  const actual = scryptSync(password, salt, expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** The cookie holds the raw token; only its digest is stored, so a DB leak grants nothing. */
const digest = (token: string) => createHash("sha256").update(token).digest("hex");

export function createSession(userId: string): { token: string; expiresAt: number } {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = now() + SESSION_TTL;
  db.prepare(
    "INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)"
  ).run(digest(token), userId, now(), expiresAt);
  return { token, expiresAt };
}

export async function setSessionCookie(token: string, expiresAt: number) {
  const jar = await cookies();
  jar.set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: new Date(expiresAt),
  });
}

export async function clearSession() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) db.prepare("DELETE FROM sessions WHERE id = ?").run(digest(token));
  jar.delete(COOKIE);
}

export async function getCurrentUser(): Promise<PublicUser | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return null;

  const row = db
    .prepare(
      `SELECT u.id, u.email, u.display_name, u.created_at, s.expires_at
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.id = ?`
    )
    .get(digest(token)) as (PublicUser & { expires_at: number }) | undefined;

  if (!row) return null;
  if (row.expires_at < now()) {
    db.prepare("DELETE FROM sessions WHERE id = ?").run(digest(token));
    return null;
  }
  const { id, email, display_name, created_at } = plain<PublicUser & { expires_at: number }>(row);
  return { id, email, display_name, created_at };
}

export async function requireUser(): Promise<PublicUser> {
  const user = await getCurrentUser();
  if (!user) throw new AuthError();
  return user;
}

export class AuthError extends Error {
  constructor() {
    super("Sign in to continue.");
    this.name = "AuthError";
  }
}

export function createUser(email: string, password: string, displayName: string): PublicUser {
  const normalized = email.trim().toLowerCase();
  const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(normalized);
  if (existing) throw new Error("That email already has an account. Sign in instead.");

  const user: User = {
    id: newId(),
    email: normalized,
    password_hash: hashPassword(password),
    display_name: displayName.trim() || normalized.split("@")[0],
    created_at: now(),
  };
  db.prepare(
    "INSERT INTO users (id, email, password_hash, display_name, created_at) VALUES (?, ?, ?, ?, ?)"
  ).run(user.id, user.email, user.password_hash, user.display_name, user.created_at);

  return {
    id: user.id,
    email: user.email,
    display_name: user.display_name,
    created_at: user.created_at,
  };
}

export function authenticate(email: string, password: string): PublicUser | null {
  const row = db
    .prepare("SELECT * FROM users WHERE email = ?")
    .get(email.trim().toLowerCase()) as User | undefined;
  if (!row) return null;
  const user = plain<User>(row);
  if (!verifyPassword(password, user.password_hash)) return null;
  return {
    id: user.id,
    email: user.email,
    display_name: user.display_name,
    created_at: user.created_at,
  };
}

export function validateCredentials(email: string, password: string): string | null {
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) return "Enter a valid email address.";
  if (password.length < 8) return "Use at least 8 characters for your password.";
  return null;
}
