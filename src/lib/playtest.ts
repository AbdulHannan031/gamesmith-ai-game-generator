import { execFile } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import type { FileMap } from "./types";

const run = promisify(execFile);

interface StateSummary {
  available: boolean;
  samples?: number;
  scenes?: string[];
  scoreChanged?: boolean;
  levelChanged?: boolean;
  livesChanged?: boolean;
  everWon?: boolean;
  everDied?: boolean;
  playerTracked?: boolean;
  playerRange?: number;
  playerNaN?: boolean;
  finalScore?: number | null;
  levelsSeen?: number[];
  declaredLevels?: number | null;
}

interface Report {
  ok: boolean;
  frames: number;
  errors: string[];
  logs: string[];
  draws: Record<string, number>;
  colours: number;
  texts: string[];
  boot: string;
  state: StateSummary;
  physics: { available: boolean; failures: string[] };
}

/**
 * Runs the game's real module graph in a child process against a stubbed DOM,
 * so the assistant can find out whether it actually runs before claiming it does.
 * Isolated and time-limited: a hanging game cannot take the server with it.
 */
export interface PlaytestOutcome {
  text: string;
  /** False when nothing baked was drawn — characters are raw canvas shapes. */
  sawDrawImage: boolean;
  failed: boolean;
}

export async function playtest(files: FileMap, frames = 3200): Promise<PlaytestOutcome> {
  const bad = (text: string): PlaytestOutcome => ({ text, sawDrawImage: true, failed: true });

  if (!files["main.js"]) return bad("There is no main.js, so there is nothing to run.");

  const dir = mkdtempSync(join(tmpdir(), "gs-playtest-"));
  try {
    for (const [path, content] of Object.entries(files)) {
      if (!/\.(js|mjs)$/i.test(path)) continue;
      const full = join(dir, path);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, content);
    }

    const script = join(process.cwd(), "scripts", "playtest.mjs");
    let stdout = "";
    try {
      ({ stdout } = await run(process.execPath, [script, dir, String(frames)], {
        timeout: 45_000,
        maxBuffer: 4_000_000,
      }));
    } catch (err) {
      const e = err as { killed?: boolean; stdout?: string; stderr?: string };
      if (e.killed) {
        return bad("PLAYTEST FAILED: the game hung and had to be killed after 45 seconds. Something is looping forever — check for a `while` loop without an exit, or an update that never advances its timer.");
      }
      if (e.stdout) stdout = e.stdout;
      else return bad(`PLAYTEST FAILED to start: ${String(e.stderr || err).slice(0, 600)}`);
    }

    let report: Report;
    try {
      report = JSON.parse(stdout);
    } catch {
      return bad(`PLAYTEST produced no usable report. Raw output: ${stdout.slice(0, 400)}`);
    }
    return {
      text: format(report),
      sawDrawImage: (report.draws?.drawImage ?? 0) > 0,
      failed: report.errors.length > 0 || report.physics.failures.length > 0,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function format(r: Report): string {
  const lines: string[] = [];
  const problems: string[] = [];

  if (r.errors.length) {
    lines.push(`PLAYTEST FAILED after ${r.frames} frames.\n`);
    lines.push("Crashes:");
    for (const e of r.errors) lines.push(`- ${e}`);
  }

  if (r.physics.failures.length) {
    lines.push(lines.length ? "\nPhysics is broken:" : `PLAYTEST FAILED — physics is broken.\n`);
    for (const f of r.physics.failures) lines.push(`- ${f}`);
    lines.push("Use moveAndCollide from physics.js rather than your own collision.");
  }

  if (r.errors.length || r.physics.failures.length) {
    lines.push("\nFix these before replying to the user. Read every file named above in full first.");
    return lines.join("\n");
  }

  lines.push(`Ran ${r.frames} frames (about ${Math.round(r.frames / 60)}s of play) across four input strategies: start, run right, run left, explore.`);
  if (r.physics.available) lines.push("Physics: collision, wall stops in both directions and fast-movement tunnelling all pass.");

  const s = r.state;
  if (!s.available) {
    problems.push(
      "The game does not expose window.__GS_STATE(), so its rules could not be checked at all — only that it does not crash. " +
        "Return a state() from createGame reporting { scene, score, lives, level, levels, won, dead, player:{x,y} } and expose it in main.js."
    );
  } else {
    lines.push(
      `Rules observed over ${s.samples} samples: scenes ${(s.scenes ?? []).join(" → ") || "(none reported)"}` +
        (s.levelsSeen?.length ? `, levels reached ${s.levelsSeen.join(", ")}` : "") +
        (s.finalScore !== null && s.finalScore !== undefined ? `, final score ${s.finalScore}` : "")
    );

    if (s.playerTracked && !s.playerNaN && (s.playerRange ?? 0) < 24) {
      problems.push(
        `The player only moved ${s.playerRange}px in the whole run. Either movement is broken, or it is stuck against something immediately.`
      );
    }
    if (s.playerNaN) {
      problems.push("The player's position became NaN — something divided by zero or used an undefined value in the physics.");
    }
    if (!s.playerTracked) {
      problems.push("state() does not report player:{x,y}, so it could not be checked that the character actually moves. Add it.");
    }
    if (!s.scoreChanged) {
      problems.push("The score never changed in a minute of play. Either nothing is collectable, the pickups are unreachable, or scoring is not wired up.");
    }
    if (!s.livesChanged && !s.everDied) {
      problems.push("The player never lost a life or died. Either nothing is dangerous, or the hazards do not actually hit.");
    }
    if (!s.levelChanged && (s.declaredLevels ?? 1) > 1) {
      problems.push(
        `The game declares ${s.declaredLevels} levels but never advanced past level ${(s.levelsSeen ?? [1])[0]}. The goal may be unreachable — walk the level and check the gaps against the jump arc.`
      );
    }
    if (!s.everWon) {
      problems.push("The win state was never reached. That may be fine if the game is long, but confirm a player can actually finish it.");
    }
  }

  const draws = Object.entries(r.draws)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([k, n]) => `${k} ${n}`)
    .join(", ");
  lines.push(`Draw calls: ${draws || "none"} · ${r.colours} distinct fill colours`);
  if (r.texts.length) lines.push(`On-screen text: ${r.texts.slice(0, 8).join(" · ")}`);

  if (!r.draws.drawImage) {
    problems.push("drawImage was never called, so no baked sprite was drawn. Characters made of fillRect and arc read as placeholder art.");
  }
  if (r.colours < 5) problems.push(`Only ${r.colours} distinct fill colours were used — the game is likely visually flat.`);
  if (!r.texts.length) problems.push("No text was drawn at all — there is no HUD, title screen or feedback.");
  if (r.logs.length) problems.push(`Console warnings during the run: ${r.logs.slice(0, 3).join(" | ")}`);

  if (problems.length) {
    lines.push("\nIt runs, but these need attention:");
    for (const p of problems) lines.push(`- ${p}`);
    lines.push("\nFix what you can before replying. If something here is expected for this design, say why in one line.");
  } else {
    lines.push("\nNo problems found: it runs, the physics holds, the player moves, scoring fires, hazards bite and the game can be finished.");
  }

  lines.push(
    "\nThis harness plays blind — it cannot see the screen. Use look for anything visual."
  );
  return lines.join("\n");
}
