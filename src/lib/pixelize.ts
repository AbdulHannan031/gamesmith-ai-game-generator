import { deflateSync, inflateSync } from "node:zlib";

/**
 * Turns a generated PNG into the toolkit's authored-sprite format: a small
 * palette and a grid of row strings.
 *
 * Keeping generated art in the same representation as hand-authored art is what
 * stops a game looking like it came from five different artists — the result is
 * palette-limited, tiny, editable by hand, and works with the existing bake().
 * Pure Node, no image dependencies.
 */

export interface Bitmap {
  width: number;
  height: number;
  /** RGBA, 4 bytes per pixel. */
  data: Uint8Array;
}

export interface PixelSprite {
  rows: string[];
  palette: Record<string, string>;
  colours: number;
}

/* ----------------------------------------------------------------- decode -- */

const PNG_MAGIC = [137, 80, 78, 71, 13, 10, 26, 10];

export function decodePng(buf: Buffer): Bitmap {
  for (let i = 0; i < 8; i++) {
    if (buf[i] !== PNG_MAGIC[i]) throw new Error("Not a PNG.");
  }

  let pos = 8;
  let width = 0, height = 0, bitDepth = 0, colorType = 0, interlace = 0;
  const idat: Buffer[] = [];
  let palette: Buffer | null = null;
  let trns: Buffer | null = null;

  while (pos < buf.length) {
    const length = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    const body = buf.subarray(pos + 8, pos + 8 + length);
    pos += 12 + length;

    if (type === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      bitDepth = body[8];
      colorType = body[9];
      interlace = body[12];
    } else if (type === "PLTE") palette = Buffer.from(body);
    else if (type === "tRNS") trns = Buffer.from(body);
    else if (type === "IDAT") idat.push(Buffer.from(body));
    else if (type === "IEND") break;
  }

  if (bitDepth !== 8) throw new Error(`Unsupported PNG bit depth ${bitDepth}.`);
  if (interlace !== 0) throw new Error("Interlaced PNGs are not supported.");

  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new Error(`Unsupported PNG colour type ${colorType}.`);

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = new Uint8Array(width * height * 4);
  const line = new Uint8Array(stride);
  const prev = new Uint8Array(stride);

  let src = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[src++];
    for (let i = 0; i < stride; i++) {
      const x = raw[src + i];
      const a = i >= channels ? line[i - channels] : 0;
      const b = prev[i];
      const c = i >= channels ? prev[i - channels] : 0;
      let value: number;
      switch (filter) {
        case 0: value = x; break;
        case 1: value = x + a; break;
        case 2: value = x + b; break;
        case 3: value = x + ((a + b) >> 1); break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          value = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default: throw new Error(`Unknown PNG filter ${filter}.`);
      }
      line[i] = value & 0xff;
    }
    src += stride;

    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      const i = x * channels;
      if (colorType === 6) {
        out[o] = line[i]; out[o + 1] = line[i + 1]; out[o + 2] = line[i + 2]; out[o + 3] = line[i + 3];
      } else if (colorType === 2) {
        out[o] = line[i]; out[o + 1] = line[i + 1]; out[o + 2] = line[i + 2]; out[o + 3] = 255;
      } else if (colorType === 0) {
        out[o] = out[o + 1] = out[o + 2] = line[i]; out[o + 3] = 255;
      } else if (colorType === 4) {
        out[o] = out[o + 1] = out[o + 2] = line[i]; out[o + 3] = line[i + 1];
      } else if (colorType === 3 && palette) {
        const p = line[i] * 3;
        out[o] = palette[p]; out[o + 1] = palette[p + 1]; out[o + 2] = palette[p + 2];
        out[o + 3] = trns && line[i] < trns.length ? trns[line[i]] : 255;
      }
    }
    prev.set(line);
  }

  return { width, height, data: out };
}

/* ----------------------------------------------------------------- encode -- */

