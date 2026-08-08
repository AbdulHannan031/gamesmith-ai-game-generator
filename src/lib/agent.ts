import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { openai } from "./openai";
import { db, newId, now, plainAll } from "./db";
import { addUsage, getGame } from "./games";
import { COMPACTION_PROMPT, systemPrompt } from "./prompt";
import { executeTool, freshContext, TOOL_DEFS } from "./tools";
import { COMPACT_AT, estimateMessageTokens, estimateTokens, KEEP_RECENT_TOKENS, modelParams } from "./tokens";
import { NUDGE_MARK } from "./transcript";
import type { ChatMessage, StreamEvent, ToolCall, ToolTrace } from "./types";

// Raised as tools were added: a from-blank build now spends steps on loading
// skills, generating art, playtesting and looking before it writes a line.
const MAX_STEPS = Number(process.env.MAX_AGENT_STEPS ?? 48);

/**
 * Cheaper models like to present a plan and stop for approval. The user is
 * watching a live preview, so a turn that changes nothing is a wasted turn —
 * detect it once and push the model straight through into building.
 */
const ASKING_PERMISSION =
  /\b(sound good|does (that|this) (sound|work)|shall i|should i (start|proceed|begin|go ahead)|would you like me to|let me know (if|whether)|if (that|this) (sounds|works)|ready to (start|build|proceed)|want me to)\b[^.?!]*\?|\?\s*$/i;

const NUDGE = `${NUDGE_MARK}Yes — go ahead now. Do not ask again: make the decisions yourself and build it in this turn, writing the files as you go. Report what you built when the game runs.`;

function stalled(reply: string, filesTouched: boolean): boolean {
  if (filesTouched || !reply.trim()) return false;
  const tail = reply.trim().slice(-260);
  return ASKING_PERMISSION.test(tail);
}

/**
 * The visual-quality gate. Rewriting a game's rendering without consulting the
 * art references reliably produces coloured rectangles, which is the commonest
 * way a generated game ends up looking unfinished. Catch it before the user does.
 */
const playtestNudge =
  `${NUDGE_MARK}You changed the game code but never ran it. Call playtest now. If it reports errors, fix the cause and run it again until it passes — do not reply to the user until it does.`;

const lookNudge =
  `${NUDGE_MARK}You changed how the game looks but never looked at it. Call look now, study the screenshots, and fix whatever is weak — a character that does not read, a flat background, an unreadable HUD. Only reply to the user once you have seen it and are satisfied.`;

const handDrawnNudge =
  `${NUDGE_MARK}You hand-authored the sprite grids instead of using generate_sprite. Hand-typed pixel art reads as a blob, which is the most common complaint about generated games. Use generate_sprite for the player and each enemy now, look at the previews, and replace the hand-typed grids with what it returns. Keep hand-authoring only for simple geometric props.`;

const shapesNudge =
  `${NUDGE_MARK}The playtest shows the game never calls drawImage, which means every character is being drawn with raw canvas shapes rather than a sprite. That is what makes a game look generated. Use generate_sprite for the player and for each distinct enemy or unit type, bake the returned grids, and draw them with drawImage. Then playtest and look again.`;

const ART_SKILLS = ["character-art", "scene-composition"] as const;

function missingArtSkills(ctx: { wroteVisuals: boolean; loadedSkills: Set<string> }): string[] {
  if (!ctx.wroteVisuals) return [];
  return ART_SKILLS.filter((s) => !ctx.loadedSkills.has(s));
}

const artNudge = (missing: string[]) =>
  `${NUDGE_MARK}You rewrote the game's rendering without loading ${missing.join(" or ")}. ` +
  `Load ${missing.length > 1 ? "both" : "it"} now, then bring the visuals up to that standard in this turn: ` +
  `the player and enemies must be authored sprites with real silhouettes and animation rather than plain ` +
  `circles and rectangles, and the background must be a composed scene with depth rather than a flat fill. ` +
  `Make those edits before replying to the user.`;


/* ------------------------------------------------------------- persistence -- */

function nextSeq(gameId: string): number {
  const row = db.prepare("SELECT COALESCE(MAX(seq), 0) AS s FROM messages WHERE game_id = ?").get(gameId) as { s: number };
  return row.s + 1;
}

