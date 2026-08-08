---
name: grid-puzzle
title: Grid and puzzle games
description: Use for match-3, Tetris-likes, sokoban, 2048, minesweeper, card games, board games, tile-matching and any turn-based or grid-based game. Covers grid representation, move validation, cascade resolution, undo and animating discrete state.
---

# Grid and puzzle games

These games have no physics and no frame-rate-dependent logic. The whole game is a
pure function over a grid. Structure them that way and they become almost bug-free.

## Separate logic from presentation, completely

```js
// Pure: grid in, grid out. No canvas, no timers, no randomness beyond a passed seed.
export function applyMove(grid, move) { /* -> { grid, events } }*/ }
```

Rendering then interpolates *toward* the logical state. This split is what makes
undo, hints, solvers and AI opponents cheap to add later — and it means you can test
the rules mentally without simulating animation.

## Grid representation

Use a flat array with an index helper. It is faster, easier to clone, and avoids the
`grid[y][x]` vs `grid[x][y]` mixups that cause half the bugs in these games.

```js
const W = 8, H = 8;
const idx = (x, y) => y * W + x;
const inside = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
let grid = new Array(W * H).fill(0);
```

Pick one convention — **`x` is column, `y` is row, origin top-left** — and write it in
a comment at the top of the file.

Neighbour offsets as a named constant, never inline:

```js
const N4 = [[0,-1],[1,0],[0,1],[-1,0]];
const N8 = [...N4, [1,-1],[1,1],[-1,1],[-1,-1]];
```

## Turn structure

```
input -> validate -> apply -> resolve cascades -> check end -> next turn
```

Validate and apply must be separate. Validation with no side effects lets you grey
out illegal moves, show hints, and let an AI look ahead.

```js
if (!isLegal(grid, move)) { sfx.deny(); return; }
const { grid: next, events } = applyMove(grid, move);
history.push(grid);          // push BEFORE replacing — this is your undo stack
grid = next;
queueAnimations(events);
```

## Cascades (match-3, chain reactions)

Resolve in a loop until stable, collecting events per pass so the animation can play
them as a sequence with escalating pitch and score multiplier.

```js
function resolve(grid) {
  const passes = [];
  for (let n = 0; n < 20; n++) {                 // hard cap: never trust "until stable"
    const matches = findMatches(grid);
    if (!matches.length) break;
    passes.push({ matches, multiplier: n + 1 });
    grid = collapse(clear(grid, matches));
  }
  return { grid, passes };
}
```

The escalating multiplier per pass is what makes chains feel good. Play each pass
~180ms apart with a rising tone.

After resolving, check that at least one legal move exists; if not, reshuffle (and
say so) rather than dead-ending the player.

## Sokoban / push logic

```js
function push(grid, from, dir) {
  const to = add(from, dir), beyond = add(to, dir);
  if (isWall(grid, to)) return null;
  if (isBox(grid, to)) {
    if (isWall(grid, beyond) || isBox(grid, beyond)) return null;
    return move(move(grid, to, beyond), from, to);
  }
  return move(grid, from, to);
}
```
Return `null` for an illegal move rather than mutating and rolling back.

## Tetris-likes — the details that matter

- **Wall kicks.** On rotation failure, retry at offsets `[[1,0],[-1,0],[0,-1],[2,0],[-2,0]]`
  before rejecting. Without kicks, rotation near walls feels broken.
- **Lock delay.** ~0.5s after landing before the piece locks, reset on successful
  move/rotate, with a cap on resets. This is the single biggest feel factor.
- **Bag randomiser, not `Math.random()`.** Shuffle all 7 pieces and deal them out;
  refill when empty. True random produces droughts that players experience as unfair.
- **Ghost piece** showing the landing position. Non-negotiable for playability.

## Undo

Cheap and enormously valuable in puzzle games. Because state is a plain array,
undo is a stack of clones:

```js
const history = [];
const undo = () => { if (history.length) grid = history.pop(); };
```
Cap the stack (~100) so memory stays bounded. Bind it to `Z` and put a visible button
in the HUD — puzzle players expect it, and it removes the fear that stops
experimentation.

## Animating discrete state

Never animate the logical grid. Give each visual cell its own tween toward the cell
it now represents.

```js
for (const c of cells) {
  c.dx = lerp(c.dx, 0, 1 - Math.pow(0.001, dt));   // offset from its true position
  c.scale = lerp(c.scale, 1, dt * 14);
}
```
Input stays enabled during animation, or the game feels sluggish. If a move arrives
mid-animation, snap the previous one to completion and start the next.

## Difficulty in puzzle games

Difficulty is *knowledge*, not speed. Ramp by:
- introducing one new element type per few levels,
- reducing move budgets rather than adding timers,
- increasing the lookahead required (chains, dependencies),
- and never by shrinking the input window.

A timer turns a puzzle into an action game. Only add one if that is the design.
