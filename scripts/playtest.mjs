/**
 * Headless playtest harness.
 *
 * Runs a game's real module graph against a stubbed DOM and canvas, plays it for
 * a simulated minute across several input strategies, and checks that its rules
 * actually fire — not merely that it survived a few frames.
 *
 * Games declare what they are doing through `window.__GS_STATE()`, which the
 * toolkit's main.js wires up. Without that hook this can only report crashes,
 * because nothing outside the game knows what its rules are.
 *
 *   node scripts/playtest.mjs <gameDir> [frames]
 *
 * Prints one JSON object on stdout. Runs in its own process so a hanging or
 * misbehaving game cannot take the server with it.
 */

import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { existsSync } from "node:fs";

const dir = process.argv[2];
const FRAMES = Number(process.argv[3] || 3200);

const errors = [];
const logs = [];
const ops = Object.create(null);
const fills = new Set();
const texts = [];

const note = (op) => (ops[op] = (ops[op] || 0) + 1);

/* ------------------------------------------------------------- canvas stub -- */

function makeContext(canvas) {
  const state = {
    canvas,
    fillStyle: "#000", strokeStyle: "#000", globalAlpha: 1,
    font: "10px sans-serif", textAlign: "start", textBaseline: "alphabetic",
    lineWidth: 1, lineCap: "butt", lineJoin: "miter",
    globalCompositeOperation: "source-over", imageSmoothingEnabled: true,
    shadowBlur: 0, shadowColor: "#000", filter: "none", letterSpacing: "0px",
  };
  const gradient = () => ({ addColorStop() {} });
  const special = {
    createLinearGradient: gradient,
    createRadialGradient: gradient,
    createConicGradient: gradient,
    createPattern: () => ({ setTransform() {} }),
    measureText: (t) => ({ width: String(t).length * 6, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 }),
    getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(Math.max(1, w * h * 4)), width: w, height: h }),
    createImageData: (w, h) => ({ data: new Uint8ClampedArray(Math.max(1, w * h * 4)), width: w, height: h }),
    isPointInPath: () => false,
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
    fillText: (t) => {
      note("fillText");
      if (typeof t === "string" && t.trim()) texts.push(t.trim().slice(0, 48));
    },
  };
  return new Proxy(state, {
    get(target, prop) {
      if (prop in special) return special[prop];
      if (prop in target) return target[prop];
      if (typeof prop === "symbol") return undefined;
      return (...args) => {
        note(String(prop));
        if (String(prop) === "drawImage" && !args[0]) {
          errors.push("drawImage was called with an undefined image — a sprite was never baked.");
        }
      };
    },
    set(target, prop, value) {
      target[prop] = value;
      if (prop === "fillStyle" && typeof value === "string") fills.add(value.toLowerCase());
      return true;
    },
  });
}

class StubCanvas {
  constructor(width = 300, height = 150) {
    this.width = width; this.height = height;
    this.style = {}; this.tabIndex = 0;
    this._listeners = Object.create(null);
    this._ctx = makeContext(this);
  }
  getContext() { return this._ctx; }
  addEventListener(type, fn) { (this._listeners[type] ||= []).push(fn); }
  removeEventListener() {}
  dispatch(type, event) { for (const fn of this._listeners[type] || []) fn(event); }
  getBoundingClientRect() {
    return { x: 0, y: 0, width: this.width, height: this.height, top: 0, left: 0, right: this.width, bottom: this.height };
  }
  focus() {}
  toDataURL() { return "data:image/webp;base64,AA=="; }
  get clientWidth() { return this.width; }
  get clientHeight() { return this.height; }
}

/* ---------------------------------------------------------------- DOM stub -- */

const mainCanvas = new StubCanvas(640, 360);
const windowListeners = Object.create(null);

