import type { FileMap } from "./types";

/**
 * Every new project starts from this toolkit.
 *
 * Deliberately NOT a finished game. Shipping a complete game as the starter made
 * every project converge on it — the assistant would reskin the same levels and
 * rules forever. So this ships the reusable machinery instead (loop, input,
 * collision, audio synthesis, sprite baking, scene layering) and no content: no
 * character, no levels, no rules. The assistant authors the game itself, on top
 * of plumbing that is already correct.
 */
export const STARTER_FILES: FileMap = {
  "index.html": `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>New game</title>
  <link rel="stylesheet" href="style.css" />
</head>
<body>
  <canvas id="stage" width="640" height="360"></canvas>
  <script type="module" src="main.js"></script>
</body>
</html>
`,

  "style.css": `* { box-sizing: border-box; }

html, body {
  margin: 0;
  height: 100%;
  background: #0b0a12;
  overflow: hidden;
}

body { display: grid; place-items: center; }

#stage {
  /* object-fit letterboxes the canvas into any window shape without cropping. */
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
  image-rendering: pixelated;
  touch-action: none;
  outline: none;
}
`,

  "config.js": `// Every tuning value and colour lives here — nowhere else.
// Replace this palette with one built for the game you are making.

export const W = 640;
export const H = 360;
export const TILE = 16;

export const PAL = {
  sky0: "#332a5c",
  sky1: "#8a5f77",
  far: "#5b4573",
  mid: "#43305a",
  near: "#2e2040",
  ink: "#120d1c",
  text: "#f6efe6",
  dim: "#b3a6bd",
  accent: "#ffb43f",
  danger: "#ff4f6b",
};
`,

  "engine.js": `// Loop, input and maths. Game-agnostic — game rules belong in game.js.

import { W, H } from "./config.js";

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const rand = (lo, hi) => lo + Math.random() * (hi - lo);
export const randInt = (lo, hi) => Math.floor(rand(lo, hi + 1));
export const approach = (v, target, step) =>
  v < target ? Math.min(v + step, target) : Math.max(v - step, target);

/** Frame-rate independent smoothing. Plain lerp(a, b, 0.1) is not. */
export const damp = (a, b, rate, dt) => lerp(a, b, 1 - Math.pow(rate, dt));

export function circlesHit(a, b) {
  const dx = a.x - b.x, dy = a.y - b.y, r = a.r + b.r;
  return dx * dx + dy * dy <= r * r;   // squared: never call Math.sqrt to test
}

/** Deterministic noise, so generated scenery is stable across frames and reloads. */
export function seeded(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Input {
  constructor(target) {
    this.down = new Set();
    this.pressed = new Set();
    this.pointer = { x: 0, y: 0, down: false };

    target.addEventListener("keydown", (e) => {
      if (!this.down.has(e.code)) this.pressed.add(e.code);
      this.down.add(e.code);
    });
    target.addEventListener("keyup", (e) => this.down.delete(e.code));
    target.addEventListener("blur", () => this.down.clear());
    target.addEventListener("pointerdown", (e) => { this.pointer.down = true; this.track(target, e); });
    target.addEventListener("pointerup", () => { this.pointer.down = false; });
    target.addEventListener("pointermove", (e) => this.track(target, e));
  }

  track(target, e) {
    const r = target.getBoundingClientRect();
    this.pointer.x = ((e.clientX - r.left) / r.width) * W;
    this.pointer.y = ((e.clientY - r.top) / r.height) * H;
  }

  isDown(...c) { return c.some((k) => this.down.has(k)); }
  justPressed(...c) { return c.some((k) => this.pressed.has(k)); }

  /** Horizontal input as -1 / 0 / 1. */
  get moveX() {
    return (this.isDown("ArrowRight", "KeyD") ? 1 : 0) - (this.isDown("ArrowLeft", "KeyA") ? 1 : 0);
  }
  get moveY() {
    return (this.isDown("ArrowDown", "KeyS") ? 1 : 0) - (this.isDown("ArrowUp", "KeyW") ? 1 : 0);
  }
  /** Normalised 8-way direction, for top-down games. */
  axis() {
    const x = this.moveX, y = this.moveY;
    const len = Math.hypot(x, y) || 1;
    return { x: x / len, y: y / len };
  }

  endFrame() { this.pressed.clear(); }
}

/**
 * Fixed 60Hz update with free-running render, on a HiDPI-aware backing store.
 * dt is clamped so returning to a background tab never fast-forwards the game.
 */
export function run({ canvas, update, render }) {
  const ctx = canvas.getContext("2d", { alpha: false });
  const STEP = 1 / 60;
  let last = performance.now();
  let acc = 0;

  canvas.tabIndex = 0;
  canvas.focus();
  canvas.addEventListener("pointerdown", () => canvas.focus());

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
  }
  resize();
  window.addEventListener("resize", resize);

  function frame(now) {
    acc += Math.min((now - last) / 1000, 0.25);
    last = now;
    let steps = 0;
    while (acc >= STEP && steps++ < 5) { update(STEP); acc -= STEP; }
    ctx.save();
    render(ctx);
    ctx.restore();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
`,

  "physics.js": `// AABB-versus-tilemap collision. Use this rather than writing your own — the
// two bugs it exists to prevent are subtle and both let the player through walls.

import { TILE } from "./config.js";

/**
 * Moves one axis and resolves against solid tiles.
 *
 * Scanning runs in the direction of travel. Scanning the other way resolves
 * against the far side of the first solid tile it happens to find, which can
 * place the entity inside the next wall along — that is the classic
 * "walked through the wall going left" bug.
 */
function moveAxis(e, ax, dt, solidAt) {
  const v = ax === "x" ? e.vx : e.vy;
  if (!v) return;
  e[ax] += v * dt;

  const x0 = Math.floor(e.x / TILE);
  const x1 = Math.floor((e.x + e.w - 1) / TILE);
  const y0 = Math.floor(e.y / TILE);
  const y1 = Math.floor((e.y + e.h - 1) / TILE);

  if (ax === "x") {
    const step = v > 0 ? 1 : -1;
    const from = v > 0 ? x0 : x1;
    const to = v > 0 ? x1 : x0;
    for (let tx = from; step > 0 ? tx <= to : tx >= to; tx += step) {
      for (let ty = y0; ty <= y1; ty++) {
        if (!solidAt(tx, ty)) continue;
        e.x = v > 0 ? tx * TILE - e.w : (tx + 1) * TILE;
        e.vx = 0;
        return;
      }
    }
  } else {
    const step = v > 0 ? 1 : -1;
    const from = v > 0 ? y0 : y1;
    const to = v > 0 ? y1 : y0;
    for (let ty = from; step > 0 ? ty <= to : ty >= to; ty += step) {
      for (let tx = x0; tx <= x1; tx++) {
        if (!solidAt(tx, ty)) continue;
        if (v > 0) { e.y = ty * TILE - e.h; e.onGround = true; e.landed = true; }
        else { e.y = (ty + 1) * TILE; }
        e.vy = 0;
        return;
      }
    }
  }
}

/**
 * Moves an entity and resolves collisions, substepping so nothing can cross a
 * whole tile in one frame and tunnel straight through a thin wall.
 *
 * The entity needs { x, y, w, h, vx, vy } and gets { onGround, landed } set.
 * Keep w and h smaller than the drawn sprite — a hitbox as wide as the artwork
 * snags on corners and cannot fit through gaps that look passable.
 */
export function moveAndCollide(e, dt, solidAt) {
  e.onGround = false;
  e.landed = false;

  const distance = Math.max(Math.abs(e.vx), Math.abs(e.vy)) * dt;
  const steps = Math.max(1, Math.ceil(distance / (TILE * 0.4)));

  for (let i = 0; i < steps; i++) {
    moveAxis(e, "x", dt / steps, solidAt);
    moveAxis(e, "y", dt / steps, solidAt);
  }
}

/** True if any tile the entity overlaps satisfies the test. */
export function overlapsTile(e, test) {
  const x0 = Math.floor(e.x / TILE);
  const x1 = Math.floor((e.x + e.w - 1) / TILE);
  const y0 = Math.floor(e.y / TILE);
  const y1 = Math.floor((e.y + e.h - 1) / TILE);
  for (let ty = y0; ty <= y1; ty++)
    for (let tx = x0; tx <= x1; tx++)
      if (test(tx, ty)) return true;
  return false;
}

export const rectsHit = (a, b) =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/** Derive jump constants from what you actually want, instead of guessing. */
export function jumpFor(heightPx, timeToApexSec) {
  const gravity = (2 * heightPx) / (timeToApexSec * timeToApexSec);
  return { gravity, jumpSpeed: gravity * timeToApexSec };
}
`,

  "audio.js": `// Synthesised sound. There are no audio files in this runtime.

let actx = null;
let master = null;
export let muted = false;

function ctx() {
  if (!actx) {
    actx = new (window.AudioContext || window.webkitAudioContext)();
    master = actx.createGain();
    master.gain.value = 0.32;
    const limiter = actx.createDynamicsCompressor();
    limiter.threshold.value = -8;
    limiter.ratio.value = 12;
    master.connect(limiter).connect(actx.destination);
  }
  if (actx.state === "suspended") actx.resume();
  return actx;
}

export function setMuted(v) {
  muted = v;
  if (master) master.gain.value = v ? 0 : 0.32;
}

export function tone({ freq = 440, to = null, dur = 0.12, type = "square", gain = 0.22 } = {}) {
  if (muted) return;
  try {
    const a = ctx(), t = a.currentTime;
    const osc = a.createOscillator();
    const amp = a.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
    // Never ramp gain to exactly 0 — exponentialRampToValueAtTime throws on it.
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.exponentialRampToValueAtTime(gain, t + 0.005);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(amp).connect(master);
    osc.start(t); osc.stop(t + dur + 0.02);
  } catch (e) { /* audio is optional */ }
}

let noiseBuf = null;
export function noise({ dur = 0.18, gain = 0.2, filter = 1400, sweep = 200 } = {}) {
  if (muted) return;
  try {
    const a = ctx(), t = a.currentTime;
    if (!noiseBuf) {
      noiseBuf = a.createBuffer(1, a.sampleRate, a.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const src = a.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
    const bq = a.createBiquadFilter(); bq.type = "lowpass";
    bq.frequency.setValueAtTime(filter, t);
    bq.frequency.exponentialRampToValueAtTime(Math.max(60, sweep), t + dur);
    const amp = a.createGain();
    amp.gain.setValueAtTime(gain, t);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bq).connect(amp).connect(master);
    src.start(t); src.stop(t + dur + 0.02);
  } catch (e) { /* audio is optional */ }
}

/** ±5% pitch on repeated sounds, or the ear locks onto the loop. */
export const vary = (f) => f * (0.95 + Math.random() * 0.1);

// Starting points. Retune these for the game you are making.
export const SFX = {
  jump:   () => tone({ freq: vary(300), to: 600, dur: 0.10, type: "square", gain: 0.16 }),
  land:   () => noise({ dur: 0.07, filter: 800, sweep: 180, gain: 0.13 }),
  pickup: (combo = 0) => tone({ freq: vary(760) * Math.pow(1.06, combo), to: 1180, dur: 0.09, type: "triangle", gain: 0.2 }),
  shoot:  () => tone({ freq: vary(900), to: 260, dur: 0.07, type: "sawtooth", gain: 0.14 }),
  hit:    () => tone({ freq: 220, to: 120, dur: 0.07, type: "square", gain: 0.2 }),
  hurt:   () => tone({ freq: 220, to: 70, dur: 0.3, type: "sawtooth", gain: 0.24 }),
  explode:() => noise({ dur: 0.45, filter: 2400, sweep: 80, gain: 0.34 }),
  select: () => tone({ freq: 520, dur: 0.05, type: "square", gain: 0.12 }),
  win:    () => [0, 0.09, 0.18, 0.3].forEach((d, i) =>
            setTimeout(() => tone({ freq: [523, 659, 784, 1046][i], dur: 0.22, type: "triangle", gain: 0.18 }), d * 1000)),
};
`,

  "sprites.js": `// Sprite baking. Author characters as pixel grids here, then bake once at boot.
// Read the character-art skill before designing one — a 6x6 two-colour blob
// reads as a blob no matter what it is supposed to be.
//
// A worked example of the format, which you should replace:
//
//   const PAL = { ".": null, o: "#2a1526", b: "#e8763a", B: "#b04f26", w: "#ffd9b8" };
//   const IDLE = [
//     "..oooo..",
//     ".obbbbo.",
//     ".obwwbo.",
//     ".obbbbo.",
//     "..o..o..",
//   ];
//   export const SPRITES = {};
//   export function bakeAll(scale = 2) { SPRITES.idle = [bake(IDLE, PAL, scale)]; }
//
// Rules that matter: at least 12x14 for a main character; outline, base, shadow
// and a highlight at minimum; one light direction for the whole cast; and at
// least a two-frame idle plus a three or four frame walk cycle.

/** Turns a grid of row strings into a canvas. Call once, never per frame. */
export function bake(rows, palette, scale = 1) {
  const w = rows[0].length, h = rows.length;
  const cvs = document.createElement("canvas");
  cvs.width = w * scale;
  cvs.height = h * scale;
  const c = cvs.getContext("2d");
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < rows[y].length; x++) {
      const col = palette[rows[y][x]];
      if (!col) continue;
      c.fillStyle = col;
      c.fillRect(x * scale, y * scale, scale, scale);
    }
  }
  return cvs;
}

/** Mirrors the left half so noise reads as a creature. Useful for enemy variety. */
export function mirror(rows) {
  return rows.map((r) => r + [...r].reverse().join(""));
}

/**
 * Plays named animations from { name: { frames: [...], fps, loop } }.
 * Keep the animation metadata and the baked frames in one structure so a change
 * to one cannot desynchronise the other.
 */
export function makeAnimator(anims, initial) {
  let state = initial || Object.keys(anims)[0];
  let t = 0, i = 0;
  return {
    get state() { return state; },
    set(next) {
      if (next === state || !anims[next]) return;
      state = next; t = 0; i = 0;
    },
    update(dt) {
      const a = anims[state];
      if (!a || !a.frames.length) return;
      t += dt;
      const step = 1 / (a.fps || 8);
      while (t >= step) {
        t -= step;
        i = a.loop === false ? Math.min(i + 1, a.frames.length - 1) : (i + 1) % a.frames.length;
      }
    },
    get frame() {
      const a = anims[state];
      return a && a.frames.length ? a.frames[i % a.frames.length] : null;
    },
  };
}

/** Draw a baked frame centred horizontally and standing on (x, y). */
export function drawSprite(ctx, frame, x, y, facing = 1, squash = 0) {
  if (!frame) return;
  ctx.save();
  ctx.translate(Math.round(x), Math.round(y));
  ctx.scale(facing * (1 - squash * 0.5), 1 + squash * 0.5);
  ctx.drawImage(frame, -frame.width / 2, -frame.height);
  ctx.restore();
}
`,

  "scene.js": `// Background construction. Depth comes from layering, and from saturation and
// contrast dropping with distance. Read the scene-composition skill first.

import { W, H } from "./config.js";
import { seeded } from "./engine.js";

/** Build once and cache — creating a gradient every frame is a real cost. */
export function skyGradient(ctx, top, bottom) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, top);
  g.addColorStop(1, bottom);
  return g;
}

/**
 * A silhouette layer, drawn once to an offscreen canvas and scrolled.
 * Use several: far layers lighter, flatter and slower than near ones.
 */
export function ridgeLayer({ color, height, roughness = 28, seed = 1, step = 24 }) {
  const cvs = document.createElement("canvas");
  cvs.width = W * 2;
  cvs.height = H;
  const c = cvs.getContext("2d");
  const rnd = seeded(seed);
  c.fillStyle = color;
  c.beginPath();
  c.moveTo(0, H);
  let y = H - height;
  for (let x = 0; x <= W * 2; x += step) {
    y += (rnd() - 0.5) * roughness;
    y = Math.max(H - height - 34, Math.min(H - height + 34, y));
    c.lineTo(x, y);
  }
  c.lineTo(W * 2, H);
  c.closePath();
  c.fill();
  return cvs;
}

/** Seamless horizontal scroll of a 2W-wide layer. */
export function drawParallax(ctx, layer, camX, speed) {
  const off = -((camX * speed) % W);
  ctx.drawImage(layer, off, 0);
  if (off > -W) ctx.drawImage(layer, off - W, 0);
}

export function makeStars(count = 60, seed = 9137, bandHeight = 0.55) {
  const rnd = seeded(seed);
  return Array.from({ length: count }, () => ({
    x: rnd() * W, y: rnd() * H * bandHeight, r: rnd() < 0.8 ? 1 : 2, tw: rnd() * Math.PI * 2,
  }));
}

export function drawStars(ctx, stars, camX, t, color = "#fff6e2") {
  ctx.fillStyle = color;
  for (const s of stars) {
    ctx.globalAlpha = 0.35 + Math.sin(t * 1.5 + s.tw) * 0.25;
    let x = s.x - camX * 0.04;
    x -= Math.floor(x / W) * W;
    ctx.fillRect(x, s.y, s.r, s.r);
  }
  ctx.globalAlpha = 1;
}

/**
 * Vignette plus a single translucent colour wash. Two lines, and the cheapest
 * way to make disparate layers read as one image.
 */
export function drawAtmosphere(ctx, { edge = "rgba(10,6,20,0.42)", wash = "rgba(150,110,210,0.05)" } = {}) {
  const g = ctx.createRadialGradient(W / 2, H * 0.45, H * 0.3, W / 2, H * 0.5, H * 0.95);
  g.addColorStop(0, "rgba(0,0,0,0)");
  g.addColorStop(1, edge);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, W, H);
}
`,

  "game.js": `// This project is empty. Replace everything in this file with the real game.
//
// What the toolkit already gives you, so you do not rewrite it:
//   engine.js    fixed-timestep loop, Input, clamp/lerp/damp/approach, seeded RNG
//   physics.js   moveAndCollide (substepped, direction-correct), rectsHit, jumpFor
//   sprites.js   bake, makeAnimator, drawSprite
//   scene.js     skyGradient, ridgeLayer, drawParallax, stars, drawAtmosphere
//   audio.js     tone, noise, SFX, setMuted
//   config.js    W, H, TILE and the palette
//
// What you must author: the character sprites, the levels, the rules, the scene.

import { W, H, PAL } from "./config.js";

export function createGame(canvas) {
  let t = 0;

  function update(dt) {
    t += dt;
  }

  /**
   * The playtest harness reads this to check the game's rules actually fire.
   * Every game must expose it. Report whatever the player can see: which screen
   * they are on, score, lives, level, and whether they have won or died.
   */
  function state() {
    return { scene: "empty", score: 0, lives: 0, level: 1, levels: 1, won: false, dead: false };
  }

  function render(ctx) {
    ctx.fillStyle = PAL.near;
    ctx.fillRect(0, 0, W, H);

    ctx.strokeStyle = "rgba(255,255,255,0.05)";
    for (let x = 0; x <= W; x += 32) {
      ctx.beginPath(); ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, H); ctx.stroke();
    }
    for (let y = 0; y <= H; y += 32) {
      ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(W, y + 0.5); ctx.stroke();
    }

    ctx.textAlign = "center";
    ctx.fillStyle = PAL.text;
    ctx.font = "700 22px ui-monospace, monospace";
    ctx.fillText("EMPTY PROJECT", W / 2, H / 2 - 6);

    ctx.fillStyle = PAL.dim;
    ctx.font = "400 12px ui-monospace, monospace";
    ctx.fillText("Describe the game you want in the chat.", W / 2, H / 2 + 18);

    ctx.globalAlpha = 0.5 + Math.sin(t * 2) * 0.3;
    ctx.fillStyle = PAL.accent;
    ctx.fillRect(W / 2 - 14, H / 2 + 34, 28, 2);
    ctx.globalAlpha = 1;
  }

  return { update, render, state };
}
`,

  "main.js": `import { run } from "./engine.js";
import { createGame } from "./game.js";

const canvas = document.getElementById("stage");
const game = createGame(canvas);

// Lets the playtest harness inspect the game's rules. Harmless in a browser.
window.__GS_STATE = () => (game.state ? game.state() : null);

run({ canvas, update: game.update, render: game.render });
`,
};

export const STARTER_SUMMARY = `Empty project. The toolkit is in place but no game has been built yet: engine.js (fixed-timestep loop, Input, maths), physics.js (substepped AABB tilemap collision, rectsHit, jumpFor), sprites.js (bake, makeAnimator, drawSprite), scene.js (sky, parallax ridges, stars, atmosphere), audio.js (tone/noise synthesis and an SFX set), and config.js (W/H/TILE and the palette). game.js is a placeholder that draws an "empty project" screen and must be replaced with the real game.`;
