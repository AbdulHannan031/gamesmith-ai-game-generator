import type { FileMap } from "./types";

export const MIME: Record<string, string> = {
  html: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  json: "application/json; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  svg: "image/svg+xml",
};

export function mimeFor(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return MIME[ext] ?? "text/plain; charset=utf-8";
}

/**
 * Runs inside the sandboxed frame. Forwards diagnostics to the editor so the
 * assistant can read real runtime errors instead of guessing at them, and
 * exposes screenshot/pause hooks the parent drives over postMessage.
 */
const HARNESS = `
<script>
(function () {
  var MAX = 60;
  var seen = 0;
  function send(msg) { try { parent.postMessage(Object.assign({ __gs: true }, msg), "*"); } catch (e) {} }
  function fmt(args) {
    return Array.prototype.map.call(args, function (a) {
      if (a instanceof Error) return a.stack || (a.name + ": " + a.message);
      if (typeof a === "string") return a;
      try { return JSON.stringify(a); } catch (e) { return String(a); }
    }).join(" ");
  }
  ["log", "info", "warn", "error"].forEach(function (level) {
    var original = console[level].bind(console);
    console[level] = function () {
      if (seen++ < MAX) send({ type: "console", level: level, text: fmt(arguments).slice(0, 2000) });
      original.apply(null, arguments);
    };
  });
  window.addEventListener("error", function (e) {
    send({
      type: "error",
      text: (e.message || "Script error") +
        (e.filename ? "  (" + String(e.filename).split("/").pop() + ":" + e.lineno + ":" + e.colno + ")" : ""),
      stack: e.error && e.error.stack ? String(e.error.stack).slice(0, 2000) : null
    });
  });
  window.addEventListener("unhandledrejection", function (e) {
    var r = e.reason;
    send({ type: "error", text: "Unhandled promise rejection: " + (r && r.message ? r.message : String(r)),
           stack: r && r.stack ? String(r.stack).slice(0, 2000) : null });
  });

  function findCanvas() {
    var list = document.querySelectorAll("canvas");
    var best = null, area = 0;
    for (var i = 0; i < list.length; i++) {
      var a = list[i].width * list[i].height;
      if (a > area) { area = a; best = list[i]; }
    }
    return best;
  }

  // --- GameSave -----------------------------------------------------------
  // localStorage throws on this opaque origin, so persistence is bridged to the
  // host page: server-backed for signed-in players, local for everyone else.
  // Reads are synchronous against a cache the host preloads before boot.
  var cache = {};
  var player = { name: "Player", signedIn: false };
  var resolveReady;
  var readyPromise = new Promise(function (r) { resolveReady = r; });
  var flushTimer = null;
  var scoreSeq = 0;
  var scoreWaiters = {};

  function flush() {
    flushTimer = null;
    send({ type: "save", data: cache });
  }

  window.GameSave = {
    ready: readyPromise,
    get player() { return player; },
    get: function (key, fallback) {
      return Object.prototype.hasOwnProperty.call(cache, key) ? cache[key] : fallback;
    },
    set: function (key, value) {
      cache[key] = value;
      if (flushTimer === null) flushTimer = setTimeout(flush, 400);
      return value;
    },
    all: function () { return JSON.parse(JSON.stringify(cache)); },
    clear: function () { cache = {}; flush(); },
    submitScore: function (score) {
      var id = ++scoreSeq;
      send({ type: "score", score: Math.round(Number(score) || 0), reqId: id });
      return new Promise(function (res) { scoreWaiters[id] = res; });
    },
  };

  // Last-chance flush so a score set during the death frame is not lost.
  window.addEventListener("pagehide", function () { if (flushTimer !== null) { clearTimeout(flushTimer); flush(); } });

  window.addEventListener("message", function (e) {
    var d = e.data;
    if (!d || d.__gsCmd !== true) return;
    if (d.cmd === "shot") {
      var c = findCanvas();
      var url = null;
      try { url = c ? c.toDataURL("image/webp", 0.7) : null; } catch (err) { url = null; }
      send({ type: "shot", dataUrl: url });
    }
    if (d.cmd === "focus") { window.focus(); var c2 = findCanvas(); if (c2 && c2.focus) c2.focus(); }
    if (d.cmd === "save:init") {
      cache = d.data || {};
      player = d.player || player;
      resolveReady(window.GameSave);
    }
    if (d.cmd === "score:ok" && scoreWaiters[d.reqId]) {
      scoreWaiters[d.reqId](d.board || []);
      delete scoreWaiters[d.reqId];
    }
  });

  // Games listen for arrow keys; stop them scrolling the frame instead.
  window.addEventListener("keydown", function (e) {
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "].indexOf(e.key) !== -1) e.preventDefault();
  }, { passive: false });

  window.addEventListener("load", function () { send({ type: "ready" }); });
  send({ type: "boot" });
})();
</script>
`.trim();

/** Injects the harness as early as possible so it catches boot-time errors too. */
export function injectHarness(html: string): string {
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head([^>]*)>/i, `<head$1>\n${HARNESS}`);
  if (/<html[^>]*>/i.test(html)) return html.replace(/<html([^>]*)>/i, `<html$1>\n${HARNESS}`);
  return HARNESS + "\n" + html;
}

export const MISSING_ENTRY_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>No entry file</title>
<style>
  html,body{height:100%;margin:0;display:grid;place-items:center;background:#121011;color:#f2ede9;
    font:400 15px/1.6 ui-sans-serif,system-ui,sans-serif}
  div{max-width:34ch;text-align:center;padding:24px}
  code{background:#242021;padding:2px 6px;border-radius:4px;font-size:13px}
</style></head>
<body><div><p>This game has no <code>index.html</code> yet.</p>
<p style="color:#a19a96">Ask the assistant to create one and the preview will appear here.</p></div></body></html>`;

export function entryHtml(files: FileMap): string {
  const raw = files["index.html"];
  return injectHarness(raw ?? MISSING_ENTRY_HTML);
}

/** Frame-side response contract for postMessage traffic. */
export type FrameMessage =
  | { __gs: true; type: "boot" }
  | { __gs: true; type: "ready" }
  | { __gs: true; type: "console"; level: "log" | "info" | "warn" | "error"; text: string }
  | { __gs: true; type: "error"; text: string; stack: string | null }
  | { __gs: true; type: "shot"; dataUrl: string | null }
  | { __gs: true; type: "save"; data: Record<string, unknown> }
  | { __gs: true; type: "score"; score: number; reqId: number };

export interface ScoreRow {
  name: string;
  score: number;
  created_at: number;
}