function stubElement(tag) {
  if (tag === "canvas") return new StubCanvas();
  return {
    style: {}, dataset: {},
    classList: { add() {}, remove() {}, toggle() {} },
    appendChild() {}, setAttribute() {}, addEventListener() {}, removeEventListener() {},
    getBoundingClientRect: () => ({ width: 0, height: 0, top: 0, left: 0 }),
  };
}

const documentStub = {
  getElementById: () => mainCanvas,
  querySelector: (s) => (String(s).includes("canvas") ? mainCanvas : stubElement("div")),
  querySelectorAll: () => [mainCanvas],
  createElement: stubElement,
  addEventListener(type, fn) { (windowListeners[type] ||= []).push(fn); },
  removeEventListener() {},
  body: { appendChild() {}, style: {} },
  documentElement: { style: {} },
  fonts: { ready: Promise.resolve() },
  hidden: false,
};

let clock = 0;
const rafQueue = [];

const audioParam = () => ({
  value: 0,
  setValueAtTime() { return audioParam(); },
  linearRampToValueAtTime() { return audioParam(); },
  exponentialRampToValueAtTime(v) {
    if (v === 0) errors.push("exponentialRampToValueAtTime(0) throws in real browsers — ramp to 0.0001 instead.");
    return audioParam();
  },
  cancelScheduledValues() { return audioParam(); },
  setTargetAtTime() { return audioParam(); },
});

const audioNode = () => ({
  connect: (n) => n ?? audioNode(), disconnect() {}, start() {}, stop() {},
  gain: audioParam(), frequency: audioParam(), detune: audioParam(), Q: audioParam(),
  threshold: audioParam(), ratio: audioParam(), knee: audioParam(),
  attack: audioParam(), release: audioParam(),
  type: "sine", buffer: null, loop: false,
});

class StubAudioContext {
  constructor() {
    this.state = "running"; this.currentTime = 0; this.sampleRate = 44100;
    this.destination = audioNode();
  }
  resume() { return Promise.resolve(); }
  createOscillator() { return audioNode(); }
  createGain() { return audioNode(); }
  createBiquadFilter() { return audioNode(); }
  createDynamicsCompressor() { return audioNode(); }
  createBufferSource() { return audioNode(); }
  createStereoPanner() { return audioNode(); }
  createBuffer(ch, len) { return { getChannelData: () => new Float32Array(len), length: len, duration: 1 }; }
}

const saveStore = Object.create(null);

function defineGlobals(props) {
  for (const [key, value] of Object.entries(props)) {
    try {
      Object.defineProperty(globalThis, key, { value, writable: true, configurable: true });
    } catch {
      /* a global we cannot shadow — the stub simply is not available */
    }
  }
}

defineGlobals({
  window: globalThis,
  document: documentStub,
  navigator: { userAgent: "playtest", maxTouchPoints: 0, language: "en" },
  location: { href: "http://playtest.local/", search: "" },
  devicePixelRatio: 1,
  innerWidth: 960,
  innerHeight: 540,
  AudioContext: StubAudioContext,
  webkitAudioContext: StubAudioContext,
  OffscreenCanvas: StubCanvas,
  Image: StubCanvas,
  Path2D: class { constructor() {} addPath() {} },
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }),
  requestAnimationFrame: (fn) => { rafQueue.push(fn); return rafQueue.length; },
  cancelAnimationFrame: () => {},
  performance: { now: () => clock },
  GameSave: {
    ready: Promise.resolve(null),
    player: { name: "Playtester", signedIn: true },
    get: (k, d) => (k in saveStore ? saveStore[k] : d),
    set: (k, v) => (saveStore[k] = v),
    all: () => ({ ...saveStore }),
    clear: () => { for (const k of Object.keys(saveStore)) delete saveStore[k]; },
    submitScore: () => Promise.resolve([]),
  },
});

globalThis.addEventListener = (type, fn) => { (windowListeners[type] ||= []).push(fn); };
globalThis.removeEventListener = () => {};
globalThis.getComputedStyle = () => ({ getPropertyValue: () => "" });

