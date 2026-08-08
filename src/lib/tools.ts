import { Parser } from "acorn";
import { undefinedNames, spriteIssues, hasSpriteGrids } from "./lint";
import { playtest } from "./playtest";
import { lookAtGame, type Shot } from "./screenshot";
import { generateSprite, paletteFrom } from "./spritegen";
import { deleteFile, getFiles, updateGameMeta, writeFile } from "./games";
import { getSkill, allSkills } from "./skills";
import { truncate } from "./tokens";
import type { FileMap, ToolTrace } from "./types";

const ALLOWED_EXT = new Set(["js", "mjs", "css", "html", "json", "md", "txt", "svg"]);
const MAX_FILE_BYTES = 220_000;
const MAX_FILES = 60;

export interface ToolContext {
  gameId: string;
  files: FileMap;
  /** Skills already loaded this run — reloading wastes a turn and tokens. */
  loadedSkills: Set<string>;
  filesTouched: boolean;
  /** Set when a whole file of rendering code was written — the quality gate's trigger. */
  wroteVisuals: boolean;
  /** Set once the game has been run headlessly this turn. */
  playtested: boolean;
  /** Set once the assistant has actually looked at the running game. */
  looked: boolean;
  /** Set when a sprite was drawn by the image model this turn. */
  generatedSprite: boolean;
  /** Set when pixel-grid sprite data was written by hand this turn. */
  handAuthoredSprite: boolean;
  /** False once a playtest showed the game draws no baked sprites at all. */
  sawDrawImage: boolean;
  /** Where the live draft is served, for the browser to load. */
  previewUrl: string;
  /** Consecutive failed edits per file — after a few, stop retrying and rewrite. */
  editFailures: Map<string, number>;
  metaChanged: { title?: string; tagline?: string } | null;
}

/** Canvas drawing calls, i.e. this write decides what the player actually sees. */
const DRAWS = /\bctx\.(fillRect|arc|drawImage|fillText|beginPath|moveTo|ellipse|roundRect)\b/;

export interface ToolResult {
  output: string;
  trace: ToolTrace;
  /** Screenshots to hand back as a follow-up user message; tool results are text-only. */
  images?: Shot[];
}

/* ------------------------------------------------------------- validation -- */

