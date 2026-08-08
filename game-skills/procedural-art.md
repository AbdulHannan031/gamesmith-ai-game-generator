---
name: procedural-art
title: Making art with code — sprites, tiles, palettes, backgrounds
description: Use whenever the game needs visuals, sprites, characters, tiles, backgrounds, or when the user says it "looks bad/plain/programmer-art". There are no image files on this platform, so all art is drawn with canvas code — this covers how to make that look deliberate rather than cheap.
---

# Making art with code

There are no image assets here. Everything is drawn with Canvas2D. That is a
constraint, not a limitation — it pushes you toward a coherent graphic style,
which reads better than a bag of mismatched sprites.

## Pick a visual language first, then stay inside it

Choose one and apply it to *every* element, including UI:

| Language | Rules | Suits |
|---|---|---|
| **Neon vector** | 2px strokes, additive glow, black background, no fills | shooters, arcade, abstract |
| **Flat geometric** | solid fills, no strokes, hard shadows offset 2px | puzzle, casual, mobile |
| **Chunky pixel** | integer coordinates, 3-5px "pixels", limited palette | platformers, retro |
| **Soft paper** | off-white background, muted fills, 1px darker outline, rounded joins | cozy, puzzle |
| **Silhouette** | near-black shapes on a coloured gradient sky, one accent | atmospheric, runners |

Consistency is what separates "stylised" from "unfinished". A neon player with a
flat-shaded enemy looks broken; two neon shapes look designed.

## Palettes that hold together

Never pick colours ad hoc in draw calls. Define one palette object and reference it
everywhere — it is also how you let the user reskin the game in one edit.

```js
export const PALETTE = {
  bg: "#0d0b12", bgAlt: "#161222",
  ink: "#f4f1ff", dim: "#8b849c",
  player: "#7cf5d5", enemy: "#ff5d8f", pickup: "#ffd166",
};
```

Rules that reliably produce a good palette:

- **5-7 colours total.** More reads as noise.
- **One hue family for the world, one contrasting hue for the player, one for danger.**
  The player must be the highest-contrast thing on screen at all times.
- **Danger is never the same hue as reward.** If pickups are yellow, hazards must not be.
- Generate variants from a base hue rather than hand-picking:
  ```js
  const hsl = (h, s, l) => `hsl(${h} ${s}% ${l}%)`;
  const shade = (h, l) => hsl(h, 62, l);   // shade(280, 22) ... shade(280, 74)
  ```
- Backgrounds sit 20-40% desaturated and 15-25% darker than foreground elements, so
  gameplay objects pop without needing outlines.

## Shape-based characters

A recognisable character needs three things: a silhouette, one asymmetry, and one
accent. Not detail.

```js
function drawWalker(ctx, x, y, t, facing, c) {
  const bob = Math.sin(t * 10) * 1.5;          // life comes from motion, not detail
  ctx.save();
  ctx.translate(x, y + bob);
  ctx.scale(facing, 1);

  ctx.fillStyle = c.body;                       // body — the silhouette
  roundRect(ctx, -6, -14, 12, 14, 3); ctx.fill();

  ctx.fillStyle = c.accent;                     // visor — the asymmetry + accent
  roundRect(ctx, 0, -11, 5, 4, 1.5); ctx.fill();

  ctx.fillStyle = c.body;                       // legs — counter-phase swing
  const swing = Math.sin(t * 10) * 3;
  ctx.fillRect(-4, 0, 3, 5 + swing);
  ctx.fillRect(2, 0, 3, 5 - swing);
  ctx.restore();
}
```

The bob and the counter-phase legs do more for readability than fifty extra
polygons. Animate *transforms*, not artwork.

## Seeded procedural sprites

For variety across enemies or a whole cast, generate from a seed so the same enemy
always looks the same. Mirror the left half — bilateral symmetry is what makes noise
read as a creature.

```js
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeSprite(seed, w = 8, h = 10, colors) {
  const rnd = mulberry32(seed);
  const half = Math.ceil(w / 2);
  const cells = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < half; x++) {
      // Denser toward the centre column and the vertical middle: gives a body,
      // not static.
      const p = 0.75 - (x / half) * 0.45 - Math.abs(y / h - 0.5) * 0.5;
      const on = rnd() < p;
      cells.push(on ? (rnd() < 0.22 ? 2 : 1) : 0);
    }
  }
  const cvs = new OffscreenCanvas(w, h);
  const c = cvs.getContext("2d");
  for (let y = 0; y < h; y++) for (let x = 0; x < half; x++) {
    const v = cells[y * half + x];
    if (!v) continue;
    c.fillStyle = v === 2 ? colors.accent : colors.body;
    c.fillRect(x, y, 1, 1);
    c.fillRect(w - 1 - x, y, 1, 1);     // mirror
  }
  return cvs;
}
```

Run a single smoothing pass (any cell with ≥5 filled neighbours turns on, ≤2 turns
off) if results look too speckled.

## Cache anything you draw more than once

Rebuilding a complex shape every frame for every entity is the most common cause of
frame drops here. Draw once to an offscreen canvas, then blit.

```js
const cacheMap = new Map();
function sprite(key, w, h, paint) {
  let c = cacheMap.get(key);
  if (!c) {
    c = new OffscreenCanvas(w, h);
    paint(c.getContext("2d"));
    cacheMap.set(key, c);
  }
  return c;
}
// later: ctx.drawImage(sprite("enemy:red", 16, 16, paintEnemy), x, y);
```

## Tiles and autotiling

Draw tiles from an index, and vary them subtly by position so a wall does not look
like a photocopy:

```js
const v = ((tx * 73856093) ^ (ty * 19349663)) % 3;   // stable per-tile variation
```

For clean edges, pick the tile art from a 4-bit neighbour mask (N/E/S/W solid),
giving 16 cases. Even drawing only the *edge highlight* per case — a 2px lighter
line on exposed faces — transforms a flat block field into readable terrain.

## Backgrounds that add depth cheaply

- **Parallax layers.** 2-3 layers at 0.2 / 0.5 / 0.8 of camera speed. Even simple
  shapes gain enormous depth. Draw far layers desaturated and low-contrast.
- **Starfield.** Preallocate points with a depth value; scroll by `depth * camVx`.
- **Vertical gradient** via `createLinearGradient`, built once and cached — creating
  gradients per frame is a real cost.
- **Vignette.** A radial gradient from transparent to `rgba(0,0,0,0.45)` at the edges
  focuses the eye and hides the canvas boundary. One of the highest ratio of
  perceived-polish to code in this whole document.
- **Scanlines / grid.** 1px lines at 3-4px spacing at 6-10% opacity, drawn once to a
  cached pattern.

## Text

Canvas has no font files, so use the CSS stack already in `style.css`. Set
`ctx.textAlign` and `ctx.textBaseline` explicitly — the defaults ("start"/"alphabetic")
are the reason HUD text drifts. For a retro look, `letterSpacing` is supported on
modern canvas contexts: `ctx.letterSpacing = "2px"`.

## Anti-patterns

- `ctx.shadowBlur` per entity per frame. It is extremely slow; fake glow by drawing a
  larger translucent copy underneath.
- `save()`/`restore()` around every single draw call — batch by state instead.
- Drawing at fractional coordinates in a pixel style: `Math.round()` positions, or
  everything shimmers.
- More than ~7 colours, or a new colour introduced mid-project without adding it to
  `PALETTE`.