for (const level of ["log", "info", "warn", "error"]) {
  const original = console[level];
  console[level] = (...args) => {
    const text = args
      .map((a) => (a instanceof Error ? a.stack || a.message : typeof a === "string" ? a : safeJson(a)))
      .join(" ");
    if (level === "error" || level === "warn") logs.push(`${level}: ${text.slice(0, 300)}`);
    if (process.env.PLAYTEST_VERBOSE) original(...args);
  };
}

const safeJson = (v) => { try { return JSON.stringify(v); } catch { return String(v); } };

process.on("unhandledRejection", (r) => {
  errors.push("Unhandled rejection: " + (r?.stack ? String(r.stack).split("\n").slice(0, 3).join(" | ") : String(r)));
});

/* -------------------------------------------------------------- key events -- */

const held = new Set();

function key(type, code) {
  if (type === "keydown") {
    if (held.has(code)) return;
    held.add(code);
  } else held.delete(code);

  const event = {
    type, code, key: code === "Space" ? " " : code,
    keyCode: 0, preventDefault() {}, stopPropagation() {}, repeat: false,
  };
  for (const fn of windowListeners[type] || []) fn(event);
  mainCanvas.dispatch(type, event);
}

const releaseAll = () => [...held].forEach((c) => key("keyup", c));

/* ------------------------------------------------------- physics unit test -- */

/**
 * Exercises the toolkit's collision directly. These are the failures players
 * describe as "I fell through the floor" and "I got stuck in the wall".
 */
async function testPhysics() {
  const file = join(dir, "physics.js");
  if (!existsSync(file)) return { available: false, failures: [] };

  let mod;
  try {
    mod = await import(pathToFileURL(file).href);
  } catch (err) {
    return { available: false, failures: [`physics.js failed to load: ${String(err).slice(0, 160)}`] };
  }
  if (typeof mod.moveAndCollide !== "function") return { available: false, failures: [] };

  let TILE = 16;
  try {
    const cfg = await import(pathToFileURL(join(dir, "config.js")).href);
    if (cfg.TILE) TILE = cfg.TILE;
  } catch { /* default */ }

  const failures = [];
  // A floor from row 10 down, and a wall column at tile x = 20.
  const FLOOR_TOP = 10 * TILE;
  // Two tiles thick on purpose: with a single-tile wall, scanning the tiles in
  // the wrong order still happens to give the right answer, so the bug hides.
  const WALL_X = 20;
  const WALL_X2 = 21;
  const solidAt = (tx, ty) => ty >= 10 || tx === WALL_X || tx === WALL_X2;

  const H = 24, W = 12;
  const REST_Y = FLOOR_TOP - H;   // where an entity standing on the floor sits

  const inSolid = (e) => {
    for (let ty = Math.floor(e.y / TILE); ty <= Math.floor((e.y + e.h - 1) / TILE); ty++)
      for (let tx = Math.floor(e.x / TILE); tx <= Math.floor((e.x + e.w - 1) / TILE); tx++)
        if (solidAt(tx, ty)) return true;
    return false;
  };
  const make = (over) => ({ x: 5 * TILE, y: REST_Y, w: W, h: H, vx: 0, vy: 0, ...over });

  // 1. Falls onto the floor, lands on top of it, and reports ground contact.
  {
    const e = make({ y: 4 * TILE, vy: 0 });
    let sawGround = false;
    for (let i = 0; i < 180; i++) {
      e.vy = Math.min(e.vy + 1200 / 60, 600);
      mod.moveAndCollide(e, 1 / 60, solidAt);
      if (e.onGround) sawGround = true;
    }
    if (!sawGround) failures.push("An entity falling onto a floor never reported onGround.");
    if (Math.abs(e.y - REST_Y) > 1.5) {
      failures.push(`An entity falling onto a floor came to rest at y=${e.y.toFixed(1)} instead of ${REST_Y} — it sank into the floor or stopped above it.`);
    }
  }
  // 2. Walking right into a wall stops beside it, not inside it.
  {
    const e = make({ vx: 220 });
    for (let i = 0; i < 300; i++) { e.vx = 220; e.vy = 60; mod.moveAndCollide(e, 1 / 60, solidAt); }
    if (e.x + e.w > WALL_X * TILE + 0.5) failures.push("An entity walked straight through a wall going right.");
    else if (inSolid(e)) failures.push("An entity walking right into a wall ended up inside it.");
  }
  // 3. Walking left into a wall — the scan-order bug lives here.
  {
    const e = make({ x: 25 * TILE, vx: -220 });
    for (let i = 0; i < 300; i++) { e.vx = -220; e.vy = 60; mod.moveAndCollide(e, 1 / 60, solidAt); }
    if (e.x < (WALL_X2 + 1) * TILE - 0.5) failures.push("An entity walked straight through a wall going left.");
    else if (inSolid(e)) failures.push("An entity walking left into a wall ended up inside it.");
  }
  // 4. An entity already overlapping a thick wall must be pushed clear of it.
  //    This is what happens when a moving platform shoves the player into geometry,
  //    and it is where resolving against the wrong tile leaves them stuck inside.
  {
    const e = make({ x: WALL_X * TILE + 10, vx: -220 });
    for (let i = 0; i < 60; i++) { e.vx = -220; e.vy = 0; mod.moveAndCollide(e, 1 / 60, solidAt); }
    if (inSolid(e)) {
      failures.push("An entity overlapping a thick wall was never pushed out of it — it resolved against the wrong tile and stayed inside.");
    }
  }
  // 5. Very fast movement must not tunnel through a wall.
  {
    const e = make({ x: 10 * TILE, vx: 4000 });
    for (let i = 0; i < 40; i++) { e.vx = 4000; e.vy = 0; mod.moveAndCollide(e, 1 / 60, solidAt); }
    if (e.x > WALL_X * TILE) failures.push("A fast entity tunnelled straight through a wall — substepping is not working.");
  }
  return { available: true, failures };
}

