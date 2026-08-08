---
name: level-design
title: Levels, pacing and procedural generation
description: Use when adding levels, rooms, stages, waves or endless generation, or when the game is mechanically fine but boring. Covers teach-test-twist pacing, level data formats, difficulty curves and the practical procedural generation algorithms.
---

# Levels and pacing

A mechanic is not content. Level design is what turns one verb into ten minutes.

## Teach, test, twist

Introduce every mechanic in this three-beat sequence, with no text:

1. **Teach — safe.** The player meets the idea somewhere failure costs nothing. A
   single spike pit they cannot fall into by accident.
2. **Test — consequence.** The same idea, now with a real cost for getting it wrong.
3. **Twist — combine.** Fold it together with something already learned.

Nintendo builds entire games on this loop. It works because the player learns by
doing and never feels lectured.

**Corollary:** the first 10 seconds of your game are a tutorial whether you designed
them or not. Make the opening screen physically impossible to fail, and place the
first pickup where the natural first movement leads.

## Pacing

Difficulty should oscillate upward, not climb monotonically. Players need valleys to
notice the peaks.

```
intensity
   ^          ___/\
   |     /\__/     \__      <- rest beats after each peak
   |  /\/             \
   +--------------------> time
```

- Peak roughly every 30-45s in an arcade game.
- After a hard section, give 3-5 seconds of easy traversal or a guaranteed pickup.
- Never place the hardest challenge immediately after a checkpoint-less death.

## Level data, not level code

Levels belong in data files so they can be edited, generated and tested without
touching logic.

```js
// levels.js
export const LEVELS = [
  {
    name: "First Steps",
    map: [
      "................",
      ".........o......",
      "......#####.....",
      "..o.............",
      "####........####",
      "################",
    ],
    spawn: { x: 2, y: 4 },
    par: 20,
  },
];
```

Legend as a single shared table so renderer, collision and spawner agree:

```js
export const TILES = {
  "#": { solid: true,  color: "wall" },
  "=": { solid: true,  oneWay: true, color: "wall" },
  ".": { solid: false },
  "o": { solid: false, spawn: "pickup" },
  "^": { solid: false, spawn: "spike", deadly: true },
  "E": { solid: false, spawn: "enemy" },
};
```

Parse spawn characters into entities once at level load and replace them with empty
tiles — do not check for them every frame.

## Checkpoints and failure

- Restart must be **instant** (< 0.5s). A slow death loop is what makes a hard game
  feel unfair rather than tense. Celeste and Super Meat Boy both restart in about a
  quarter of a second.
- Restart at the last checkpoint with a fresh RNG-independent state; the player must
  believe the retry is winnable.
- Show *why* they died for ~0.4s (freeze frame, flash) before resetting.

## Procedural generation — pick the simplest that fits

**Random walk / drunkard's walk** — caves, organic tunnels. 15 lines, always connected.

```js
function walk(w, h, steps) {
  const g = Array.from({ length: h }, () => Array(w).fill("#"));
  let x = w >> 1, y = h >> 1;
  for (let i = 0; i < steps; i++) {
    g[y][x] = ".";
    const d = Math.floor(Math.random() * 4);
    x = clamp(x + [1, -1, 0, 0][d], 1, w - 2);
    y = clamp(y + [0, 0, 1, -1][d], 1, h - 2);
  }
  return g;
}
```

**BSP split** — rooms and corridors, dungeon-like. Recursively split the rectangle,
place a room in each leaf, connect sibling rooms. Gives readable, fair layouts.

**Cellular automata** — cave systems with natural walls. Fill 45% random, then run
4-5 passes of "a cell is wall if ≥5 of its 8 neighbours are wall". Always flood-fill
afterwards and discard disconnected pockets.

**Handmade chunks (strongly recommended for platformers and runners)** — author 8-15
short segments by hand, then stitch them randomly with matching entry/exit heights.
You get procedural variety with handmade quality, and it is the technique most
endless runners actually use.

```js
const CHUNKS = [
  { in: 1, out: 1, rows: ["........", "..###...", "........"] },
  { in: 1, out: 2, rows: ["........", "....##..", "..#....."] },
];
const next = (h) => pick(CHUNKS.filter((c) => c.in === h));
```

**Always validate generated output.** Verify the exit is reachable, there is at least
one pickup, and the player does not spawn inside a wall. If validation fails,
regenerate — do not ship a level the player cannot finish.

## Endless / arcade progression

Scale two variables at most, and scale them on different curves so the game does not
become uniformly hard:

```js
const t = elapsed;
const spawnRate = 1.6 / (1 + t / 55);           // asymptotic — never reaches zero
const enemySpeed = CFG.enemy.speed * (1 + Math.min(t / 90, 0.8));   // capped
```

Cap every scaling factor. Unbounded difficulty scaling always ends in a wall the
player cannot read, which feels arbitrary. Aim for the average run to end between
45 and 120 seconds.

## Checklist before calling a level done

- Can it be completed? Play it in your head, step by step.
- Is the first threat visible before it can hurt you?
- Is there one moment worth telling someone about?
- Does it introduce, or vary, exactly one idea?
