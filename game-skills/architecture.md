---
name: architecture
title: Code architecture for a growing game
description: Use when starting a game, when files exceed ~250 lines, when adding a second scene/level/menu, or when edits keep breaking unrelated things. Covers file layout, scene state machines, entity management, event flow and keeping a codebase editable over many turns.
---

# Architecture for a game that keeps growing

This codebase is edited incrementally over many conversations. Optimise for
**locating and changing one thing without reading everything** — that is what keeps
later edits cheap and safe.

## File layout

Start flat, split by responsibility as it grows. Do not create folders before there
are files to put in them.

```
index.html      entry, canvas element, module script tag
style.css       page chrome and canvas sizing only, never gameplay values
main.js         boot: wire canvas -> scenes -> run(). ~20 lines, forever.
engine.js       loop, input, timing, math helpers. Game-agnostic. Rarely changes.
config.js       ALL tuning constants and the palette. Changes constantly.
audio.js        synth helpers (see procedural-audio)
sprites.js      draw functions and offscreen caches (see procedural-art)
entities.js     entity factories and their update/draw
world.js        level data, tilemap, collision queries
scenes.js       title / play / gameover state machine
hud.js          score, lives, overlays
```

**`config.js` is the most important file.** Every magic number lives there and
nowhere else. It is what lets a user say "make jumps floatier" and get a one-line
change instead of a rewrite.

```js
export const CFG = {
  world:  { width: 640, height: 360, gravity: 1500 },
  player: { speed: 190, jump: 400, coyote: 0.10, buffer: 0.12 },
  enemy:  { speed: 60, hp: 2, spawnEvery: 2.4 },
  scoring:{ mote: 10, kill: 25, comboWindow: 1.4 },
};
```

## Scenes as an explicit state machine

Every game needs at least title / playing / gameover. Model them as objects with the
same shape, and switch by replacing one reference. This avoids the `if (state === ...)`
thicket that makes update loops unreadable by turn ten.

```js
// scenes.js
export function makeScenes(ctxDeps) {
  let current;
  const go = (scene, arg) => { current = scene(go, ctxDeps, arg); current.enter?.(); };

  return {
    start: () => go(Title),
    update: (dt) => current.update(dt),
    render: (c) => current.render(c),
  };
}

function Title(go, deps) {
  return {
    update(dt) { if (deps.input.justPressed("Space")) go(Play); },
    render(c)  { drawTitle(c); },
  };
}

function Play(go, deps) {
  const world = createWorld(deps);
  return {
    update(dt) { world.update(dt); if (world.dead) go(GameOver, world.score); },
    render(c)  { world.render(c); },
  };
}
```

Each scene owns its own state and releases it on switch. No global `resetEverything()`.

## Entities

For a browser game, a plain array of plain objects beats any ECS. Keep it simple and
uniform.

```js
const entities = [];
const spawn = (e) => (entities.push(e), e);

function update(dt) {
  for (const e of entities) if (!e.dead) e.update(e, dt, world);
  // Compact once per frame. Never splice inside the iteration.
  for (let i = entities.length - 1; i >= 0; i--) if (entities[i].dead) entities.splice(i, 1);
}
```

- **Never mutate the array while iterating it.** Mark `dead = true`, sweep after.
- Give every entity `{ x, y, vx, vy, r|w,h, dead, kind }` so generic systems
  (collision, culling, rendering) can work across all of them.
- Sort by `kind` or a `z` field once per frame if draw order matters.

## Update order — fix it and document it

Order bugs are the hardest to diagnose. Use this and keep it stable:

```
1. read input
2. scene/state transitions
3. player update
4. enemy / AI update
5. projectile update
6. physics resolve + collisions
7. spawns, timers, score
8. particles, camera, screen shake
9. input.endFrame()   <- clears justPressed; forgetting this breaks all edge triggers
```

## Determinism and time

- All timers in **seconds**, driven by `dt`. Never frame counts, never `setTimeout`
  for gameplay. A 144Hz monitor will otherwise run your game at 2.4× speed.
- Clamp `dt` (`Math.min(dt, 0.25)`) so an alt-tab does not teleport everything.
- Use a fixed timestep for physics (see `engine.js` in the starter) and let rendering
  run free.
- For anything that must be reproducible (seeded levels, replays), use a seeded PRNG,
  not `Math.random()`.

## Saving player data

`localStorage` and `IndexedDB` **throw** in this runtime — the game frame is
sandboxed onto an opaque origin. Use the injected `GameSave` bridge instead. It is
server-backed for signed-in players and falls back to local storage on the host page
for guests, so a high score survives a refresh either way.

```js
await GameSave.ready;                          // resolves once data is loaded

const best = GameSave.get("best", 0);          // synchronous read from cache
if (score > best) GameSave.set("best", score); // synchronous write, persisted async

GameSave.set("settings", { muted: true, difficulty: "hard" });  // any JSON value
GameSave.player;                                // { name, signedIn }

const board = await GameSave.submitScore(score); // -> [{ name, score }, ...] top 10
```

Await `GameSave.ready` once during boot before reading, then treat it as synchronous.
Writes are debounced and flushed on page hide, so setting a value on the death frame
is safe.

Store a `version` key alongside save data and migrate rather than wipe when the shape
changes.

## Keeping edits cheap over time

- One responsibility per file; split any file past ~250 lines.
- Export named functions, not giant objects, so an edit touches a small region.
- Put a 1-2 line comment at the top of each file saying what belongs in it. Future
  edits then land in the right place.
- When adding a feature, first check whether a constant in `config.js` already
  controls it.
- Prefer data tables (arrays of level/wave/enemy definitions) over branching code.
  Adding content should not mean adding `if` statements.

## Anti-patterns

- One 900-line `game.js`. Every edit becomes a full re-read and risks collateral damage.
- Globals mutated from several modules. Pass a `world`/`deps` object explicitly.
- Duplicated constants (gravity in two files). They will drift.
- `class` hierarchies for entities. Composition and plain objects are shorter and
  easier to modify blindly.
- Rebuilding the whole game state on every scene switch instead of scoping state to
  the scene.
