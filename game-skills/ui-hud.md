---
name: ui-hud
title: In-game UI, HUD, menus and accessibility
description: Use when adding score displays, health bars, menus, pause, title screens, game-over screens, touch controls, or making a game playable for more people. Covers readable HUD layout, screen transitions, mobile input and the accessibility floor.
---

# In-game UI

The HUD is part of the art direction, not an overlay bolted on top. Draw it in the
same visual language as the game (see `procedural-art`).

## Layout rules

- **Corners, not the middle.** Score top-left, lives/health top-right, ammo or
  ability state bottom-left. The centre of the screen belongs to gameplay.
- **Keep it 12-16px from the edge** at 640×360. Anything tighter looks cramped and
  gets clipped on odd aspect ratios.
- **Fixed-width numbers.** `String(score).padStart(5, "0")` or tabular figures.
  Otherwise the score jitters as digits change width and the eye is drawn to it
  constantly.
- **Prefer diegetic feedback.** A player sprite that visibly cracks as it takes damage
  beats a health bar. Fewer HUD elements means more attention on the game.

## Score that reads

Numbers ticking up feel better than numbers snapping:

```js
displayScore = Math.ceil(lerp(displayScore, score, 1 - Math.pow(0.002, dt)));
```

Add a floating "+10" at the pickup location that rises and fades over ~0.6s. This is
the cheapest way to make scoring feel rewarding, and it tells the player *what*
earned points.

## Health

- ≤ 5 hit points: draw discrete pips. Countable at a glance, and losing one is a
  clear discrete event.
- \> 5: a bar. Add a slower-draining "ghost" bar behind it in a darker shade so the
  player sees how much they just lost.
- Flash the whole bar white for 80ms on damage.

## Screens and transitions

Three screens minimum: title, playing, game over. Give each a job.

- **Title:** the game's name, one line of controls, and a single "press SPACE" prompt.
  Show the game running behind it (attract mode) if you can — it sells the game
  before a button is pressed.
- **Game over:** score, best score, and *how to retry*, in that visual priority. If
  the run ended close to a milestone, say so ("12 short of your best") — it is the
  strongest retry hook there is.
- **Pause:** `Esc` or `P`. Must stop the simulation, not just hide it.

Transition with a 200-300ms fade or wipe rather than a hard cut. Draw the outgoing
screen, then a full-screen rect with rising alpha.

```js
ctx.fillStyle = `rgba(13,11,18,${fade})`;
ctx.fillRect(0, 0, W, H);
```

## Menus

Keyboard-first: up/down to move, Enter to confirm, Esc to back out. Highlight the
selected row with a filled bar and a small caret, not colour alone. Play a short blip
on move and a two-note confirm.

If there are settings, the three worth having are: mute, difficulty, and a control
scheme toggle. Persist all of them via `GameSave.set("settings", …)`.

## Touch controls

Many players will be on a phone. Detect and adapt rather than requiring a keyboard:

```js
const touch = matchMedia("(pointer: coarse)").matches;
```

- **Virtual stick** for free movement: on `pointerdown` record the origin, then use the
  drag delta clamped to a radius. Floating (origin wherever they touch) beats a fixed
  stick position.
- **Tap zones** for simple games: left half / right half, or tap-anywhere-to-jump.
- Touch targets ≥ 44px. Draw them semi-transparent so they do not dominate.
- `touch-action: none` on the canvas (already set in the starter) prevents scroll
  hijacking your input.
- Never require a hover state or a keyboard-only key for a core action.

## Accessibility floor

These are cheap and they materially widen who can play:

- **Do not encode meaning in colour alone.** The enemy and the pickup must differ in
  shape or motion too, not only hue. Roughly 1 in 12 men cannot reliably distinguish
  red from green.
- **Contrast.** Gameplay-critical elements need clear separation from the background.
  Test by squinting: if the player dot disappears, fix it.
- **Respect reduced motion:**
  ```js
  const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const shakeAmount = calm ? 0 : trauma * trauma;
  ```
  Also drop flashing effects and heavy particle bursts when set.
- **No fast flashing.** Never flash brighter than mid-grey more than 3 times per
  second — it is a genuine seizure risk.
- **Text ≥ 11px** at the game's native resolution, and never thin weight on a busy
  background.
- **Pausable.** Any game longer than 30 seconds needs a pause.

## Anti-patterns

- HUD text over gameplay with no backing plate — it becomes unreadable the moment the
  background gets busy. Add a subtle dark rounded rect behind it.
- Instructions the player must read before the game starts.
- A game-over screen that restarts on any key, including the key held down when you
  died — require a key *press* after a short lockout (~0.4s).
- Menus reachable only with the mouse.
