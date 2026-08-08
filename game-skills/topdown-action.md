---
name: topdown-action
title: Top-down movement, shooting, enemies and waves
description: Use for shooters, twin-stick, bullet hell, roguelites, snake/pong/breakout style arcade games, and any top-down game without gravity. Covers movement, projectile pooling, enemy AI states, spawn waves and collision at scale.
---

# Top-down action

## Movement

Normalise diagonals or diagonal movement is 41% faster and players will exploit it:

```js
let dx = right - left, dy = down - up;
const len = Math.hypot(dx, dy);
if (len > 0) { dx /= len; dy /= len; }
```

Choose one movement model and commit:

- **Snappy (arcade, bullet hell):** `vx = dx * SPEED`. Instant response, precise dodging.
- **Weighted (brawler, survival):** accelerate toward the target with friction.
  `vx = approach(vx, dx * SPEED, ACCEL * dt)`. Use `ACCEL ≈ SPEED * 12`.
- **Inertial (asteroids, boats):** thrust along facing, drag `v *= Math.pow(0.02, dt)`.

Facing and movement are separate concerns. Aim toward the pointer or right stick;
never force the sprite to face movement direction in a twin-stick.

## Projectiles — pool them

Allocating bullets every frame causes GC hitches you will feel at 60Hz. Preallocate
and reuse with an `alive` flag.

```js
const bullets = Array.from({ length: 400 }, () => ({ alive: false, x: 0, y: 0, vx: 0, vy: 0, life: 0 }));
let cursor = 0;

function fire(x, y, angle, speed, life = 1.6) {
  for (let i = 0; i < bullets.length; i++) {
    const b = bullets[(cursor + i) % bullets.length];
    if (!b.alive) {
      cursor = (cursor + i + 1) % bullets.length;
      Object.assign(b, { alive: true, x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life });
      return b;
    }
  }
  return null;   // pool exhausted: drop the shot, never grow unbounded
}

for (const b of bullets) {
  if (!b.alive) continue;
  b.x += b.vx * dt; b.y += b.vy * dt;
  if ((b.life -= dt) <= 0 || offscreen(b, 32)) b.alive = false;
}
```

Fire rate is a timer, not a keypress: `if ((cool -= dt) <= 0 && firing) { fire(...); cool = 1 / RPS; }`

## Collision at scale

Circles for everything that moves. Compare squared distance — never call `Math.sqrt`
in a collision test.

```js
const dx = a.x - b.x, dy = a.y - b.y, r = a.r + b.r;
if (dx * dx + dy * dy <= r * r) { /* hit */ }
```

Under ~300 pairs, brute force is fine and simpler. Past that, use a uniform grid:

```js
const CELL = 48;
const grid = new Map();
const key = (x, y) => ((x / CELL) | 0) + "," + ((y / CELL) | 0);
// insert each entity under key(e.x, e.y); query the 3x3 neighbourhood only
```

Rebuild the grid each frame — it is cheaper than incremental maintenance at these
entity counts.

## Enemy AI: small explicit state machines

Three or four states cover almost every 2D enemy. Give each a timer and a clear exit.

```js
const BRAINS = {
  chaser(e, p, dt) {                       // walks straight at you
    const a = Math.atan2(p.y - e.y, p.x - e.x);
    e.vx = Math.cos(a) * e.speed; e.vy = Math.sin(a) * e.speed;
  },
  orbiter(e, p, dt) {                      // circles at a preferred range
    const a = Math.atan2(p.y - e.y, p.x - e.x);
    const d = Math.hypot(p.x - e.x, p.y - e.y);
    const radial = (d - e.range) * 2;
    e.vx = Math.cos(a) * radial - Math.sin(a) * e.speed;
    e.vy = Math.sin(a) * radial + Math.cos(a) * e.speed;
  },
  charger(e, p, dt) {                      // telegraph, then commit
    e.t -= dt;
    if (e.state === "wind" && e.t <= 0) {
      const a = Math.atan2(p.y - e.y, p.x - e.x);
      e.vx = Math.cos(a) * e.speed * 3.5; e.vy = Math.sin(a) * e.speed * 3.5;
      e.state = "rush"; e.t = 0.5;
    } else if (e.state === "rush" && e.t <= 0) { e.state = "wind"; e.t = 0.9; e.vx = e.vy = 0; }
  },
};
```

**Always telegraph.** A 0.3-0.5s wind-up with a visible tell (flash, scale-up, ground
marker) is the difference between "hard" and "unfair". Damage the player only for
mistakes they could have read.

Mix archetypes rather than scaling one enemy's HP. Two chasers plus one orbiter is a
real encounter; one chaser with triple health is a chore.

## Waves and pacing

Drive spawns from a data table so difficulty is tunable without touching logic:

```js
const WAVES = [
  { at: 0,  spawn: { chaser: 3 } },
  { at: 15, spawn: { chaser: 4, orbiter: 1 } },
  { at: 32, spawn: { chaser: 4, charger: 2 }, note: "first charger" },
];
// after the table runs out, loop the last entry with a multiplier
const scale = 1 + Math.max(0, elapsed - 45) / 60;
```

Give a 1.5-2s breather between waves. Continuous pressure with no valleys reads as
flat, not intense.

Spawn off-screen at the edge, never on top of the player, and show a brief spawn
indicator at the edge so the pressure is readable.

## Bullet-hell patterns

Patterns are just angle functions of time — compose them from three primitives:

```js
const ring   = (n, i, off = 0) => off + (i / n) * Math.PI * 2;
const spiral = (t, rate = 2.4)  => t * rate;
const fan    = (n, i, aim, arc) => aim - arc / 2 + (i / (n - 1)) * arc;
```
Keep bullets slow and dense rather than fast and sparse — the player needs time to
read the pattern. Make the player hitbox visibly smaller than the sprite (a bright
2-3px core) and say so visually; this is standard and it makes near-misses thrilling
instead of infuriating.

## Arcade classics — the specific gotchas

- **Snake:** move on a grid tick (~8-12/s), not per frame. Queue the direction change
  and apply it at the tick, and reject 180° reversals, or the player self-collides.
- **Breakout:** reflect off the paddle by *hit position*, not surface normal —
  `angle = -Math.PI/2 + (hitOffset / halfWidth) * MAX_ANGLE` with `MAX_ANGLE ≈ 1.05`.
  Clamp so the ball never travels near-horizontally. Nudge speed up per brick.
- **Pong/Breakout tunnelling:** at high ball speed, substep or sweep — a fast ball
  will pass through a paddle between frames.
- **Flappy:** the whole game is two constants (impulse, gravity) and pipe gap size.
  Tune those three before anything else.
