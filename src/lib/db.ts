import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

const DATA_DIR = process.env.DATA_DIR || join(process.cwd(), "data");

// Next dev reloads modules constantly; keep one handle on globalThis.
const g = globalThis as unknown as { __gsdb?: DatabaseSync };

function open(): DatabaseSync {
  mkdirSync(DATA_DIR, { recursive: true });
  const db = new DatabaseSync(join(DATA_DIR, "gamesmith.db"));
  db.exec("PRAGMA busy_timeout = 10000");
  // Switching to WAL takes a brief exclusive lock. If another process (a running
  // dev server during `next build`) holds it, carry on in the default mode
  // rather than failing to start.
  try {
    db.exec("PRAGMA journal_mode = WAL");
  } catch {
    /* rollback journal is fine */
  }
  db.exec("PRAGMA foreign_keys = ON");
  migrate(db);
  return db;
}

function migrate(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id            TEXT PRIMARY KEY,
      email         TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      display_name  TEXT NOT NULL,
      created_at    INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id         TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

    CREATE TABLE IF NOT EXISTS games (
      id            TEXT PRIMARY KEY,
      user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title         TEXT NOT NULL,
      tagline       TEXT NOT NULL DEFAULT '',
      slug          TEXT NOT NULL,
      hue           INTEGER NOT NULL DEFAULT 40,
      visibility    TEXT NOT NULL DEFAULT 'private',
      -- The preview iframe runs on an opaque origin, so it sends no cookies.
      -- This unguessable key is what authorises draft file reads instead.
      preview_key   TEXT NOT NULL DEFAULT '',
      model         TEXT NOT NULL DEFAULT 'gpt-4.1-mini',
      summary       TEXT NOT NULL DEFAULT '',
      thumbnail     TEXT,
      play_count    INTEGER NOT NULL DEFAULT 0,
      prompt_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      cached_tokens INTEGER NOT NULL DEFAULT 0,
      created_at    INTEGER NOT NULL,
      updated_at    INTEGER NOT NULL,
      published_at  INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_games_user ON games(user_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_games_pub  ON games(visibility, published_at DESC);

    CREATE TABLE IF NOT EXISTS game_files (
      game_id    TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
      path       TEXT NOT NULL,
      content    TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (game_id, path)
    );

    -- A publish snapshots the whole working tree so editing a draft never
    -- breaks the version the public is playing.
    CREATE TABLE IF NOT EXISTS builds (
      id           TEXT PRIMARY KEY,
      game_id      TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
      files_json   TEXT NOT NULL,
      title        TEXT NOT NULL,
      tagline      TEXT NOT NULL DEFAULT '',
      thumbnail    TEXT,
      published_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_builds_game ON builds(game_id, published_at DESC);

    CREATE TABLE IF NOT EXISTS messages (
      id             TEXT PRIMARY KEY,
      game_id        TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
      seq            INTEGER NOT NULL,
      role           TEXT NOT NULL,
      content        TEXT NOT NULL DEFAULT '',
      tool_calls     TEXT,
      tool_call_id   TEXT,
      tool_name      TEXT,
      -- Rendered chip for this tool call, so a reloaded transcript looks identical.
      trace          TEXT,
      -- 1 once folded into a summary: kept for the transcript, dropped from context.
      compacted      INTEGER NOT NULL DEFAULT 0,
      tokens         INTEGER NOT NULL DEFAULT 0,
      created_at     INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_messages_game ON messages(game_id, seq);

    -- Per-player save data. The game frame is sandboxed onto an opaque origin
    -- where localStorage throws, so saves are bridged out to here instead.
    CREATE TABLE IF NOT EXISTS saves (
      game_id    TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
      user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      data       TEXT NOT NULL DEFAULT '{}',
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (game_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS scores (
      id         TEXT PRIMARY KEY,
      game_id    TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
      user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      score      INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_scores_board ON scores(game_id, score DESC);

    CREATE TABLE IF NOT EXISTS likes (
      game_id    TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
      user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (game_id, user_id)
    );
  `);
}

/**
 * Opened on first query, never at import time. `next build` loads every route
 * module across several worker processes, and eagerly opening the file there
 * makes them collide on the write lock.
 */
const connection = () => (g.__gsdb ??= open());

export const db: DatabaseSync = new Proxy({} as DatabaseSync, {
  get(_target, prop) {
    const conn = connection() as unknown as Record<string | symbol, unknown>;
    const value = conn[prop];
    return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(conn) : value;
  },
});

/** node:sqlite hands back null-prototype rows, which RSC refuses to serialize. */
export function plain<T>(row: unknown): T {
  return { ...(row as object) } as T;
}
export function plainAll<T>(rows: unknown[]): T[] {
  return rows.map((r) => plain<T>(r));
}

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";
export function newId(len = 14): string {
  const bytes = randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

export function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "game"
  );
}

export const now = () => Date.now();
