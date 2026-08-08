export type Visibility = "private" | "public";

export interface User {
  id: string;
  email: string;
  password_hash: string;
  display_name: string;
  created_at: number;
}

export type PublicUser = Pick<User, "id" | "email" | "display_name" | "created_at">;

export interface Game {
  id: string;
  user_id: string;
  title: string;
  tagline: string;
  slug: string;
  hue: number;
  visibility: Visibility;
  preview_key: string;
  model: string;
  summary: string;
  thumbnail: string | null;
  play_count: number;
  prompt_tokens: number;
  output_tokens: number;
  cached_tokens: number;
  created_at: number;
  updated_at: number;
  published_at: number | null;
}

export interface GameFile {
  path: string;
  content: string;
  updated_at: number;
}

export type FileMap = Record<string, string>;

export interface ChatMessage {
  id: string;
  game_id: string;
  seq: number;
  role: "user" | "assistant" | "tool" | "system";
  content: string;
  tool_calls: string | null;
  tool_call_id: string | null;
  tool_name: string | null;
  trace: string | null;
  compacted: number;
  tokens: number;
  created_at: number;
}

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

/** What the editor renders for one tool invocation. */
export interface ToolTrace {
  id: string;
  name: string;
  summary: string;
  detail?: string;
  ok: boolean;
}

export type StreamEvent =
  | { type: "status"; text: string }
  | { type: "text"; delta: string }
  | { type: "tool"; trace: ToolTrace }
  | { type: "files"; files: FileMap }
  | { type: "compacted"; removed: number; summary: string }
  | { type: "usage"; prompt: number; output: number; cached: number; contextTokens: number }
  | { type: "title"; title: string; tagline: string }
  | { type: "done"; messageId: string }
  | { type: "error"; message: string };
