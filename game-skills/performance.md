---
name: performance
title: Hitting 60fps in a canvas game
description: Use when the game stutters, drops frames, feels laggy, runs slowly on mobile, or when entity counts grow past a few hundred. Covers the frame budget, GC pressure, draw-call cost, culling and the profiling method.
---

# Hitting 60fps

The budget is **16.6ms per frame**, and the browser needs some of it. Aim to finish
update plus render in under 8ms and you will hold 60fps with headroom on weak
hardware.

Stutter in a canvas game is almost always one of three things, in this order of
likelihood: **garbage collection**, **per-frame allocation of canvas resources**, or
**overdraw**. Physics maths is almost never the problem.

## Garbage collection — the number one cause

A GC pause is a dropped frame. The fix is to allocate nothing in the hot loop.

```js
// BAD — three objects per entity per frame
const dir = { x: dx / len, y: dy / len };
const pos = { x: e.x + dir.x * s, y: e.y + dir.y * s };
entities.filter(e => e.alive).forEach(...)      // allocates a new array every frame

// GOOD — scratch values and in-place iteration
const invLen = 1 / len;
e.x += dx * invLen * s;
for (let i = 0; i < entities.length; i++) { const e = entities[i]; if (!e.alive) continue; }
```

- Pool everything spawned repeatedly: bullets, particles, damage numbers, enemies.
  See `topdown-action` for the pool pattern.
- Avoid `map`/`filter`/`reduce`/spread inside the loop — they all allocate. They are
  fine on menus and level load.
- Reuse one scratch vector object rather than returning new ones from helpers.
- Do not build strings every frame (`"Score: " + n` for 200 entities). Cache them and
  rebuild only when the value changes.

## Canvas costs, from most to least expensive

1. **`shadowBlur`** — pathological. Never per entity per frame. Fake glow with a
   larger translucent shape underneath, or a cached blurred sprite.
2. **`createLinearGradient` / `createPattern` per frame** — build once, cache, reuse.
3. **State changes** (`fillStyle`, `font`, `save`/`restore`) — batch by colour. Draw all
   red things, then all blue things, rather than alternating.
4. **Text** — `fillText` is slow and re-measures each call. Cache rendered text to an
   offscreen canvas if it is static.
5. **Many small `drawImage` calls** — fine, this is the fast path. Prefer it over
   re-running path construction.
6. **Path building** (`beginPath`/`arc`/`fill`) — acceptable for tens of shapes, not
   for thousands. Cache repeated shapes as offscreen canvases.

```js
// Batch by state instead of per-entity fillStyle churn
ctx.fillStyle = PALETTE.enemy;
for (const e of enemies) ctx.fillRect(e.x, e.y, e.w, e.h);
```

## Cull before you draw

Never draw or fully update what is off-screen.

```js
const pad = 48;
if (e.x < cam.x - pad || e.x > cam.x + W + pad) continue;
```
For tilemaps, iterate only the visible tile range — never the whole map:

```js
const x0 = Math.max(0, Math.floor(cam.x / TILE));
const x1 = Math.min(MAP_W - 1, Math.ceil((cam.x + W) / TILE));
```
Drawing a 200×200 tile map in full is 40,000 draw calls per frame; the visible window
is about 900.

## Resolution and DPR

Render at a fixed logical resolution (640×360 in the starter) and let CSS scale it up.
On a 3× DPR phone, an uncapped backing store is 9× the pixels for no visual gain.

```js
const dpr = Math.min(window.devicePixelRatio || 1, 2);   // cap at 2
```
For a pixel-art look, keep the backing store at exactly 640×360 with
`image-rendering: pixelated` — it is both sharper and cheaper.

Also: `canvas.getContext("2d", { alpha: false })` when the game fills the whole frame.
It lets the browser skip compositing transparency.

## Collision at scale

Brute-force pair checks are O(n²): 100 entities is 4,950 checks (fine), 1,000 is
499,500 (not fine). Past ~300 entities use a uniform grid (see `topdown-action`), and
compare squared distances rather than calling `Math.hypot` or `Math.sqrt`.

Only test pairs that can actually interact — player vs enemy, bullet vs enemy — never
every entity against every other.

## Fixed timestep safety

```js
acc += Math.min(dt, 0.25);                  // clamp: a background tab must not
while (acc >= STEP) { update(STEP); acc -= STEP; }   // trigger a 400-step catch-up
```
Without the clamp, returning to a backgrounded tab runs thousands of updates in one
frame and the page locks up. Also cap iterations per frame (`let n = 0; while (acc >= STEP && n++ < 5)`)
so a slow machine degrades to slow-motion instead of a death spiral.

## Profiling method

Do not guess. Measure, in this order:

1. Add a frame-time readout to the HUD — `dt * 1000` smoothed. If it spikes
   periodically rather than sitting high, it is GC.
2. Comment out `render()`. Still slow? The problem is in update, which is unusual.
3. Halve the entity count. Linear improvement means algorithmic cost; no change
   means a fixed per-frame cost like a gradient or shadow.
4. Chrome DevTools → Performance. A sawtooth memory graph confirms GC pressure.

## Mobile

- Target 30fps as the floor on low-end devices; make it a setting rather than
  degrading silently.
- Particle counts should scale with a quality setting, not be hard-coded.
- Cap DPR at 2, and consider 1.5 for particle-heavy games.
- Avoid `filter` and `globalCompositeOperation` in the hot loop — both are much
  slower on mobile GPUs than on desktop.

## Anti-patterns

- `document.querySelector` inside the loop. Cache DOM references at boot.
- Reading layout (`getBoundingClientRect`, `offsetWidth`) every frame — it forces
  synchronous layout. Read it on resize only.
- `console.log` in the update loop. It is slow and it floods the editor's log panel.
- Optimising before measuring. Most of these costs do not matter until they do; get
  the game fun first, then profile.
