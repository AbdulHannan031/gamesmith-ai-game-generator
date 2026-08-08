import { db, newId, now, plain, plainAll, slugify } from "./db";
import { STARTER_FILES, STARTER_SUMMARY } from "./template";
import type { FileMap, Game, Visibility } from "./types";

// GPT-5.1 by default: it plans, loads the right references and edits surgically
// instead of rewriting, which is most of the gap in finished-game quality.
// Override with OPENAI_MODEL, or switch per game in the editor.
export const DEFAULT_MODEL = process.env.OPENAI_MODEL || "gpt-5.1";

/** Marquee colour. Deterministic per game so a cabinet always looks the same. */
function hueFromId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
  return h;
}

export interface GameCard extends Game {
  author: string;
  like_count: number;
  liked?: number;
}

export function createGame(userId: string, title: string): Game {
  const id = newId();
  const ts = now();
  const clean = title.trim().slice(0, 80) || "Untitled game";

  db.prepare(
    `INSERT INTO games (id, user_id, title, tagline, slug, hue, visibility, preview_key,
                        model, summary, created_at, updated_at)
     VALUES (?, ?, ?, '', ?, ?, 'private', ?, ?, ?, ?, ?)`
  ).run(id, userId, clean, slugify(clean), hueFromId(id), newId(24), DEFAULT_MODEL, STARTER_SUMMARY, ts, ts);

  const insert = db.prepare(
    "INSERT INTO game_files (game_id, path, content, updated_at) VALUES (?, ?, ?, ?)"
  );
  for (const [path, content] of Object.entries(STARTER_FILES)) insert.run(id, path, content, ts);

  // Open the editor with the kit already explained. Without this the preview
  // says "Ember Run" while the header says "Untitled game", which reads as a bug.
  db.prepare(
    `INSERT INTO messages (id, game_id, seq, role, content, compacted, tokens, created_at)
     VALUES (?, ?, 1, 'assistant', ?, 0, ?, ?)`
  ).run(id + "-intro", id, WELCOME, Math.ceil(WELCOME.length / 4), ts);

  return getGame(id)!;
}

const WELCOME = `You're starting from **Ember Run** — a small but finished platformer, not an empty file. A fox with a run cycle, a layered night scene, and three levels with embers to collect, spikes, patrolling drifters and a goal lantern. Click the preview and play it with the arrow keys.

It's a starting point, not the destination. Tell me what you actually want and I'll rebuild it from here — "make it a space shooter", "turn the fox into a knight in a castle", "make the jumps floatier and add a double jump". Anything from a small tweak to a different genre.`;

export function getGame(id: string): Game | null {
  const row = db.prepare("SELECT * FROM games WHERE id = ?").get(id);
  return row ? plain<Game>(row) : null;
}

export function getOwnedGame(id: string, userId: string): Game | null {
  const game = getGame(id);
  return game && game.user_id === userId ? game : null;
}

export function listUserGames(userId: string): GameCard[] {
  return plainAll<GameCard>(
    db
      .prepare(
        `SELECT g.*, u.display_name AS author,
                (SELECT COUNT(*) FROM likes l WHERE l.game_id = g.id) AS like_count
           FROM games g JOIN users u ON u.id = g.user_id
          WHERE g.user_id = ?
          ORDER BY g.updated_at DESC`
      )
      .all(userId)
  );
}

export type GallerySort = "recent" | "popular";

export function listPublicGames(opts: { q?: string; sort?: GallerySort; limit?: number; viewerId?: string } = {}): GameCard[] {
  const { q = "", sort = "recent", limit = 60, viewerId = null } = opts;
  const order = sort === "popular" ? "g.play_count DESC, g.published_at DESC" : "g.published_at DESC";
  const term = `%${q.trim().toLowerCase()}%`;

  return plainAll<GameCard>(
    db
      .prepare(
        `SELECT g.*, u.display_name AS author,
                (SELECT COUNT(*) FROM likes l WHERE l.game_id = g.id) AS like_count,
                (SELECT COUNT(*) FROM likes l WHERE l.game_id = g.id AND l.user_id = ?) AS liked
           FROM games g JOIN users u ON u.id = g.user_id
          WHERE g.visibility = 'public'
            AND (? = '' OR lower(g.title) LIKE ? OR lower(g.tagline) LIKE ?)
          ORDER BY ${order}
          LIMIT ?`
      )
      .all(viewerId, q.trim(), term, term, limit)
  );
}

/* ---------------------------------------------------------------- files -- */

export function getFiles(gameId: string): FileMap {
  const rows = db
    .prepare("SELECT path, content FROM game_files WHERE game_id = ? ORDER BY path")
    .all(gameId) as { path: string; content: string }[];
  const files: FileMap = {};
  for (const r of rows) files[r.path] = r.content;
  return files;
}

export function writeFile(gameId: string, path: string, content: string) {
  db.prepare(
    `INSERT INTO game_files (game_id, path, content, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(game_id, path) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at`
  ).run(gameId, path, content, now());
  touchGame(gameId);
}

export function deleteFile(gameId: string, path: string): boolean {
  const res = db.prepare("DELETE FROM game_files WHERE game_id = ? AND path = ?").run(gameId, path);
  if (res.changes > 0) touchGame(gameId);
  return res.changes > 0;
}