/* -------------------------------------------------------------------- run -- */

const report = {
  ok: false, frames: 0, errors, logs, draws: ops, colours: 0, texts: [],
  boot: "not reached",
  state: { available: false },
  physics: { available: false, failures: [] },
};

function finish(code) {
  report.colours = fills.size;
  report.texts = [...new Set(texts)].slice(0, 16);
  report.errors = [...new Set(errors)].slice(0, 10);
  report.logs = [...new Set(logs)].slice(0, 10);
  report.ok = report.errors.length === 0 && report.frames > 60 && !report.physics.failures.length;
  process.stdout.write(JSON.stringify(report));
  process.exit(code);
}

try {
  await import(pathToFileURL(join(dir, "main.js")).href);
  report.boot = "imported main.js";
} catch (err) {
  errors.push("Failed to load: " + (err?.stack ? String(err.stack).split("\n").slice(0, 4).join(" | ") : String(err)));
  finish(0);
}

await new Promise((r) => setImmediate(r));

if (rafQueue.length === 0) {
  errors.push("Nothing scheduled a frame — the game never started its loop. Did main.js call run()?");
  finish(0);
}

/**
 * Input strategies, in order. Each gets a slice of the run so the game is played
 * several different ways rather than the one path a fixed script would take.
 */
const STRATEGIES = [
  { name: "start", drive: (f) => (f < 6 ? [["Space", "down"]] : f === 6 ? [["Space", "up"]] : []) },
  { name: "run right", drive: (f) => {
      const out = [];
      if (f === 0) out.push(["ArrowRight", "down"]);
      if (f % 45 === 20) out.push(["Space", "down"]);
      if (f % 45 === 28) out.push(["Space", "up"]);
      return out;
    } },
  { name: "run left", drive: (f) => {
      const out = [];
      if (f === 0) { out.push(["ArrowRight", "up"], ["ArrowLeft", "down"]); }
      if (f % 50 === 25) out.push(["Space", "down"]);
      if (f % 50 === 33) out.push(["Space", "up"]);
      return out;
    } },
  { name: "explore", drive: (f, rnd) => {
      const out = [];
      if (f % 24 === 0) {
        out.push(["ArrowLeft", "up"], ["ArrowRight", "up"]);
        out.push([rnd() < 0.6 ? "ArrowRight" : "ArrowLeft", "down"]);
      }
      if (f % 17 === 0) out.push(["Space", "down"]);
      if (f % 17 === 8) out.push(["Space", "up"]);
      if (f % 90 === 0) out.push(["Enter", "down"], ["Enter", "up"]);
      return out;
    } },
];

