import { db, newId, now, plainAll } from "./db";
import type { ScoreRow } from "./runtime";

const MAX_SAVE_BYTES = 64_000;

export function loadSave(gameId: string, userId: string): Record<string, unknown> {
  const row = db.prepare("SELECT data FROM saves WHERE game_id = ? AND user_id = ?").get(gameId, userId) as
    | { data: string }
    | undefined;
  if (!row) return {};
  try {
    return JSON.parse(row.data) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function storeSave(gameId: string, userId: string, data: unknown): void {
  const serialised = JSON.stringify(data ?? {});
  if (serialised.length > MAX_SAVE_BYTES) {
    throw new Error(`Save data is ${Math.round(serialised.length / 1024)} KB, over the 64 KB limit.`);
  }
  db.prepare(
    `INSERT INTO saves (game_id, user_id, data, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(game_id, user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`
  ).run(gameId, userId, serialised, now());
}

export function submitScore(gameId: string, userId: string, score: number): void {
  const value = Math.max(0, Math.min(Math.round(score), 2_000_000_000));
  db.prepare("INSERT INTO scores (id, game_id, user_id, score, created_at) VALUES (?, ?, ?, ?, ?)").run(
    newId(),
    gameId,
    userId,
    value,
    now()
  );
  // Keep one row per player: their best. Otherwise the board fills with one person.
  db.prepare(
    `DELETE FROM scores
      WHERE game_id = ? AND user_id = ?
        AND id NOT IN (SELECT id FROM scores WHERE game_id = ? AND user_id = ? ORDER BY score DESC LIMIT 1)`
  ).run(gameId, userId, gameId, userId);
}

export function leaderboard(gameId: string, limit = 10): ScoreRow[] {
  return plainAll<ScoreRow>(
    db
      .prepare(
        `SELECT u.display_name AS name, s.score, s.created_at
           FROM scores s JOIN users u ON u.id = s.user_id
          WHERE s.game_id = ?
          ORDER BY s.score DESC, s.created_at ASC
          LIMIT ?`
      )
      .all(gameId, limit)
  );
}