function checkPath(path: string): string | null {
  const p = path.trim().replace(/^\.\//, "");
  if (!p) return "Path is empty.";
  if (p.startsWith("/") || p.includes("..")) return `Invalid path "${path}". Use a relative path like "game.js" or "src/enemy.js".`;
  if (p.length > 120) return "Path is too long.";
  if (!/^[a-zA-Z0-9._\-/]+$/.test(p)) return `Invalid path "${path}". Letters, numbers, dots, dashes, underscores and slashes only.`;
  const ext = p.split(".").pop()?.toLowerCase() ?? "";
  if (!ALLOWED_EXT.has(ext)) {
    return `Cannot create "${p}". Allowed file types: ${[...ALLOWED_EXT].join(", ")}. Games are code-only — draw art with Canvas2D and synthesise audio with WebAudio.`;
  }
  return null;
}

const normalise = (path: string) => path.trim().replace(/^\.\//, "");

/**
 * Parses JS before it is saved so a syntax error comes back to the model as a
 * tool error it can immediately fix, rather than as a blank screen for the user.
 */
function syntaxError(path: string, content: string): string | null {
  if (!/\.(js|mjs)$/i.test(path)) return null;
  try {
    Parser.parse(content, { ecmaVersion: "latest", sourceType: "module", allowAwaitOutsideFunction: true });
    return null;
  } catch (err) {
    const e = err as Error & { loc?: { line: number; column: number } };
    const line = e.loc?.line;
    const near = line ? content.split("\n")[line - 1]?.trim().slice(0, 120) : "";
    return `Syntax error in ${path}${line ? ` at line ${line}` : ""}: ${e.message}${near ? `\n\n  ${line} | ${near}` : ""}\n\nThe file was NOT saved. Fix the syntax and call the tool again.`;
  }
}

/**
 * Resolves the module graph after every write. Catches the failure the syntax
 * checker cannot see — an import path that does not exist, or a name the target
 * file never exports — which would otherwise surface as a blank screen.
 */
function linkErrors(files: FileMap): string[] {
  const problems: string[] = [];
  const resolve = (spec: string, from: string): string | null => {
    if (/^(https?:|data:|blob:|node:)/.test(spec)) return null;
    let target = spec.replace(/^\.\//, "");
    if (target.startsWith("../") || spec.startsWith("../")) {
      const dir = from.split("/").slice(0, -1);
      for (const part of spec.split("/")) {
        if (part === "..") dir.pop();
        else if (part !== ".") dir.push(part);
      }
      target = dir.join("/");
    } else if (from.includes("/") && !spec.startsWith("/")) {
      const dir = from.split("/").slice(0, -1).join("/");
      if (dir && files[`${dir}/${target}`] !== undefined) target = `${dir}/${target}`;
    }
    return target.replace(/^\//, "");
  };

  for (const [path, src] of Object.entries(files)) {
    if (!/\.(js|mjs)$/i.test(path)) continue;

    for (const m of src.matchAll(/(?:\bfrom|\bimport)\s*\(?\s*["']([^"']+)["']/g)) {
      const spec = m[1];
      if (/^(https?:|data:|blob:)/.test(spec)) {
        problems.push(`${path} imports "${spec}" — the sandbox has no network access.`);
        continue;
      }
      const target = resolve(spec, path);
      if (target && files[target] === undefined) {
        problems.push(`${path} imports "${spec}" but no such file exists. Files: ${Object.keys(files).join(", ")}`);
      }
    }

    for (const m of src.matchAll(/import\s*\{([^}]+)\}\s*from\s*["']([^"']+)["']/g)) {
      const target = resolve(m[2], path);
      const source = target ? files[target] : undefined;
      if (!source) continue;
      for (const raw of m[1].split(",")) {
        const name = raw.trim().split(/\s+as\s+/)[0].trim();
        if (!name) continue;
        const exported = new RegExp(
          `export\\s+(?:default\\s+)?(?:async\\s+)?(?:const|let|var|function\\*?|class)\\s+${name}\\b` +
            `|export\\s*\\{[^}]*\\b${name}\\b` +
            `|export\\s*\\*\\s*from`
        );
        if (!exported.test(source)) {
          problems.push(`${path} imports { ${name} } from "${m[2]}", but ${target} does not export ${name}.`);
        }
      }
    }
  }
  return problems.slice(0, 8);
}

/** Flags the mistakes this runtime cannot support, at write time. */
function runtimeWarnings(content: string): string[] {
  const warn: string[] = [];
  if (/\blocalStorage\b|\bindexedDB\b|\bsessionStorage\b/.test(content)) {
    warn.push("This runtime blocks localStorage/sessionStorage/IndexedDB — they throw on the sandboxed origin. Use GameSave.get / GameSave.set instead.");
  }
  if (/\bfetch\s*\(|XMLHttpRequest|new\s+Image\s*\(\s*\)[\s\S]{0,80}\.src\s*=\s*["']https?:/.test(content)) {
    warn.push("No network access is available in the sandbox. Draw art with Canvas2D rather than loading it.");
  }
  if (/<script[^>]+src=["']https?:/i.test(content) || /@import\s+url\(["']?https?:/i.test(content)) {
    warn.push("External scripts and stylesheets cannot load in the sandbox. Everything must be local files.");
  }
  return warn;
}

const lineCount = (s: string) => s.split("\n").length;

const undefinedRefs = (path: string, content: string): string[] =>
  /\.(js|mjs)$/i.test(path)
    ? undefinedNames(content).map((n) => `${path} uses "${n}" but it is never defined or imported — this will throw at runtime.`)
    : [];

const indentOf = (line: string) => /^[ \t]*/.exec(line)![0];

/**
 * Second chance for an edit whose text is right but whose indentation is not.
 * Matches on trimmed lines, then re-indents the replacement to whatever the file
 * actually uses. Without this, models burn entire turns retrying whitespace.
 */
function looseReplace(
  content: string,
  oldText: string,
  newText: string
): { updated: string; matched: boolean; ambiguous: boolean } {
  const fileLines = content.split("\n");
  const oldLines = oldText.replace(/\n+$/, "").split("\n");
  const key = (l: string) => l.trim();
  const needle = oldLines.map(key);

  const hits: number[] = [];
  for (let i = 0; i + needle.length <= fileLines.length; i++) {
    let ok = true;
    for (let j = 0; j < needle.length; j++) {
      if (key(fileLines[i + j]) !== needle[j]) {
        ok = false;
        break;
      }
    }
    if (ok) hits.push(i);
  }

  if (hits.length !== 1) return { updated: content, matched: false, ambiguous: hits.length > 1 };

  const at = hits[0];
  const fileIndent = indentOf(fileLines[at]);
  const oldIndent = indentOf(oldLines[0]);

  const reindented = newText.split("\n").map((line) => {
    if (!line.trim()) return "";
    return line.startsWith(oldIndent) ? fileIndent + line.slice(oldIndent.length) : fileIndent + line.trim();
  });

  const updated = [...fileLines.slice(0, at), ...reindented, ...fileLines.slice(at + needle.length)].join("\n");
  return { updated, matched: true, ambiguous: false };
}

/* ------------------------------------------------------------ definitions -- */

export const TOOL_DEFS = [
  {
    type: "function" as const,
    function: {
      name: "list_files",
      description: "List every file in the game with its size. Cheap — use it to orient before reading.",
      parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
      strict: true,
    },
  },
  {
    type: "function" as const,
    function: {
      name: "read_file",
      description:
        'Read a file with line numbers. Always read a file before editing it. Output is formatted "12 | code" — the number and the pipe are a gutter, not part of the file, so strip them before using the text in edit_file. Pass start_line and end_line to read part of a large file.',
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: 'Relative path, e.g. "game.js"' },
          start_line: { type: ["integer", "null"], description: "1-indexed first line, or null for the start" },
          end_line: { type: ["integer", "null"], description: "1-indexed last line, or null for the end" },
        },
        required: ["path", "start_line", "end_line"],
        additionalProperties: false,
      },
      strict: true,
    },
  },
  {
    type: "function" as const,
    function: {
      name: "edit_file",
      description:
        "Replace an exact snippet in a file. This is the preferred way to change existing code. old_text must match the file byte for byte, including indentation, and must be unique unless replace_all is true.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          old_text: { type: "string", description: "Exact text to find. Include enough surrounding context to be unique." },
          new_text: { type: "string", description: "Replacement text. Use an empty string to delete the snippet." },
          replace_all: { type: ["boolean", "null"], description: "Replace every occurrence instead of requiring uniqueness" },
        },
        required: ["path", "old_text", "new_text", "replace_all"],
        additionalProperties: false,
      },
      strict: true,
    },
  },
  {
    type: "function" as const,
    function: {
      name: "write_file",
      description:
        "Create a new file, or completely replace an existing one. For files that already exist, prefer edit_file — write_file discards everything you have not read.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          content: { type: "string", description: "Full file contents" },
        },
        required: ["path", "content"],
        additionalProperties: false,
      },
      strict: true,
    },
  },
  {
    type: "function" as const,
    function: {
      name: "delete_file",
      description: "Delete a file from the game.",
      parameters: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
        additionalProperties: false,
      },
      strict: true,
    },
  },
  {
    type: "function" as const,
    function: {
      name: "load_skill",
      description:
        "Load a professional game development reference into context. Use before designing a game, building a scene, or writing movement, collision, art, audio or balance code.",
      parameters: {
        type: "object",
        properties: { name: { type: "string", description: "Skill name from the list in your instructions" } },
        required: ["name"],
        additionalProperties: false,
      },
      strict: true,
    },
  },
  {
    type: "function" as const,
    function: {
      name: "generate_sprite",
      description:
        "Draw ONE character with an image model and convert it into the toolkit pixel-grid format (a small palette plus row strings, ready for bake()). Returns the code to paste plus a magnified preview so you can judge whether it reads. USE THIS FOR EVERY CHARACTER, ENEMY AND BOSS — hand-authored grids reliably come out as unrecognisable blobs, and this is the single biggest difference between a game that looks made and one that looks generated. Hand-author only simple geometric props like crates, coins and tiles. Call it once per distinct character type — the player, and each enemy or unit kind — then derive the animation frames by editing the returned rows.",
      parameters: {
        type: "object",
        properties: {
          description: { type: "string", description: "What to draw, e.g. \"a knight with a plumed helmet and cape, standing\"" },
          name: { type: "string", description: "Constant name for the generated grid, e.g. KNIGHT_IDLE" },
          width: { type: ["integer", "null"], description: "Grid width in pixels (default 24). Use 12-32 for characters." },
          height: { type: ["integer", "null"], description: "Grid height in pixels (default 28)." },
          colours: { type: ["integer", "null"], description: "Colours before the outline is added (default 5)." },
          view: { type: ["string", "null"], enum: ["side", "top-down", null], description: "Camera angle the game uses." },
          match_palette: { type: ["boolean", "null"], description: "Snap colours to the palette already in config.js, for a coherent cast." },
        },
        required: ["description", "name", "width", "height", "colours", "view", "match_palette"],
        additionalProperties: false,
      },
      strict: true,
    },
  },
  {
    type: "function" as const,
    function: {
      name: "look",
      description:
        "Run the game in a real browser and look at it. Returns screenshots of the title screen, mid-play and mid-jump, plus any console errors. Use this to judge your own art and layout — whether the character reads, whether the scene has depth, whether the HUD is legible. Run it before telling the user a visual change is done.",
      parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
      strict: true,
    },
  },
  {
    type: "function" as const,
    function: {
      name: "playtest",
      description:
        "Run the game headlessly and report what happened. It boots the real module graph against a stubbed canvas, drives the keyboard for a few hundred frames, and reports crashes, draw activity and on-screen text. Run this after any change to the game code and before telling the user it works.",
      parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
      strict: true,
    },
  },
  {
    type: "function" as const,
    function: {
      name: "set_meta",
      description:
        "Set the game's public title, one-line tagline, and the internal summary used to brief future sessions. Give every game a real title as soon as its design is clear.",
      parameters: {
        type: "object",
        properties: {
          title: { type: ["string", "null"], description: "Public title, max 80 chars" },
          tagline: { type: ["string", "null"], description: "One line shown in the gallery, max 120 chars" },
          summary: { type: ["string", "null"], description: "Internal design/architecture brief for future sessions" },
        },
        required: ["title", "tagline", "summary"],
        additionalProperties: false,
      },
      strict: true,
    },
  },
];

