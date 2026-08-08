import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Runs a game in a real headless browser and photographs it.
 *
 * The stub harness in scripts/playtest.mjs proves a game does not crash. This
 * proves what it actually looks like — which is the only way the assistant can
 * judge its own art instead of assuming it worked.
 */

export interface Shot {
  label: string;
  dataUrl: string;
}

export interface LookResult {
  shots: Shot[];
  errors: string[];
  note?: string;
}

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/snap/bin/chromium",
].filter(Boolean) as string[];

export function findChrome(): string | null {
  return CHROME_CANDIDATES.find((p) => existsSync(p)) ?? null;
}

/** Beats of a short play session, chosen so the shots show different states. */
const SCRIPT: { at: number; label?: string; keys?: [string, "down" | "up"][] }[] = [
  { at: 900, label: "title screen" },
  { at: 1000, keys: [["Space", "down"]] },
  { at: 1100, keys: [["Space", "up"]] },
  { at: 1600, keys: [["ArrowRight", "down"]] },
  { at: 2600, label: "playing" },
  { at: 2700, keys: [["Space", "down"]] },
  { at: 2820, keys: [["Space", "up"]] },
  { at: 3600, label: "mid-jump" },
  { at: 4200, keys: [["ArrowRight", "up"]] },
  { at: 5200, label: "later" },
];

export async function lookAtGame(url: string, timeoutMs = 40_000): Promise<LookResult> {
  const chrome = findChrome();
  if (!chrome) {
    return {
      shots: [],
      errors: [],
      note: "No Chrome or Chromium found on this machine, so the game could not be photographed. Set CHROME_PATH to enable it.",
    };
  }

  const profile = mkdtempSync(join(tmpdir(), "gs-shot-"));
  const port = 9600 + Math.floor(Math.random() * 300);
  let proc: ChildProcess | null = null;
  let ws: WebSocket | null = null;

  try {
    proc = spawn(
      chrome,
      [
        "--headless=new",
        "--disable-gpu",
        "--hide-scrollbars",
        "--mute-audio",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-extensions",
        `--remote-debugging-port=${port}`,
        `--user-data-dir=${profile}`,
        "--window-size=640,360",
        "about:blank",
      ],
      { stdio: "ignore" }
    );

    const target = await waitForTarget(port, 12_000);
    if (!target) return { shots: [], errors: [], note: "The browser did not start in time." };

    ws = new WebSocket(target);
    const rpc = makeRpc(ws);
    await rpc.open;

    const errors: string[] = [];
    rpc.on("Runtime.consoleAPICalled", (p) => {
      if (p.type === "error") errors.push(argsToText(p.args));
    });
    rpc.on("Runtime.exceptionThrown", (p) => {
      const d = p.exceptionDetails ?? {};
      errors.push(String(d.exception?.description ?? d.text ?? "Uncaught error").slice(0, 300));
    });

    await rpc.send("Page.enable");
    await rpc.send("Runtime.enable");
    await rpc.send("Page.navigate", { url });

    const shots: Shot[] = [];
    const deadline = Date.now() + timeoutMs;
    let elapsed = 0;

    // Click once so the canvas has focus and keyboard input reaches the game.
    await sleep(700);
    await rpc.send("Input.dispatchMouseEvent", { type: "mousePressed", x: 320, y: 180, button: "left", clickCount: 1 });
    await rpc.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: 320, y: 180, button: "left", clickCount: 1 });
    elapsed = 700;

    for (const beat of SCRIPT) {
      if (Date.now() > deadline) break;
      await sleep(Math.max(0, beat.at - elapsed));
      elapsed = beat.at;

      for (const [code, dir] of beat.keys ?? []) {
        await rpc.send("Input.dispatchKeyEvent", {
          type: dir === "down" ? "keyDown" : "keyUp",
          code,
          key: code === "Space" ? " " : code,
          windowsVirtualKeyCode: code === "Space" ? 32 : code === "ArrowRight" ? 39 : 37,
        });
      }

      if (beat.label) {
        const res = await rpc.send("Page.captureScreenshot", { format: "png" });
        if (res?.data) shots.push({ label: beat.label, dataUrl: `data:image/png;base64,${res.data}` });
      }
    }

    return { shots, errors: [...new Set(errors)].slice(0, 8) };
  } catch (err) {
    return { shots: [], errors: [], note: `Could not photograph the game: ${String(err).slice(0, 200)}` };
  } finally {
    try { ws?.close(); } catch { /* already gone */ }
    proc?.kill("SIGKILL");
    rmSync(profile, { recursive: true, force: true });
  }
}

/* ------------------------------------------------------------------ plumbing -- */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitForTarget(port: number, timeoutMs: number): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json`);
      const list = (await res.json()) as { type: string; webSocketDebuggerUrl?: string }[];
      const page = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {
      /* not listening yet */
    }
    await sleep(250);
  }
  return null;
}

type Handler = (params: Record<string, any>) => void;

function makeRpc(ws: WebSocket) {
  let id = 0;
  const pending = new Map<number, (v: any) => void>();
  const handlers = new Map<string, Handler[]>();

  ws.onmessage = (event) => {
    let msg: any;
    try {
      msg = JSON.parse(String(event.data));
    } catch {
      return;
    }
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)!(msg.result);
      pending.delete(msg.id);
    } else if (msg.method) {
      for (const fn of handlers.get(msg.method) ?? []) fn(msg.params ?? {});
    }
  };

  return {
    open: new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error("devtools socket failed"));
    }),
    on(method: string, fn: Handler) {
      handlers.set(method, [...(handlers.get(method) ?? []), fn]);
    },
    send(method: string, params: Record<string, unknown> = {}): Promise<any> {
      const n = ++id;
      return new Promise((resolve) => {
        pending.set(n, resolve);
        ws.send(JSON.stringify({ id: n, method, params }));
        setTimeout(() => {
          if (pending.delete(n)) resolve(null);
        }, 8000);
      });
    },
  };
}

function argsToText(args: { value?: unknown; description?: string }[] = []): string {
  return args
    .map((a) => (typeof a.value === "string" ? a.value : a.description ?? JSON.stringify(a.value ?? "")))
    .join(" ")
    .slice(0, 300);
}