export function loadHistory(gameId: string, includeCompacted = false): ChatMessage[] {
  const sql = `SELECT * FROM messages WHERE game_id = ?${includeCompacted ? "" : " AND compacted = 0"} ORDER BY seq, created_at, id`;
  return plainAll<ChatMessage>(db.prepare(sql).all(gameId));
}

function saveMessage(
  gameId: string,
  msg: {
    role: ChatMessage["role"];
    content?: string;
    tool_calls?: ToolCall[] | null;
    tool_call_id?: string | null;
    tool_name?: string | null;
    trace?: ToolTrace | null;
    seq?: number;
  }
): ChatMessage {
  const row: ChatMessage = {
    id: newId(),
    game_id: gameId,
    seq: msg.seq ?? nextSeq(gameId),
    role: msg.role,
    content: msg.content ?? "",
    tool_calls: msg.tool_calls?.length ? JSON.stringify(msg.tool_calls) : null,
    tool_call_id: msg.tool_call_id ?? null,
    tool_name: msg.tool_name ?? null,
    trace: msg.trace ? JSON.stringify(msg.trace) : null,
    compacted: 0,
    tokens: 0,
    created_at: now(),
  };
  row.tokens = estimateMessageTokens(row);
  db.prepare(
    `INSERT INTO messages (id, game_id, seq, role, content, tool_calls, tool_call_id, tool_name, trace, compacted, tokens, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
  ).run(
    row.id, row.game_id, row.seq, row.role, row.content, row.tool_calls,
    row.tool_call_id, row.tool_name, row.trace, row.tokens, row.created_at
  );
  return row;
}

/** DB rows -> the shape the API expects. */
function toApiMessages(
  history: ChatMessage[],
  rich: Map<string, ChatCompletionMessageParam["content"]>
): ChatCompletionMessageParam[] {
  const out: ChatCompletionMessageParam[] = [];
  for (const m of history) {
    if (m.role === "tool") {
      out.push({ role: "tool", tool_call_id: m.tool_call_id ?? "", content: m.content });
    } else if (m.role === "assistant") {
      const calls = m.tool_calls ? (JSON.parse(m.tool_calls) as ToolCall[]) : undefined;
      // The API rejects an assistant message with neither content nor tool_calls.
      if (!calls?.length && !m.content) continue;
      out.push({ role: "assistant", content: m.content || null, ...(calls?.length ? { tool_calls: calls } : {}) });
    } else if (m.role === "system") {
      out.push({ role: "system", content: m.content });
    } else {
      const attached = rich.get(m.id);
      out.push({ role: "user", content: attached ?? m.content } as ChatCompletionMessageParam);
    }
  }
  return out;
}

/* -------------------------------------------------------------- compaction -- */

/**
 * Folds the oldest turns into a written brief once the window gets expensive.
 * The cut always lands on a user message so an assistant's tool_calls are never
 * separated from their tool results — the API rejects that.
 */
const NO_RICH = new Map<string, ChatCompletionMessageParam["content"]>();

async function maybeCompact(
  gameId: string,
  history: ChatMessage[],
  model: string,
  emit: (e: StreamEvent) => void
): Promise<ChatMessage[]> {
  const total = history.reduce((n, m) => n + m.tokens, 0);
  if (total < COMPACT_AT) return history;

  let kept = 0;
  let cut = history.length;
  for (let i = history.length - 1; i >= 0; i--) {
    kept += history[i].tokens;
    if (kept >= KEEP_RECENT_TOKENS) {
      cut = i;
      break;
    }
  }
  while (cut < history.length && history[cut].role !== "user") cut++;
  if (cut <= 1 || cut >= history.length) return history;

  const older = history.slice(0, cut);
  const recent = history.slice(cut);

  const transcript = older
    .map((m) => {
      if (m.role === "tool") return `[tool result: ${m.tool_name}]\n${m.content.slice(0, 900)}`;
      if (m.role === "assistant" && m.tool_calls) {
        const calls = (JSON.parse(m.tool_calls) as ToolCall[]).map((c) => `${c.function.name}(${c.function.arguments.slice(0, 200)})`);
        return `[assistant] ${m.content}\n[called] ${calls.join(", ")}`;
      }
      return `[${m.role}] ${m.content}`;
    })
    .join("\n\n")
    .slice(-90_000);

  emit({ type: "status", text: "Compacting earlier turns to keep the context small…" });

  let summary: string;
  try {
    const res = await openai().chat.completions.create({
      model,
      messages: [
        { role: "system", content: COMPACTION_PROMPT },
        { role: "user", content: transcript },
      ],
      ...modelParams(model),
    });
    summary = res.choices[0]?.message?.content?.trim() || "";
    if (res.usage) addUsage(gameId, res.usage.prompt_tokens, res.usage.completion_tokens, 0);
  } catch {
    return history; // compaction is an optimisation; never fail the turn over it
  }
  if (!summary) return history;

  const ids = older.map((m) => m.id);
  db.prepare(`UPDATE messages SET compacted = 1 WHERE id IN (${ids.map(() => "?").join(",")})`).run(...ids);

  const marker = saveMessage(gameId, {
    role: "system",
    content: `Summary of earlier work in this session (the detailed transcript has been compacted away):\n\n${summary}`,
    seq: older[older.length - 1].seq,
  });

  emit({ type: "compacted", removed: older.length, summary });
  return [marker, ...recent];
}

/* -------------------------------------------------------------------- run -- */

export interface RunOptions {
  gameId: string;
  /** Origin the browser used, so the headless run can load the same draft. */
  baseUrl: string;
  userText: string;
  /** Runtime errors the player attached from the preview panel. */
  diagnostics?: string;
  /** Screenshots the user attached to show a problem. */
  images?: string[];
  signal?: AbortSignal;
  emit: (event: StreamEvent) => void;
}

export async function runAgent({ gameId, baseUrl, userText, diagnostics, images, signal, emit }: RunOptions): Promise<void> {
  const game = getGame(gameId);
  if (!game) throw new Error("Game not found.");

  const rich = new Map<string, ChatCompletionMessageParam["content"]>();
  const ctx = freshContext(gameId, `${baseUrl}/g/d/${game.id}/${game.preview_key}/index.html`);
  const model = game.model;

  const content = diagnostics
    ? `${userText}

<runtime-errors>
The game threw these while running.

Before editing anything, read every file named in the stack trace, in full. Errors like these are almost always ONE broken contract between two files — a function whose shape changed while its caller did not — not several separate bugs. Find that mismatch and fix both sides in a single pass. Patching the one line in the trace will just move the error somewhere else.

${diagnostics}
</runtime-errors>`
    : userText;

  const opening = saveMessage(gameId, {
    role: "user",
    content: images?.length ? `${content}\n\n[${images.length} screenshot${images.length === 1 ? "" : "s"} attached]` : content,
  });

  if (images?.length) {
    rich.set(opening.id, [
      { type: "text", text: content },
      ...images.map((url) => ({ type: "image_url" as const, image_url: { url, detail: "high" as const } })),
    ]);
  }

  let history = loadHistory(gameId);
  history = await maybeCompact(gameId, history, model, emit);

  let promptTokens = 0;
  let outputTokens = 0;
  let cachedTokens = 0;
  let lastMessageId = "";
  let nudged = false;
  let gated = false;
  let untested = false;
  let unseen = false;
  let handDrawn = false;
  let shapesOnly = false;

  for (let step = 0; step < MAX_STEPS; step++) {
    if (signal?.aborted) break;

    const system = systemPrompt(getGame(gameId)!, ctx.files);
    const messages: ChatCompletionMessageParam[] = [{ role: "system", content: system }, ...toApiMessages(history, rich)];

    let text = "";
    const calls: ToolCall[] = [];

    const stream = await openai().chat.completions.create(
      {
        model,
        messages,
        tools: TOOL_DEFS,
        tool_choice: "auto",
        parallel_tool_calls: false,
        ...modelParams(model),
        stream: true,
        stream_options: { include_usage: true },
      },
      { signal }
    );

    for await (const chunk of stream) {
      if (chunk.usage) {
        promptTokens += chunk.usage.prompt_tokens ?? 0;
        outputTokens += chunk.usage.completion_tokens ?? 0;
        cachedTokens += chunk.usage.prompt_tokens_details?.cached_tokens ?? 0;
      }
      const delta = chunk.choices[0]?.delta;
      if (!delta) continue;

      if (delta.content) {
        text += delta.content;
        emit({ type: "text", delta: delta.content });
      }

      for (const tc of delta.tool_calls ?? []) {
        const i = tc.index ?? 0;
        calls[i] ??= { id: "", type: "function", function: { name: "", arguments: "" } };
        if (tc.id) calls[i].id = tc.id;
        if (tc.function?.name) calls[i].function.name += tc.function.name;
        if (tc.function?.arguments) calls[i].function.arguments += tc.function.arguments;
      }
    }

    const pending = calls.filter((c) => c?.id && c.function.name);
    const assistant = saveMessage(gameId, { role: "assistant", content: text, tool_calls: pending });
    history.push(assistant);
    lastMessageId = assistant.id;

    if (!pending.length) {
      if (!nudged && stalled(text, ctx.filesTouched)) {
        nudged = true;
        emit({ type: "status", text: "Building it…" });
        history.push(saveMessage(gameId, { role: "user", content: NUDGE }));
        continue;
      }

      const missing = gated ? [] : missingArtSkills(ctx);
      if (missing.length) {
        gated = true;
        emit({ type: "status", text: "Checking the art against the reference…" });
        history.push(saveMessage(gameId, { role: "user", content: artNudge(missing) }));
        continue;
      }

      if (!untested && ctx.filesTouched && !ctx.playtested) {
        untested = true;
        emit({ type: "status", text: "Running the game to check it works…" });
        history.push(saveMessage(gameId, { role: "user", content: playtestNudge }));
        continue;
      }

      if (!shapesOnly && ctx.playtested && !ctx.sawDrawImage && ctx.filesTouched) {
        shapesOnly = true;
        emit({ type: "status", text: "Characters are shapes — drawing them properly…" });
        history.push(saveMessage(gameId, { role: "user", content: shapesNudge }));
        continue;
      }

      if (!handDrawn && ctx.handAuthoredSprite && !ctx.generatedSprite) {
        handDrawn = true;
        emit({ type: "status", text: "Drawing the characters properly…" });
        history.push(saveMessage(gameId, { role: "user", content: handDrawnNudge }));
        continue;
      }

      if (!unseen && ctx.wroteVisuals && !ctx.looked) {
        unseen = true;
        emit({ type: "status", text: "Taking a look at the result…" });
        history.push(saveMessage(gameId, { role: "user", content: lookNudge }));
        continue;
      }
      break;
    }

    for (const call of pending) {
      if (signal?.aborted) break;
      const result = await executeTool(call.function.name, call.function.arguments, ctx);
      result.trace.id = call.id;
      emit({ type: "tool", trace: result.trace });
      history.push(
        saveMessage(gameId, {
          role: "tool",
          content: result.output,
          tool_call_id: call.id,
          tool_name: call.function.name,
          trace: result.trace,
        })
      );

      if (result.images?.length) {
        const carrier = saveMessage(gameId, {
          role: "user",
          content: `${NUDGE_MARK}[${result.images.length} screenshots of the running game]`,
        });
        rich.set(carrier.id, [
          { type: "text", text: "Screenshots of the game running right now:" },
          ...result.images.map((s) => ({
            type: "image_url" as const,
            image_url: { url: s.dataUrl, detail: "high" as const },
          })),
        ]);
        history.push(carrier);
      }
    }

    if (step === MAX_STEPS - 1) {
      emit({
        type: "status",
        text: "Reached the step limit for one turn. The work so far is saved — send another message to continue.",
      });
    }
  }

  if (promptTokens || outputTokens) addUsage(gameId, promptTokens, outputTokens, cachedTokens);

  if (ctx.filesTouched) emit({ type: "files", files: ctx.files });
  if (ctx.metaChanged) {
    const fresh = getGame(gameId)!;
    emit({ type: "title", title: fresh.title, tagline: fresh.tagline });
  }

  const contextTokens = history.reduce((n, m) => n + m.tokens, 0) + estimateTokens(systemPrompt(getGame(gameId)!, ctx.files));
  emit({ type: "usage", prompt: promptTokens, output: outputTokens, cached: cachedTokens, contextTokens });
  emit({ type: "done", messageId: lastMessageId });
}