/* -------------------------------------------------------------- execution -- */

const fail = (name: string, summary: string, output: string): ToolResult => ({
  output,
  trace: { id: "", name, summary, ok: false, detail: output.slice(0, 400) },
});

export async function executeTool(name: string, rawArgs: string, ctx: ToolContext): Promise<ToolResult> {
  let args: Record<string, unknown>;
  try {
    args = rawArgs ? JSON.parse(rawArgs) : {};
  } catch {
    return fail(name, "bad arguments", "Arguments were not valid JSON. Send the tool call again with well-formed JSON.");
  }

  switch (name) {
    case "list_files": {
      const entries = Object.entries(ctx.files);
      const body = entries.length
        ? entries.map(([p, c]) => `${p} — ${lineCount(c)} lines`).join("\n")
        : "(no files yet)";
      return { output: body, trace: { id: "", name, summary: `${entries.length} files`, ok: true } };
    }

    case "read_file": {
      const path = normalise(String(args.path ?? ""));
      const content = ctx.files[path];
      if (content === undefined) {
        return fail(name, path, `No file at "${path}". Files: ${Object.keys(ctx.files).join(", ") || "(none)"}`);
      }
      const lines = content.split("\n");
      const start = Math.max(1, Number(args.start_line) || 1);
      const end = Math.min(lines.length, Number(args.end_line) || lines.length);
      // " 12 | code" — an explicit gutter. A tab here reads as file indentation
      // and makes models reproduce the wrong whitespace in edit_file.
      const width = String(end).length;
      const body = lines
        .slice(start - 1, end)
        .map((l, i) => `${String(start + i).padStart(width, " ")} | ${l}`)
        .join("\n");
      const range = start === 1 && end === lines.length ? `${lines.length} lines` : `lines ${start}-${end}`;
      return {
        output: truncate(body),
        trace: { id: "", name, summary: `${path} · ${range}`, ok: true },
      };
    }

    case "write_file": {
      const path = normalise(String(args.path ?? ""));
      const content = String(args.content ?? "");
      const pathError = checkPath(path);
      if (pathError) return fail(name, path, pathError);
      if (content.length > MAX_FILE_BYTES) {
        return fail(name, path, `That file is ${Math.round(content.length / 1024)} KB, over the ${Math.round(MAX_FILE_BYTES / 1024)} KB limit. Split it into modules.`);
      }
      if (!ctx.files[path] && Object.keys(ctx.files).length >= MAX_FILES) {
        return fail(name, path, `This game already has ${MAX_FILES} files. Consolidate before adding more.`);
      }
      const syn = syntaxError(path, content);
      if (syn) return fail(name, path, syn);

      const existed = ctx.files[path] !== undefined;
      writeFile(ctx.gameId, path, content);
      ctx.files[path] = content;
      ctx.filesTouched = true;
      if (DRAWS.test(content)) ctx.wroteVisuals = true;
      if (hasSpriteGrids(content)) ctx.handAuthoredSprite = true;

      const warnings = [...runtimeWarnings(content), ...linkErrors(ctx.files), ...undefinedRefs(path, content), ...spriteIssues(path, content)];
      return {
        output: `Saved ${path} (${lineCount(content)} lines).${warnings.length ? `\n\nFix these before you finish:\n- ${warnings.join("\n- ")}` : ""}`,
        trace: {
          id: "",
          name,
          summary: `${existed ? "rewrote" : "created"} ${path}`,
          ok: true,
          detail: warnings.join(" "),
        },
      };
    }

    case "edit_file": {
      const path = normalise(String(args.path ?? ""));
      const oldText = String(args.old_text ?? "");
      const newText = String(args.new_text ?? "");
      const all = args.replace_all === true;
      const content = ctx.files[path];

      if (content === undefined) return fail(name, path, `No file at "${path}". Use write_file to create it.`);
      if (!oldText) return fail(name, path, "old_text was empty. Provide the exact snippet to replace.");

      const count = content.split(oldText).length - 1;

      // Exact match failed: retry ignoring indentation before giving up, since
      // that is what almost every failed edit actually is.
      if (count === 0) {
        const loose = looseReplace(content, oldText, newText);
        if (loose.matched) {
          const syn = syntaxError(path, loose.updated);
          if (syn) return fail(name, path, syn);
          writeFile(ctx.gameId, path, loose.updated);
          ctx.files[path] = loose.updated;
          ctx.filesTouched = true;
          ctx.editFailures.delete(path);
          if (DRAWS.test(newText)) ctx.wroteVisuals = true;
          const warnings = [...runtimeWarnings(newText), ...linkErrors(ctx.files), ...undefinedRefs(path, ctx.files[path]), ...spriteIssues(path, ctx.files[path])];
          return {
            output:
              `Edited ${path} — your snippet's indentation did not match, so it was matched on content and re-indented to the file's style. Now ${lineCount(loose.updated)} lines.` +
              (warnings.length ? `\n\nFix these before you finish:\n- ${warnings.join("\n- ")}` : ""),
            trace: { id: "", name, summary: `${path} (re-indented)`, ok: true },
          };
        }
        const strikes = (ctx.editFailures.get(path) ?? 0) + 1;
        ctx.editFailures.set(path, strikes);
        if (strikes >= 3) {
          return fail(
            name,
            path,
            `That is ${strikes} failed edits on ${path} in a row. Stop using edit_file on this file — read it in full, then call write_file once with the complete new contents.`
          );
        }
        return fail(
          name,
          path,
          `Could not find that text in ${path}${
            loose.ambiguous ? ", and ignoring indentation it matched in several places" : ""
          }. Read the file again and copy the snippet exactly from the output, without the "12 | " gutter. If the region has changed a lot, use write_file with the complete new contents instead.`
        );
      }

      if (count > 1 && !all) {
        return fail(
          name,
          path,
          `That snippet appears ${count} times in ${path}. Include more surrounding context to make it unique, or pass replace_all: true.`
        );
      }

      const updated = all ? content.split(oldText).join(newText) : content.replace(oldText, newText);
      const syn = syntaxError(path, updated);
      if (syn) return fail(name, path, syn);

      writeFile(ctx.gameId, path, updated);
      ctx.files[path] = updated;
      ctx.filesTouched = true;
      ctx.editFailures.delete(path);
      if (DRAWS.test(newText)) ctx.wroteVisuals = true;
      if (hasSpriteGrids(updated)) ctx.handAuthoredSprite = true;

      const delta = lineCount(updated) - lineCount(content);
      const warnings = [
        ...runtimeWarnings(newText),
        ...linkErrors(ctx.files),
        ...undefinedRefs(path, updated),
        ...spriteIssues(path, updated),
      ];
      return {
        output: `Edited ${path}${count > 1 ? ` (${count} occurrences)` : ""}. Now ${lineCount(updated)} lines.${
          warnings.length ? `\n\nFix these before you finish:\n- ${warnings.join("\n- ")}` : ""
        }`,
        trace: {
          id: "",
          name,
          summary: `${path} ${delta >= 0 ? "+" : ""}${delta} lines`,
          ok: true,
        },
      };
    }

    case "delete_file": {
      const path = normalise(String(args.path ?? ""));
      if (path === "index.html") {
        return fail(name, path, "index.html is the entry point and cannot be deleted. Rewrite it instead.");
      }
      if (ctx.files[path] === undefined) return fail(name, path, `No file at "${path}".`);
      deleteFile(ctx.gameId, path);
      delete ctx.files[path];
      ctx.filesTouched = true;
      return { output: `Deleted ${path}.`, trace: { id: "", name, summary: `deleted ${path}`, ok: true } };
    }

    case "generate_sprite": {
      const description = String(args.description ?? "").trim();
      if (!description) return fail(name, "no description", "Describe what to draw.");
      const label = String(args.name ?? "SPRITE").replace(/[^A-Za-z0-9_]/g, "_").toUpperCase() || "SPRITE";
      const w = Math.max(8, Math.min(64, Number(args.width) || 24));
      const h = Math.max(8, Math.min(64, Number(args.height) || 28));
      const cols = Math.max(2, Math.min(10, Number(args.colours) || 5));

      try {
        const result = await generateSprite(description, {
          width: w,
          height: h,
          colours: cols,
          view: args.view === "top-down" ? "top-down" : "side",
          name: label,
          matchPalette: args.match_palette === true ? paletteFrom(ctx.files) : [],
        });
        ctx.wroteVisuals = true;
        ctx.generatedSprite = true;
        return {
          output:
            `Generated ${label} at ${result.width}x${result.height} with ${result.colours} colours ` +
            `(including the outline). A magnified preview follows as an image — check it reads as ` +
            `"${description}" before using it. If it does not, call generate_sprite again with a clearer ` +
            `description or a different size rather than shipping something unreadable.\n\n` +
            `Paste this into the file that owns your sprites, then derive the animation frames by editing the rows:\n\n` +
            result.code,
          trace: { id: "", name, summary: `${label} ${result.width}x${result.height}`, ok: true },
          images: [{ label: `${label} (magnified 8x)`, dataUrl: `data:image/png;base64,${result.previewPng.toString("base64")}` }],
        };
      } catch (err) {
        return fail(name, label, `Could not generate that sprite: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    case "look": {
      const { shots, errors, note } = await lookAtGame(ctx.previewUrl);
      ctx.looked = true;
      const lines: string[] = [];
      if (note) lines.push(note);
      if (errors.length) {
        lines.push("Console errors while it ran:");
        for (const e of errors) lines.push("- " + e);
      }
      lines.push(
        shots.length
          ? `Captured ${shots.length} screenshots (${shots.map((s) => s.label).join(", ")}). They follow as images — study them and judge the art honestly: does the character read as what it is meant to be, does the scene have depth, is the player the most readable thing on screen, is the HUD legible? Fix what is weak rather than describing it.`
          : "No screenshots were captured."
      );
      return {
        output: lines.join("\n"),
        trace: { id: "", name, summary: shots.length ? `${shots.length} screenshots` : note ? "unavailable" : "nothing captured", ok: shots.length > 0 },
        images: shots,
      };
    }

    case "playtest": {
      const outcome = await playtest(ctx.files);
      ctx.playtested = true;
      ctx.sawDrawImage = outcome.sawDrawImage;
      const report = outcome.text;
      const failed = outcome.failed || report.startsWith("PLAYTEST FAILED");
      return {
        output: report,
        trace: {
          id: "",
          name,
          summary: failed ? "crashed" : report.includes("stand out") ? "runs, with notes" : "runs clean",
          ok: !failed,
        },
      };
    }

    case "load_skill": {
      const wanted = String(args.name ?? "").trim();
      const skill = getSkill(wanted);
      if (!skill) {
        return fail(name, wanted, `No skill named "${wanted}". Available: ${allSkills().map((s) => s.name).join(", ")}`);
      }
      if (ctx.loadedSkills.has(skill.name)) {
        return {
          output: `The ${skill.name} skill is already loaded above in this conversation. Re-read it there rather than loading it again.`,
          trace: { id: "", name, summary: `${skill.name} (already loaded)`, ok: true },
        };
      }
      ctx.loadedSkills.add(skill.name);
      return {
        output: skill.body,
        trace: { id: "", name, summary: skill.title, ok: true },
      };
    }

    case "set_meta": {
      const patch: { title?: string; tagline?: string; summary?: string } = {};
      if (typeof args.title === "string" && args.title.trim()) patch.title = args.title.trim().slice(0, 80);
      if (typeof args.tagline === "string") patch.tagline = args.tagline.trim().slice(0, 120);
      if (typeof args.summary === "string" && args.summary.trim()) patch.summary = args.summary.trim().slice(0, 4000);
      if (!Object.keys(patch).length) return fail(name, "no changes", "Nothing to update — all fields were null.");

      updateGameMeta(ctx.gameId, patch);
      if (patch.title || patch.tagline !== undefined) {
        ctx.metaChanged = { ...(ctx.metaChanged ?? {}), ...patch };
      }
      const bits = [patch.title, patch.tagline].filter(Boolean);
      return {
        output: `Updated: ${Object.keys(patch).join(", ")}.`,
        trace: { id: "", name, summary: bits.length ? bits.join(" — ") : "summary updated", ok: true },
      };
    }

    default:
      return fail(name, name, `Unknown tool "${name}".`);
  }
}

export function freshContext(gameId: string, previewUrl: string): ToolContext {
  return {
    gameId,
    files: getFiles(gameId),
    loadedSkills: new Set(),
    filesTouched: false,
    wroteVisuals: false,
    playtested: false,
    looked: false,
    generatedSprite: false,
    handAuthoredSprite: false,
    sawDrawImage: true,
    previewUrl,
    editFailures: new Map(),
    metaChanged: null,
  };
}
