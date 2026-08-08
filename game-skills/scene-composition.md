---
name: scene-composition
title: Composing scenery that looks designed, not generated
description: Use whenever building backgrounds, environments, landscapes, skies, level scenery or decorative elements, and whenever a scene looks "random", "ugly", "flat", "noisy" or "programmer art". Covers value structure, atmospheric depth, palette construction, composition rules and constrained randomness.
---

# Composing scenery that looks designed

Procedurally placed scenery looks ugly for four specific, fixable reasons:

1. **No value structure** — everything sits at the same lightness, so nothing reads.
2. **Uniform randomness** — evenly scattered objects at one size, which reads as noise.
3. **Full saturation everywhere** — no atmosphere, no depth, and the player is lost in it.
4. **Competing detail** — the background fights the gameplay for attention and wins.

Fix those four and even simple shapes look intentional.

## Step 1 — Decide the scene before drawing it

Write these three down first. Two minutes here saves an hour of tweaking.

- **Mood word.** One: serene, hostile, derelict, festive, sunbaked, frozen.
- **Time and light direction.** Where is the light coming from? Every shadow in the
  scene must agree with that one answer.
- **Focal point.** Exactly one. Usually the player. Everything else supports it.

## Step 2 — Value structure (this matters more than colour)

Squint at your scene. If you cannot instantly tell the player from the background, no
amount of colour work will save it.

Assign every layer to a **value band** and keep bands separated:

| Layer | Value | Saturation | Detail |
|---|---|---|---|
| Sky / far background | 55-75% lightness | 10-25% | none |
| Mid background | 35-50% | 25-40% | silhouettes only |
| Playfield / terrain | 20-35% | 40-55% | moderate |
| **Gameplay entities** | **70-95%** | **70-95%** | **highest contrast on screen** |
| Foreground frame | 8-15% | 20-40% | silhouette, often near-black |

The player is the brightest, most saturated thing in the frame. Always. If a
background element is competing, darken and desaturate the background — never
brighten the player past readable.

Use **3-4 distinct value groups**, not a smooth gradient of twenty. Grouped values
read as structure; evenly spread values read as mush.

## Step 3 — Atmospheric depth

Distance does four things at once. Apply all four together or the effect fails:

1. **Saturation drops** toward the horizon.
2. **Contrast compresses** — far layers converge toward the sky's value.
3. **Hue shifts toward the sky colour** (usually cooler and bluer).
4. **Detail disappears** — far layers are silhouettes, not objects.

```js
// One function, applied by depth 0 (far) .. 1 (near)
function depthColor(baseH, baseS, baseL, depth, sky) {
  const t = 1 - depth;                       // how much atmosphere is in the way
  return `hsl(${lerp(baseH, sky.h, t * 0.55)}
              ${lerp(baseS, sky.s, t * 0.7)}%
              ${lerp(baseL, sky.l, t * 0.65)}%)`;
}
```

Parallax speed must agree with the depth cue — a layer that looks distant but scrolls
fast destroys the illusion instantly.

```js
const LAYERS = [
  { depth: 0.00, speed: 0.05 },   // sky gradient — barely moves
  { depth: 0.25, speed: 0.15 },   // far ridges
  { depth: 0.55, speed: 0.40 },   // mid hills, trees
  { depth: 0.85, speed: 0.75 },   // near scenery
  { depth: 1.00, speed: 1.15 },   // foreground frame — moves faster than the camera
];
```

## Step 4 — Palette construction

Do not pick colours one at a time. Derive them.

**Analogous base + one complementary accent** is the reliable formula:

```js
function palette(baseHue, mood = "cool") {
  const shift = mood === "warm" ? 1 : -1;
  return {
    sky:   hsl(baseHue,               35, 68),
    far:   hsl(baseHue + shift * 12,  30, 52),
    mid:   hsl(baseHue + shift * 24,  38, 36),
    near:  hsl(baseHue + shift * 32,  45, 22),
    fore:  hsl(baseHue + shift * 38,  30, 11),
    accent:hsl((baseHue + 180) % 360, 82, 62),   // the ONLY complementary hue
  };
}
```

Rules that keep it coherent:

- **One accent hue, used sparingly** — the player, pickups, and nothing else. An accent
  used everywhere is no longer an accent.
- **Hue-shift, never just darken.** Shadows shift cool (toward blue/violet) and
  desaturate slightly; highlights shift warm (toward yellow/orange). Multiplying
  lightness alone gives the muddy, plastic look.
  ```js
  const shade = (h, s, l) => hsl(h - 18, s + 6, l - 22);   // cooler, richer, darker
  const light = (h, s, l) => hsl(h + 14, s - 10, l + 20);  // warmer, softer, lighter
  ```
- **Never pure black or pure white.** Use `hsl(baseHue, 25%, 8%)` and
  `hsl(baseHue, 12%, 94%)`. Pure `#000` flattens everything it touches.
