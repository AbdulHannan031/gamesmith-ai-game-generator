---
name: platformer-physics
title: Side-view platformer physics and collision
description: Use for any side-view game with gravity — platformers, runners, ninja/Mario-likes, metroidvanias. Covers axis-separated AABB tilemap collision, one-way platforms, slopes, moving platforms, wall jump, dash and ladders.
---

# Side-view platformer physics

## Use the toolkit's collision — do not write your own

`physics.js` already ships a correct implementation. Use it:

```js
import { moveAndCollide, overlapsTile, rectsHit, jumpFor } from "./physics.js";

player.onGround = false;                       // set by the call
moveAndCollide(player, dt, solidAt);           // resolves x then y, substepped
if (player.landed) SFX.land();                 // true on the frame it touched down
```

The entity needs `{ x, y, w, h, vx, vy }`. **Keep `w` and `h` smaller than the drawn
sprite** — a hitbox as wide as the artwork snags on corners and will not fit through
gaps that look passable. For a 24×28 sprite on 16px tiles use roughly 12×24, drawn
centred.

Two bugs make hand-rolled versions let players through walls, and both are subtle:

1. **Scan order.** Resolution must iterate tiles *in the direction of travel*. Scanning
   the other way resolves against the far side of whichever solid tile it happens to
   find first, which can place the entity inside the next wall along. This is the
   "walked through the wall going left" bug.
2. **No substepping.** If `speed * dt` exceeds a tile, the entity jumps clean over a
   thin wall between frames and tunnels through it.

`moveAndCollide` handles both. If you genuinely need custom behaviour, extend it
rather than replacing it.

## Why one axis at a time

**Move and resolve one axis at a time.** Horizontal first, then vertical. Solving
both together produces corner-snagging, wall-sticking and tunnelling, and it is
the source of nearly every "my character teleports" bug.

Set `e.onGround = false` at the top of the frame; only vertical resolution turns it
back on. Do not trust a raycast for ground state — resolution is the truth.

## Tilemap representation

Store levels as data, not code. An array of strings is readable, diffable and easy
for a human to hand-edit:

```js
export const LEVEL = [
  "................",
  ".......ooo......",
  "..#####....#####",
  "................",
  "################",
];
export const TILE = 16;
const SOLID = new Set(["#", "="]);
export const solidAt = (tx, ty) =>
  SOLID.has(LEVEL[ty]?.[tx] ?? ".");
```

Only test the tiles the entity actually overlaps — never loop the whole map:

```js
function* overlappingTiles(e, solidAt) {
  const x0 = Math.floor(e.x / TILE), x1 = Math.floor((e.x + e.w - 1) / TILE);
  const y0 = Math.floor(e.y / TILE), y1 = Math.floor((e.y + e.h - 1) / TILE);
  for (let ty = y0; ty <= y1; ty++)
    for (let tx = x0; tx <= x1; tx++)
      if (solidAt(tx, ty)) yield tileRect(tx, ty);
}
```

## Tunnelling at speed

If any entity can move more than one tile per step (`speed * dt > TILE`), substep:

```js
const steps = Math.ceil(Math.max(Math.abs(e.vx), Math.abs(e.vy)) * dt / (TILE * 0.5)) || 1;
for (let i = 0; i < steps; i++) moveAndCollide(e, dt / steps, solidAt);
```
Bullets should use a segment-vs-tile raycast instead of AABB substeps.

## One-way platforms

Solid only when falling and only when the entity started the frame fully above it.
Store `prevY` before moving.

```js
const isOneWay = ch === "=";
if (isOneWay) {
  if (e.vy <= 0) continue;                      // rising: pass through
  if (e.prevY + e.h > tile.top + 1) continue;   // already inside: pass through
  if (e.dropThrough > 0) continue;              // down+jump grace timer
}
```

## Slopes

Handle slopes *after* horizontal movement and *before* vertical, and only for
entities flagged as slope-aware. Represent a slope tile by a height function:

```js
// tx,ty tile with a 45° rise to the right
const heightAt = (localX) => localX;                  // 0..TILE
const groundY  = tileTop + TILE - heightAt(e.centerX - tileLeft);
if (e.y + e.h > groundY && e.y + e.h < groundY + STEP_TOLERANCE) {
  e.y = groundY - e.h; e.vy = 0; e.onGround = true;
}
```
`STEP_TOLERANCE` around 6-8px also gives you free stair-stepping. If slopes are not
core to the design, use stepped tiles instead — they cost a fraction of the code.

## Moving platforms

Move the platform first, then carry riders by the platform's delta, then run normal
entity movement. Carrying after entity movement causes jitter.

```js
plat.x += plat.vx * dt; plat.y += plat.vy * dt;
for (const e of entities) {
  if (e.onGround && standingOn(e, plat)) { e.x += plat.vx * dt; e.y += plat.vy * dt; }
}
```
On a rising platform also re-resolve vertically so the rider is not pushed into it.

## Wall jump and wall slide

```js
const touchingWall = solidAt(tileX(e.x - 1), tileY(e.cy)) ? -1
                   : solidAt(tileX(e.x + e.w + 1), tileY(e.cy)) ? 1 : 0;

if (touchingWall && !e.onGround && e.vy > 0) e.vy = Math.min(e.vy, WALL_SLIDE_MAX); // ~60

if (touchingWall && jumpBuffered) {
  e.vy = -JUMP_SPEED;
  e.vx = -touchingWall * WALL_KICK;   // ~180
  e.controlLock = 0.12;               // ignore horizontal input briefly, or the
                                      // kick is cancelled by the held direction
}
```
`controlLock` is the detail most implementations miss and it is why their wall jump
feels mushy.

## Dash

A dash is a timed state, not an impulse. During it: fix velocity, zero gravity,
lock input, keep collision on.

```js
if (e.dash > 0) {
  e.dash -= dt;
  e.vx = e.dashDir.x * DASH_SPEED; e.vy = e.dashDir.y * DASH_SPEED;
  gravityThisFrame = 0;
}
```
Refresh the dash on landing, and give 2-3 frames of hitstop plus a trail of ghost
sprites. Cooldown ~0.2s so it cannot be spammed into flight.

## Ladders and water

Both are "gravity off, different max speed" states driven by tile overlap. Model
them as an explicit `e.state` string (`"ground" | "air" | "ladder" | "dash" | "hurt"`)
rather than a pile of booleans — boolean soup is unmaintainable past three states.

## Recommended constants for a 640x360, 16px-tile game

```js
GRAVITY 1500 | MAX_FALL 520 | JUMP_SPEED 400   (≈ 3.3 tiles high)
RUN_MAX 190  | ACCEL 2400   | FRICTION 2200 | AIR_ACCEL 1600
WALL_SLIDE_MAX 60 | WALL_KICK 190 | DASH_SPEED 420 | DASH_TIME 0.14
```

Pair this with `game-feel` for coyote time, buffering and apex control — physics
that is correct but unforgiving still feels bad.