function crc32(buf: Buffer): number {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type: string, body: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(body.length);
  const typed = Buffer.concat([Buffer.from(type, "ascii"), body]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([len, typed, crc]);
}

/** Minimal RGBA PNG encoder, so a quantised sprite can be shown back as an image. */
export function encodePng({ width, height, data }: Bitmap): Buffer {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(data.buffer, data.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from(PNG_MAGIC),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/* ------------------------------------------------------------- processing -- */

/** Bounding box of pixels above the alpha threshold, so the sprite fills its grid. */
function contentBox(bm: Bitmap, alphaMin = 24) {
  let minX = bm.width, minY = bm.height, maxX = -1, maxY = -1;
  for (let y = 0; y < bm.height; y++) {
    for (let x = 0; x < bm.width; x++) {
      if (bm.data[(y * bm.width + x) * 4 + 3] >= alphaMin) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return { x: 0, y: 0, w: bm.width, h: bm.height };
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/** Box-filter downscale, weighting colour by alpha so edges do not go muddy. */
function resample(bm: Bitmap, box: { x: number; y: number; w: number; h: number }, tw: number, th: number): Bitmap {
  const out = new Uint8Array(tw * th * 4);
  for (let ty = 0; ty < th; ty++) {
    for (let tx = 0; tx < tw; tx++) {
      const sx0 = box.x + Math.floor((tx * box.w) / tw);
      const sx1 = box.x + Math.max(sx0 + 1, Math.floor(((tx + 1) * box.w) / tw));
      const sy0 = box.y + Math.floor((ty * box.h) / th);
      const sy1 = box.y + Math.max(sy0 + 1, Math.floor(((ty + 1) * box.h) / th));

      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let sy = sy0; sy < sy1 && sy < bm.height; sy++) {
        for (let sx = sx0; sx < sx1 && sx < bm.width; sx++) {
          const o = (sy * bm.width + sx) * 4;
          const al = bm.data[o + 3] / 255;
          r += bm.data[o] * al; g += bm.data[o + 1] * al; b += bm.data[o + 2] * al;
          a += bm.data[o + 3];
          n++;
        }
      }
      const o = (ty * tw + tx) * 4;
      const alphaSum = a / 255;
      if (n && alphaSum > 0) {
        out[o] = Math.round(r / alphaSum);
        out[o + 1] = Math.round(g / alphaSum);
        out[o + 2] = Math.round(b / alphaSum);
        out[o + 3] = Math.round(a / n);
      }
    }
  }
  return { width: tw, height: th, data: out };
}

const dist = (a: number[], b: number[]) =>
  (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

/** k-means over the opaque pixels — few enough that a handful of passes converges. */
function quantise(bm: Bitmap, k: number, alphaMin: number): { centres: number[][]; index: Int16Array } {
  const pixels: number[][] = [];
  const map = new Int16Array(bm.width * bm.height).fill(-1);
  for (let i = 0; i < bm.width * bm.height; i++) {
    if (bm.data[i * 4 + 3] >= alphaMin) pixels.push([bm.data[i * 4], bm.data[i * 4 + 1], bm.data[i * 4 + 2], i]);
  }
  if (!pixels.length) return { centres: [], index: map };

  // Seed spread out across the pixels rather than randomly, for stable output.
  const centres: number[][] = [];
  const sorted = [...pixels].sort((p, q) => p[0] + p[1] + p[2] - (q[0] + q[1] + q[2]));
  for (let i = 0; i < k; i++) {
    const p = sorted[Math.min(sorted.length - 1, Math.floor((i / Math.max(1, k - 1)) * (sorted.length - 1)))];
    centres.push([p[0], p[1], p[2]]);
  }

  for (let pass = 0; pass < 12; pass++) {
    const sums = centres.map(() => [0, 0, 0, 0]);
    for (const p of pixels) {
      let best = 0, bestD = Infinity;
      for (let c = 0; c < centres.length; c++) {
        const d = dist(p, centres[c]);
        if (d < bestD) { bestD = d; best = c; }
      }
      sums[best][0] += p[0]; sums[best][1] += p[1]; sums[best][2] += p[2]; sums[best][3]++;
    }
    for (let c = 0; c < centres.length; c++) {
      if (!sums[c][3]) continue;
      centres[c] = [
        Math.round(sums[c][0] / sums[c][3]),
        Math.round(sums[c][1] / sums[c][3]),
        Math.round(sums[c][2] / sums[c][3]),
      ];
    }
  }

  for (const p of pixels) {
    let best = 0, bestD = Infinity;
    for (let c = 0; c < centres.length; c++) {
      const d = dist(p, centres[c]);
      if (d < bestD) { bestD = d; best = c; }
    }
    map[p[3]] = best;
  }
  return { centres, index: map };
}

const hex = (c: number[]) => "#" + c.map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0")).join("");
const CHARS = "abcdefghijklmnopqrstuvwxyz";

/**
 * Replaces the outer ring of opaque pixels with a dark tint of the sprite's own
 * darkest colour. A silhouette outline is what makes a 24px character read
 * against any background — without it, generated art turns to mush at game size.
 * Tinted rather than black, because pure black flattens everything it touches.
 */
function applyOutline(
  rows: string[],
  palette: Record<string, string>,
  preview: Uint8Array,
  width: number,
  height: number,
  colours: number[][]
) {
  if (!colours.length) return;

  const darkest = colours.reduce((a, b) => (a[0] + a[1] + a[2] <= b[0] + b[1] + b[2] ? a : b));
  const ink = [
    Math.round(darkest[0] * 0.45),
    Math.round(darkest[1] * 0.42),
    Math.round(darkest[2] * 0.55), // keep a touch more blue: shadows read cooler
  ];
  palette.o = hex(ink);

  const grid = rows.map((r) => r.split(""));
  const opaque = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < width && y < height && grid[y][x] !== ".";

  const edges: [number, number][] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (grid[y][x] === ".") continue;
      if (!opaque(x - 1, y) || !opaque(x + 1, y) || !opaque(x, y - 1) || !opaque(x, y + 1)) {
        edges.push([x, y]);
      }
    }
  }

  for (const [x, y] of edges) {
    grid[y][x] = "o";
    const o = (y * width + x) * 4;
    preview[o] = ink[0]; preview[o + 1] = ink[1]; preview[o + 2] = ink[2]; preview[o + 3] = 255;
  }

  for (let y = 0; y < height; y++) rows[y] = grid[y].join("");
}

/**
 * Full pipeline: crop to content, downscale to the sprite grid, quantise to a
 * small palette, and emit rows. Optionally snap to an existing game palette so
 * generated art matches what is already on screen.
 */
export function pixelize(
  png: Buffer,
  { width = 24, height = 28, colours = 6, alphaMin = 100, snapTo = [] as string[], outline = true } = {}
): { sprite: PixelSprite; preview: Bitmap } {
  const source = decodePng(png);
  const box = contentBox(source);
  const small = resample(source, box, width, height);
  const { centres, index } = quantise(small, colours, alphaMin);

  const targets = snapTo
    .map((h) => h.replace("#", ""))
    .filter((h) => /^[0-9a-f]{6}$/i.test(h))
    .map((h) => [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]);

  const finalColours = centres.map((c) => {
    if (!targets.length) return c;
    let best = targets[0], bestD = Infinity;
    for (const t of targets) {
      const d = dist(c, t);
      if (d < bestD) { bestD = d; best = t; }
    }
    return best;
  });

  const palette: Record<string, string> = { ".": "" };
  finalColours.forEach((c, i) => (palette[CHARS[i]] = hex(c)));

  const rows: string[] = [];
  const preview = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    let row = "";
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const c = index[i];
      row += c < 0 ? "." : CHARS[c];
      if (c >= 0) {
        const o = i * 4;
        preview[o] = finalColours[c][0];
        preview[o + 1] = finalColours[c][1];
        preview[o + 2] = finalColours[c][2];
        preview[o + 3] = 255;
      }
    }
    rows.push(row);
  }

  if (outline) applyOutline(rows, palette, preview, width, height, finalColours);

  const used = new Set(rows.join("").split("").filter((c) => c !== "."));
  for (const key of Object.keys(palette)) if (key !== "." && !used.has(key)) delete palette[key];
  delete palette["."];

  return { sprite: { rows, palette, colours: used.size }, preview: { width, height, data: preview } };
}

/** Scales a bitmap up with nearest-neighbour, so a 24px sprite is legible in a screenshot. */
export function upscale(bm: Bitmap, factor: number): Bitmap {
  const w = bm.width * factor, h = bm.height * factor;
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = (Math.floor(y / factor) * bm.width + Math.floor(x / factor)) * 4;
      const o = (y * w + x) * 4;
      out[o] = bm.data[s]; out[o + 1] = bm.data[s + 1];
      out[o + 2] = bm.data[s + 2]; out[o + 3] = bm.data[s + 3];
    }
  }
  return { width: w, height: h, data: out };
}