- **6-8 colours total for the whole scene.** Constraint is what produces cohesion.

### Time-of-day starting points

| Mood | Base hue | Sky L | Accent |
|---|---|---|---|
| Dawn | 25 (amber) | 78 | 205 (cool blue) |
| Midday | 200 (sky blue) | 82 | 35 (warm sand) |
| Dusk | 285 (violet) | 55 | 20 (ember orange) |
| Night | 230 (deep blue) | 18 | 165 (cyan glow) |
| Toxic / alien | 95 (acid green) | 32 | 320 (magenta) |
| Frozen | 195 (pale cyan) | 88 | 15 (rust) |

## Step 5 — Composition

- **Horizon on a third, never the centre.** Centre horizon splits the frame into two
  competing halves and reads as an accident. Low horizon = vast and open; high horizon
  = enclosed and grounded.
- **Leading lines.** Ridges, roads and light shafts should angle toward the focal point.
- **Negative space around the player.** Keep the area the player occupies visually
  quiet. Detail belongs at the edges, not under the action.
- **Odd numbers and irregular grouping.** Three trees clustered plus one apart reads as
  natural; four evenly spaced trees reads as a fence.
- **Overlap creates depth.** Objects that overlap read as near/far instantly — a
  stronger cue than size alone.
- **Avoid tangents.** A hill whose peak exactly touches the horizon, or an object
  edge-aligned with another, creates a visual snag. Overlap clearly or separate clearly.
- **Silhouette test.** Fill every element with flat black. Still readable? Good design.
  Indistinct blobs? Fix the shapes, not the colours.

## Step 6 — Randomness with constraints

This is where generated scenes usually go wrong. Random *within a rule* looks natural;
random without one looks like noise.

```js
// BAD — uniform noise
for (let i = 0; i < 40; i++) tree(Math.random() * W, Math.random() * H, Math.random() * 40);

// GOOD — clustered, depth-sorted, jittered within a band
function scatter(rnd, { count, bandY, bandH, clumps = 4, sizeAt }) {
  const items = [];
  const centres = Array.from({ length: clumps }, () => rnd() * W);
  for (let i = 0; i < count; i++) {
    const c = centres[Math.floor(rnd() * clumps)];
    const x = c + (rnd() - 0.5) * (W / clumps) * 1.4;      // cluster, then jitter
    const t = rnd();                                        // depth within the band
    const y = bandY + t * bandH;
    items.push({ x, y, scale: sizeAt(t) * (0.82 + rnd() * 0.36), depth: t });
  }
  return items.sort((a, b) => a.depth - b.depth);           // far drawn first
}
```

Non-negotiables for scattering:

- **Seed it.** Use a seeded PRNG (see `procedural-art`) so a scene is stable across
  frames and reloads. A background that reshuffles every frame is unusable.
- **Vary size with depth**, not randomly. Things further up the band are smaller.
- **Cluster, do not spread.** Nature and cities both group.
- **Jitter, do not randomise.** Perturb a regular structure by ±20-40% rather than
  placing from scratch — this is what makes fence posts, windows and streetlights look
  placed rather than spilled.
- **Enforce minimum spacing** so objects do not stack into blobs.
- **Never randomise hue.** Randomise value and position; pick hue from the palette.

## Step 7 — The cheap finishing passes

Applied in this order, these three do more than an hour of detail work:

1. **Vertical sky gradient** — build once, cache it.
2. **Vignette** — radial gradient to `rgba(dark, 0.35)` at the corners. Focuses the eye
   and hides the canvas edge.
3. **Unifying colour wash** — one translucent full-screen rect in the scene's dominant
   hue at 6-12% opacity. This is the trick that makes disparate elements feel like one
   painting, and it takes two lines.

```js
ctx.fillStyle = `hsla(${pal.baseHue}, 60%, 50%, 0.08)`;
ctx.fillRect(0, 0, W, H);
```

Optional: a few slow-drifting particles (dust, snow, embers, leaves) in the scene's
accent hue at low opacity. Motion in the background reads as "alive" more strongly
than any static detail.

## Checklist before calling a scene done

- Squint: is the player unmistakably the focal point?
- Are there 3-4 clear value bands, or is it all one grey mush?
- Does saturation and contrast drop with distance?
- Is the horizon off-centre?
- Is anything evenly spaced that should not be?
- Silhouette test: are the shapes readable in flat black?
- Is the accent hue used in fewer than ~10% of the pixels?
- Is the area immediately around the player quiet?

## Anti-patterns

- Rainbow palettes — every element a different hue. Pick a hue family.
- Uniform saturation across depth; it flattens the entire image.
- Detail spread evenly everywhere. Detail is a spotlight; spending it everywhere
  spends it nowhere.
- Background elements at the same value as gameplay entities.
- Regenerating scenery every frame from unseeded `Math.random()`.
- Pure `#000000` shadows and `#FFFFFF` highlights.
- Centred horizon with symmetrical scenery on both sides.
