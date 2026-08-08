---
name: character-art
title: Drawing real characters, not coloured rectangles
description: Use whenever the game needs a player character, enemies, NPCs, bosses, items or props, and whenever art looks like placeholder shapes. Covers authoring pixel sprites as inline data, proportions, shading, outlines, and full animation cycles — all without image files.
---

# Drawing real characters

A coloured rectangle is a placeholder, not a character. Ship one and the game
reads as unfinished no matter how good the mechanics are. There are no image
files here, but you can still author genuine sprite art — you just author it as
**data in the source** instead of in an editor.

Pick one of two approaches and commit to it for the whole cast:

- **Pixel sprites** — authored as string arrays, baked to canvases at boot. Best for
  platformers, RPGs, retro anything. Highest quality per effort.
- **Rigged vector characters** — parts drawn with paths and animated by rotation.
  Best for smooth, modern, larger characters.

Never mix the two.

## Approach 1 — pixel sprites as inline data

This is the technique to reach for by default. Author the art as a grid of
characters, map each character to a colour, bake once.

```js
// sprites.js
export const PAL = {
  ".": null,          // transparent
  "o": "#1a1024",     // outline — dark, tinted, never pure black
  "s": "#ffcf9e",     // skin
  "S": "#d9976a",     // skin shadow
  "c": "#4f7fe0",     // cloth
  "C": "#32549c",     // cloth shadow
  "h": "#6b3f2a",     // hair
  "w": "#f4f1ff",     // highlight
};

/** Bakes a string-grid sprite into a canvas once, at any integer scale. */
export function bake(rows, palette = PAL, scale = 1) {
  const w = rows[0].length, h = rows.length;
  const cvs = new OffscreenCanvas(w * scale, h * scale);
  const ctx = cvs.getContext("2d");
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < rows[y].length; x++) {
      const color = palette[rows[y][x]];
      if (!color) continue;
      ctx.fillStyle = color;
      ctx.fillRect(x * scale, y * scale, scale, scale);
    }
  }
  return cvs;
}
```

A 14×16 hero, readable and clearly a person:

```js
export const HERO = {
  idle: [
    "....oooo......",
    "...ohhhho.....",
    "..ohhhhhho....",
    "..ohsssssho...",
    "..ohsoswsso...",
    "..oosssssoo...",
    "...ossssso....",
    "..occcccco....",
    ".occcwccccо...",
    ".ocCcccccCo...",
    ".oco cccc oo..",
    "..o..cccc.....",
    ".....cCCc.....",
    ".....cCCc.....",
    "....occ.cco...",
    "....ooo.ooo...",
  ],
};
```

Rules that make this look drawn rather than generated:

- **Silhouette first.** Block the shape in one colour and check it reads at actual
  size before adding any interior detail. If the silhouette is ambiguous, no amount
  of shading fixes it.
- **Outline in a dark tint of the character's own hue**, never `#000`. Pure black
  outlines flatten the sprite and clash with every background.
- **Selective outlining** — drop the outline where light hits (top edges) and keep it
  on shadowed edges. Instant depth for zero extra pixels.
- **Three values per material, maximum:** base, shadow, highlight. Shadow shifts
  cooler and more saturated; highlight shifts warmer and desaturated. Never just
  darken — that is what makes art look muddy and plastic.
- **One light direction for the entire game.** Top-left is the safe default. Every
  sprite must agree.
- **Readable proportions at small sizes.** At 16px tall, realistic proportions turn
  to mush. Use 2 to 3 heads tall and give the head ~⅓ of the height. The eyes are
  the single most important pixels — place them before anything else.
- **One memorable feature per character.** A scarf, a horn, a visor, a colour. That
  is what people remember and describe.

## Animation — the part that makes it alive

Static sprites read as dead. Every character needs at least idle and move.

```js
export const HERO_FRAMES = {
  idle:  { rows: [IDLE_A, IDLE_B],                       fps: 3,  loop: true },
  walk:  { rows: [WALK_CONTACT, WALK_DOWN, WALK_PASS, WALK_UP], fps: 10, loop: true },
  jump:  { rows: [JUMP_RISE],                            fps: 1,  loop: false },
  fall:  { rows: [JUMP_FALL],                            fps: 1,  loop: false },
  hurt:  { rows: [HURT],                                 fps: 1,  loop: false },
};

export function makeAnimator(frames) {
  let state = "idle", t = 0, i = 0;
  return {
    set(next) { if (next !== state) { state = next; t = 0; i = 0; } },
    update(dt) {
      const a = frames[state];
      t += dt;
      if (t >= 1 / a.fps) {
        t -= 1 / a.fps;
        i = a.loop ? (i + 1) % a.rows.length : Math.min(i + 1, a.rows.length - 1);
      }
    },
    get frame() { return frames[state].baked[i]; },
  };
}
```

