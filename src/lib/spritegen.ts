import { openai } from "./openai";
import { encodePng, pixelize, upscale } from "./pixelize";
import type { FileMap } from "./types";

/**
 * Generates a sprite with an image model, then converts it into the toolkit's
 * authored pixel-grid format.
 *
 * The conversion is the point. Shipping raw generated PNGs would give every game
 * a different rendering style, break the palette, and bloat the files. Reducing
 * to a small grid keeps generated art in exactly the same representation as
 * hand-authored art — palette-limited, editable, tiny, and drawn with bake().
 */

const IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL || "gpt-image-1-mini";

/** Wraps the request in the constraints that survive being reduced to ~24px. */
function imagePrompt(description: string, view: string): string {
  return [
    `A single 2D video game sprite: ${description}.`,
    view === "top-down" ? "Viewed from directly above, top-down." : "Side view, facing right.",
    "Bold simple readable silhouette, thick dark outline, flat cel-shaded colours,",
    "a small number of distinct colour areas, strong contrast between parts.",
    "No gradients, no soft shading, no blur, no drop shadow, no text, no watermark,",
    "no background scenery, no ground, no frame or border.",
    "The subject fills the image, centred, whole body visible, isolated on a fully transparent background.",
  ].join(" ");
}

export interface GeneratedSprite {
  code: string;
  previewPng: Buffer;
  width: number;
  height: number;
  colours: number;
}

/** Pulls the game's existing palette out of config.js so generated art can match it. */
export function paletteFrom(files: FileMap): string[] {
  const config = files["config.js"] ?? "";
  return [...config.matchAll(/#[0-9a-fA-F]{6}\b/g)].map((m) => m[0]);
}

export async function generateSprite(
  description: string,
  {
    width = 24,
    height = 28,
    colours = 5,
    view = "side",
    name = "SPRITE",
    matchPalette = [] as string[],
  } = {}
): Promise<GeneratedSprite> {
  const res = await openai().images.generate({
    model: IMAGE_MODEL,
    prompt: imagePrompt(description, view),
    size: "1024x1024",
    background: "transparent",
    output_format: "png",
    quality: "low", // detail is discarded by the downscale anyway
    n: 1,
  });

  const b64 = res.data?.[0]?.b64_json;
  if (!b64) throw new Error("The image model returned no image.");

  const { sprite, preview } = pixelize(Buffer.from(b64, "base64"), {
    width,
    height,
    colours,
    snapTo: matchPalette,
  });

  const paletteLines = Object.entries(sprite.palette)
    .map(([k, v]) => `  ${k}: "${v}",`)
    .join("\n");

  const code =
    `const ${name}_PAL = {\n  ".": null,\n${paletteLines}\n};\n\n` +
    `const ${name} = [\n${sprite.rows.map((r) => `  "${r}",`).join("\n")}\n];`;

  return {
    code,
    previewPng: encodePng(upscale(preview, 8)),
    width,
    height,
    colours: sprite.colours,
  };
}
