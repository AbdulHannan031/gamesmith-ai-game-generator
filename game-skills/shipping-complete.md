---
name: shipping-complete
title: Shipping a complete game, not a tech demo
description: Use on every game before calling it finished, and whenever the request is to "make a game" rather than a specific tweak. Defines the difference between a demo and a playable game — real levels, a route through them, a win condition, and enough content to be worth playing.
---

# Shipping a complete game, not a tech demo

A demo proves a mechanic works. A game gives someone a reason to keep playing and
a moment where they win. Most generated games stop at the demo: a character that
moves, some obstacles, an endless score. That is half a deliverable.

## The line between them

| Demo | Game |
|---|---|
| One screen, or endless filler | Designed levels with a beginning and an end |
| Randomly scattered obstacles | A hand-authored route with intent behind each placement |
| Score goes up forever | A win condition you can actually reach |
| One enemy behaviour | An escalating cast introduced one at a time |
| Restart drops you where you were | Levels, checkpoints, and visible progress |
| Placeholder rectangles | Characters with silhouettes and animation |

If the answer to "how does a player win?" is "they don't", it is not finished.

## Minimum shape of a complete game

Build all of this before you call it done:

1. **Title screen** — name, one line of controls, a start prompt. Ideally the game
   running behind it.
2. **A tutorial opening** that cannot be failed and teaches the core verb by layout,
   not text.
3. **3-6 authored levels or stages** that escalate. Not one level repeated.
4. **A second and third threat type**, each introduced on its own before combining.
5. **A finale** — a boss, a timed escape, a hardest room. Something recognisable as
   the end.
6. **A win screen** distinct from the game-over screen.
7. **Progress that persists** — furthest level reached, best time or score, via
   `GameSave`.
8. **A pause**, and a mute.

That is roughly 5-12 minutes of content, which is the right size for a browser
game. Aim for that, not for infinity.

## Design the route, not just the level

A route is the sequence of challenges the player moves through, and the shape of
that sequence is the actual design work. Sketch it before writing map data:

```
L1  teach: move + jump         · no hazards            · 25s
L2  teach: gaps                · first fall risk       · 35s
L3  introduce: patrol enemy    · wide platforms        · 40s
L4  combine: gaps + patrols    · first checkpoint      · 50s
L5  introduce: moving platform · one new idea only     · 55s
L6  finale: all three + boss   · everything learned    · 90s
```

Each row must answer: **what is new here, and what does it test?** A level that
introduces nothing and tests nothing should be cut, not shipped.

Rules for the route:

- **One new idea per level.** Two at once and the player cannot tell what killed them.
- **Escalate, then release.** After a hard level, an easier one so the next peak lands.
- **The last level uses everything** and adds nothing.
- Every level must be **completable without luck**. Walk it mentally, step by step,
  before shipping it.

## Author the map, do not scatter it

Random placement produces filler that feels arbitrary. Author levels as data — you
can still generate variation *within* an authored structure.

```js
// levels.js — the whole game's content lives here, editable in one place
export const LEVELS = [
  {
    name: "First Steps",
    hint: "Arrow keys to move, Space to jump",
    map: [
      "........................",
      "..........o.............",
      "......P........###......",
      "....####.........o......",
      "................####....",
      "..o.......^^............",
      "########################",
    ],
    par: 25,
  },
  // ...
];

export const TILES = {
  "#": { solid: true },
  "=": { solid: true, oneWay: true },
  "^": { hazard: true },
  "o": { pickup: true },
  "P": { spawn: "player" },
  "E": { spawn: "enemy" },
  "G": { goal: true },     // every level needs one
};
```

Every level must contain a **goal tile** and a reachable path to it. Parse spawn
characters into entities once at load and clear them from the tile grid.

For endless or arcade games where levels do not apply, the equivalent is **phases**:
named, escalating stages with distinct rules, a visible phase indicator, and a
final phase that can be survived to win.

## Validate before shipping

Write and run these checks in your head against the actual map data:

- Is the goal reachable from the spawn given the character's jump height and run
  speed? Compute the maximum gap the player can clear and check no required gap
  exceeds it.
- Does the player spawn inside a wall?
- Is there a hazard the player cannot see before it can hurt them?
- Can any enemy reach the spawn point before the player can react?
- Is every pickup obtainable?

Jump reach, for the constants in `platformer-physics`:

```js
maxJumpHeight = (JUMP_SPEED * JUMP_SPEED) / (2 * GRAVITY);   // ≈ 53px
maxGap        = RUN_MAX * (2 * JUMP_SPEED / GRAVITY);        // ≈ 101px
```
Keep required gaps at or under ~80% of `maxGap`. Anything closer is a precision
test, and precision tests belong in one deliberate place, not everywhere.

## Build order

Do not build the content before the game is fun.

1. **Vertical slice** — one level, one enemy, the core verb, and a goal you can reach.
   Play it. If this is not fun, more content will not help.
2. **Feel pass** — coyote time, buffering, hitstop, sound. See `game-feel`.
3. **Art pass** — real characters and a composed background. See `character-art` and
   `scene-composition`.
4. **Content pass** — the remaining levels, following the route plan.
5. **Frame pass** — title, win screen, pause, save, mute.
6. **Balance pass** — play it and tune the numbers in `config.js`.

Never leave the game unrunnable between these. Each stage should be playable.

## What to say when it is done

Tell the player what the game is, how long it takes, and how to win — in the game
itself and in the reply. "Six levels, about eight minutes. Reach the flag in the
last room to win." A player who does not know the goal cannot pursue it.

## Definition of done

- [ ] Can the player win, and does something acknowledge it?
- [ ] Are there at least three distinct authored levels or phases?
- [ ] Is there more than one threat type, each introduced separately?
- [ ] Is the opening unfailable and wordlessly instructive?
- [ ] Do characters look drawn rather than placed?
- [ ] Does the background read as a scene, not a colour fill?
- [ ] Does every action make a sound?
- [ ] Does progress persist across a reload?
- [ ] Is there a pause and a mute?
- [ ] Is restart under a second?
