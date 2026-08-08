---
name: game-feel
title: Game feel and juice
description: Use whenever movement, controls, impacts or "it feels floaty/stiff/boring" come up. Concrete tuned numbers for coyote time, input buffering, squash and stretch, hitstop, screen shake, camera follow and particle feedback.
---

# Game feel and juice

Two separate things, in this order:

- **Feel** — the game responds correctly and forgivingly. Fix this first. No amount
  of particles rescues controls that eat inputs.
- **Juice** — feedback layered on a correct response so it reads and satisfies.

Put every tuning value in a named constant at the top of the file. Feel is found
by changing one number at a time, and you cannot do that with magic numbers
buried in the update loop.

```js
const FEEL = {
  COYOTE: 0.10,        // s of grace after leaving ground
  JUMP_BUFFER: 0.12,   // s a jump press stays queued before landing
  APEX_GRAVITY: 0.55,  // gravity multiplier near the top of a jump
  FALL_GRAVITY: 1.9,   // gravity multiplier while descending
  CUT_JUMP: 0.45,      // velocity kept when jump is released early
  ACCEL: 2400, FRICTION: 2000, MAX_SPEED: 190,
};
```

## Forgiveness — the highest-value work you can do

**Coyote time.** Accept a jump for a short window *after* the player walks off an
edge. Without it, players swear the game "ate" their input.

**Jump buffering.** Accept a jump pressed shortly *before* landing and fire it on
touchdown. Without it, fast players get punished for being early.

Tuned windows, in seconds:

| Game type | Coyote | Buffer |
|---|---|---|
| Tight precision platformer | 0.07 – 0.10 | 0.07 – 0.11 |
| Action platformer | 0.09 – 0.14 | 0.10 – 0.15 |
| Casual / touch | 0.11 – 0.17 | 0.12 – 0.18 |

```js
if (onGround) coyote = FEEL.COYOTE; else coyote -= dt;
if (input.justPressed("Space")) jumpBuffer = FEEL.JUMP_BUFFER; else jumpBuffer -= dt;

if (jumpBuffer > 0 && coyote > 0) {
  vy = -JUMP_SPEED;
  jumpBuffer = 0; coyote = 0;   // consume both, or you get double jumps
}
```

## Jump shape

Derive jump constants from what you actually want, not by guessing:

```js
// "reach 64px in 0.32s" -> exact gravity and launch velocity
const H = 64, T = 0.32;
const GRAVITY = (2 * H) / (T * T);
const JUMP_SPEED = GRAVITY * T;
```

Then bend the curve for feel:

- **Variable height** — on jump release while rising, `vy *= FEEL.CUT_JUMP`. Tap for
  a hop, hold for full height.
- **Apex hang** — when `abs(vy) < 40`, scale gravity by `APEX_GRAVITY`. A brief float
  at the top makes aiming mid-air possible and reads as skill, not lag.
- **Heavy fall** — while `vy > 0`, scale gravity by `FALL_GRAVITY`. Rising slow and
  falling fast is what makes Mario feel weighty rather than balloon-like.

## Acceleration, not teleportation

Never set velocity directly from input for a character you want to feel physical.

```js
const target = input.axis().x * FEEL.MAX_SPEED;
const rate = Math.sign(target) === Math.sign(vx) && target !== 0 ? FEEL.ACCEL : FEEL.FRICTION;
vx = approach(vx, target, rate * dt);
```
Air control should be roughly 60-80% of ground acceleration — enough to correct,
not enough to erase the commitment of the jump.

## Juice, in order of value per line of code

1. **Sound on every action.** Silence reads as "broken". Even a 60ms blip. See `procedural-audio`.
2. **Squash and stretch.** Scale the sprite, never the hitbox.
   ```js
   // on jump: tall and thin. on land: short and wide. decay back over ~0.12s
   scaleX = lerp(scaleX, 1, dt * 12); scaleY = lerp(scaleY, 1, dt * 12);
   ```
3. **Hitstop.** On a meaningful impact, freeze the simulation for 40-90ms while
   still rendering. It sells weight better than any particle.
   ```js
   if (hitstop > 0) { hitstop -= dt; return; } // top of update()
   ```
4. **Screen shake, scaled to the event, and decaying.** Trauma-based, never linear.
   ```js
   trauma = Math.min(1, trauma + amount);           // 0.2 pickup, 0.6 hit, 1.0 death
   const s = trauma * trauma;                        // square it: small hits barely shake
   ctx.translate(rand(-6, 6) * s, rand(-6, 6) * s);
   trauma = Math.max(0, trauma - dt * 1.6);
   ```
   Cap total offset around 6-8px at 640x360. More is nausea, not impact.
5. **Particles on every state change.** Land, dash, pickup, death. 8-20 short-lived
   squares with drag is enough; do not reach for sprites.
6. **Flash on damage.** Draw the sprite as a solid white silhouette for 60-100ms
   (`ctx.globalCompositeOperation = "source-atop"` over the sprite, or just fill the
   shape white). Reads instantly at any size.
7. **Camera lag.** Follow with `cam = lerp(cam, target, 1 - Math.pow(0.001, dt))` —
   frame-rate independent, unlike a bare `lerp(a, b, 0.1)`. Add a small look-ahead
   in the direction of travel.

## Tuning discipline

- Change one constant, play, revert if unsure. Never tune three at once.
- If it feels floaty: raise `FALL_GRAVITY`, raise `ACCEL`, shorten jump time-to-apex.
- If it feels stiff: raise coyote/buffer, add apex hang, add air control.
- If it feels weak: add hitstop and sound before adding particles.
- Respect `prefers-reduced-motion` — gate shake and heavy particle bursts behind it.

## Anti-patterns

- Shake on every frame of every event — it becomes noise and nothing reads.
- Animating the hitbox with squash and stretch — collisions become unfair.
- `setTimeout` for hitstop or i-frames. Use accumulated `dt` timers only.
- Frame-count timers (`if (t++ > 10)`) — they break on non-60Hz displays. Use seconds.