export function touchGame(gameId: string) {
  db.prepare("UPDATE games SET updated_at = ? WHERE id = ?").run(now(), gameId);
}

export function updateGameMeta(
  gameId: string,
  patch: Partial<Pick<Game, "title" | "tagline" | "summary" | "model" | "thumbnail">>
) {
  const sets: string[] = [];
  const args: (string | number | null)[] = [];
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    sets.push(`${k} = ?`);
    args.push(v as string);
  }
  if (patch.title) {
    sets.push("slug = ?");
    args.push(slugify(patch.title));
  }
  if (!sets.length) return;
  sets.push("updated_at = ?");
  args.push(now(), gameId);
  db.prepare(`UPDATE games SET ${sets.join(", ")} WHERE id = ?`).run(...args);
}

export function addUsage(gameId: string, prompt: number, output: number, cached: number) {
  db.prepare(
    `UPDATE games SET prompt_tokens = prompt_tokens + ?, output_tokens = output_tokens + ?,
                      cached_tokens = cached_tokens + ? WHERE id = ?`
  ).run(prompt, output, cached, gameId);
}

/* ------------------------------------------------------------ publishing -- */

export interface Build {
  id: string;
  game_id: string;
  files_json: string;
  title: string;
  tagline: string;
  thumbnail: string | null;
  published_at: number;
}

export function publishGame(gameId: string): Build {
  const game = getGame(gameId);
  if (!game) throw new Error("Game not found.");
  const files = getFiles(gameId);
  if (!files["index.html"]) {
    throw new Error("Add an index.html before publishing — that's the file the player loads.");
  }

  const build: Build = {
    id: newId(),
    game_id: gameId,
    files_json: JSON.stringify(files),
    title: game.title,
    tagline: game.tagline,
    thumbnail: game.thumbnail,
    published_at: now(),
  };
  db.prepare(
    `INSERT INTO builds (id, game_id, files_json, title, tagline, thumbnail, published_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(build.id, build.game_id, build.files_json, build.title, build.tagline, build.thumbnail, build.published_at);

  db.prepare("UPDATE games SET visibility = 'public', published_at = ? WHERE id = ?").run(build.published_at, gameId);
  return build;
}

export function unpublishGame(gameId: string) {
  db.prepare("UPDATE games SET visibility = 'private' WHERE id = ?").run(gameId);
}

export function setVisibility(gameId: string, visibility: Visibility) {
  if (visibility === "public") publishGame(gameId);
  else unpublishGame(gameId);
}

export function latestBuild(gameId: string): Build | null {
  const row = db
    .prepare("SELECT * FROM builds WHERE game_id = ? ORDER BY published_at DESC LIMIT 1")
    .get(gameId);
  return row ? plain<Build>(row) : null;
}

/** The published tree, or null if this game has never been published. */
export function publishedFiles(gameId: string): FileMap | null {
  const build = latestBuild(gameId);
  if (!build) return null;
  try {
    return JSON.parse(build.files_json) as FileMap;
  } catch {
    return null;
  }
}

export function hasUnpublishedChanges(game: Game): boolean {
  const build = latestBuild(game.id);
  if (!build) return true;
  return game.updated_at > build.published_at;
}

export function recordPlay(gameId: string) {
  db.prepare("UPDATE games SET play_count = play_count + 1 WHERE id = ?").run(gameId);
}

export function toggleLike(gameId: string, userId: string): { liked: boolean; count: number } {
  const existing = db.prepare("SELECT 1 FROM likes WHERE game_id = ? AND user_id = ?").get(gameId, userId);
  if (existing) db.prepare("DELETE FROM likes WHERE game_id = ? AND user_id = ?").run(gameId, userId);
  else db.prepare("INSERT INTO likes (game_id, user_id, created_at) VALUES (?, ?, ?)").run(gameId, userId, now());

  const row = db.prepare("SELECT COUNT(*) AS c FROM likes WHERE game_id = ?").get(gameId) as { c: number };
  return { liked: !existing, count: row.c };
}

export function forkGame(sourceId: string, userId: string): Game {
  const source = getGame(sourceId);
  if (!source) throw new Error("Game not found.");
  if (source.visibility !== "public" && source.user_id !== userId) {
    throw new Error("That game is private.");
  }
  // Fork what the public can actually play, not the author's in-progress draft.
  const files = source.user_id === userId ? getFiles(sourceId) : publishedFiles(sourceId) ?? getFiles(sourceId);

  const id = newId();
  const ts = now();
  const title = `${source.title} (remix)`;
  db.prepare(
    `INSERT INTO games (id, user_id, title, tagline, slug, hue, visibility, preview_key,
                        model, summary, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'private', ?, ?, ?, ?, ?)`
  ).run(id, userId, title, source.tagline, slugify(title), hueFromId(id), newId(24), DEFAULT_MODEL, source.summary, ts, ts);

  const insert = db.prepare(
    "INSERT INTO game_files (game_id, path, content, updated_at) VALUES (?, ?, ?, ?)"
  );
  for (const [path, content] of Object.entries(files)) insert.run(id, path, content, ts);

  return getGame(id)!;
}

export function deleteGame(gameId: string) {
  db.prepare("DELETE FROM games WHERE id = ?").run(gameId);
}