The four-frame walk cycle, in order: **contact** (legs apart, body lowest),
**down** (weight settling), **passing** (legs together, body highest), **up**
(pushing off). Get this order right and even four crude frames read as walking.

Frame rates that feel right: idle 2-4 fps, walk 8-12 fps, run 12-16 fps, attack
14-18 fps with a held frame on the strike.

**Cheat with transforms.** Half of good character animation is not new art:

```js
// Breathing idle without a second frame
const bob = Math.round(Math.sin(t * 3) * 1);
// Squash on land, stretch on jump — scale the sprite, never the hitbox
ctx.scale(1 + squash, 1 - squash);
// Lean into movement
ctx.rotate(vx * 0.0006);
// Face by flipping
ctx.scale(facing, 1);
```

Draw at integer coordinates (`Math.round`) or pixel art shimmers as it moves.

## Approach 2 — rigged vector characters

For larger or smoother characters, build the body from parts and animate the
joints. No frames to author, and it scales cleanly.

```js
function drawHero(ctx, x, y, t, state, facing) {
  const swing = state === "walk" ? Math.sin(t * 10) * 0.6 : Math.sin(t * 2) * 0.06;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(facing, 1);

  limb(ctx, 0, -18, swing, 12, C.clothDark);        // back arm — drawn first
  limb(ctx, -2, -6, -swing, 14, C.clothDark);       // back leg

  ctx.fillStyle = C.cloth;                           // torso
  roundRect(ctx, -6, -22, 12, 16, 4); ctx.fill();

  ctx.fillStyle = C.skin;                            // head
  ctx.beginPath(); ctx.arc(0, -28, 6.5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = C.hair;                            // hair mass = the silhouette
  ctx.beginPath(); ctx.arc(0, -30, 6.6, Math.PI, Math.PI * 2); ctx.fill();
  ctx.fillStyle = C.ink;                             // eye
  ctx.fillRect(2, -29, 2, 2);

  limb(ctx, 2, -6, swing, 14, C.cloth);              // front leg
  limb(ctx, 0, -18, -swing, 12, C.skin);             // front arm
  ctx.restore();
}

function limb(ctx, x, y, angle, len, color) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(angle);
  ctx.strokeStyle = color; ctx.lineWidth = 4; ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, len); ctx.stroke();
  ctx.restore();
}
```

Draw order is the whole trick: back limbs, torso, head, front limbs. That single
ordering is what turns flat shapes into a body with depth.

## Designing the cast, not just the hero

- **Shape language separates roles.** Player rounded and warm; enemies angular,
  cold and asymmetric; pickups small, bright and bouncing. A player should be able
  to tell friend from hazard in one frame, with the colour removed.
- **Size communicates threat.** Bigger reads as more dangerous, so do not make a
  weak enemy the largest thing on screen.
- **Enemies need a tell.** A wind-up pose is art as much as it is design — a
  distinct silhouette for the frame before an attack.
- **Bosses** are the same construction at 3-4× scale with more parts, plus a visible
  damage state. Change colour or break pieces off as health drops.

## Bake once, at boot

Never rebuild sprite canvases in the render loop.

```js
for (const anim of Object.values(HERO_FRAMES)) {
  anim.baked = anim.rows.map((rows) => bake(rows, PAL, 3));
}
```

Then rendering is a single `drawImage` per entity — the fast path.

For palette swaps (a red variant of the same enemy), bake the same rows with a
different palette object. One sprite, a whole species, no extra art.

## Checklist

- Silhouette test: fill the sprite flat black — is it still recognisable?
- Is the player the highest-contrast, most-saturated thing on screen?
- Does every character have at least idle and move animations?
- One light direction across the whole cast?
- Outlines tinted, never pure black?
- Do enemies differ from the player in shape, not just colour?
- Drawn at integer coordinates?

## Anti-patterns

- `fillRect` characters shipped as final art.
- A different colour palette per character with no shared family.
- Realistic proportions on a 16px sprite.
- Animating by swapping colours instead of shapes or transforms.
- Rebuilding sprite pixels every frame instead of baking once.
- Symmetrical, featureless designs — nothing to remember.