// Deterministic pseudo-randomness so two runs of the same game agree.
let seed = 12345;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

const samples = [];
const readState = () => {
  try {
    const s = globalThis.__GS_STATE?.();
    return s && typeof s === "object" ? s : null;
  } catch (err) {
    errors.push("__GS_STATE() threw: " + String(err).slice(0, 160));
    return null;
  }
};

const perStrategy = Math.max(120, Math.floor(FRAMES / STRATEGIES.length));
let frame = 0;

outer: for (const strategy of STRATEGIES) {
  releaseAll();
  for (let f = 0; f < perStrategy; f++, frame++) {
    for (const [code, dir] of strategy.drive(f, rnd)) key(dir === "down" ? "keydown" : "keyup", code);

    const pending = rafQueue.splice(0, rafQueue.length);
    if (!pending.length) {
      errors.push(`The frame loop stopped after ${frame} frames — requestAnimationFrame was not scheduled again.`);
      break outer;
    }
    clock += 1000 / 60;
    for (const fn of pending) {
      try {
        fn(clock);
      } catch (err) {
        errors.push(
          `Frame ${frame} (${strategy.name}): ` +
            (err?.stack ? String(err.stack).split("\n").slice(0, 3).join(" | ") : String(err))
        );
        report.frames = frame;
        report.physics = await testPhysics();
        finish(0);
      }
    }
    report.frames = frame + 1;

    if (frame % 6 === 0) {
      const s = readState();
      if (s) samples.push({ frame, phase: strategy.name, ...s });
    }
  }
}

report.physics = await testPhysics();

/* ------------------------------------------------------------ rule summary -- */

if (!samples.length) {
  report.state = { available: false };
} else {
  const num = (k) => samples.map((s) => s[k]).filter((v) => typeof v === "number" && Number.isFinite(v));
  const changed = (k) => { const v = num(k); return v.length > 1 && new Set(v).size > 1; };
  const scenes = [...new Set(samples.map((s) => String(s.scene ?? "")).filter(Boolean))];

  const px = samples.map((s) => s.player?.x).filter((v) => typeof v === "number" && Number.isFinite(v));
  const nanPlayer = samples.some(
    (s) => s.player && (!Number.isFinite(s.player.x) || !Number.isFinite(s.player.y))
  );

  report.state = {
    available: true,
    samples: samples.length,
    scenes,
    scoreChanged: changed("score"),
    levelChanged: changed("level"),
    livesChanged: changed("lives"),
    everWon: samples.some((s) => s.won === true || String(s.scene) === "won"),
    everDied: samples.some((s) => s.dead === true || String(s.scene) === "dead"),
    playerTracked: px.length > 0,
    playerRange: px.length ? Math.round(Math.max(...px) - Math.min(...px)) : 0,
    playerNaN: nanPlayer,
    finalScore: num("score").at(-1) ?? null,
    levelsSeen: [...new Set(num("level"))].sort((a, b) => a - b).slice(0, 12),
    declaredLevels: num("levels").at(-1) ?? null,
  };
}

finish(0);
