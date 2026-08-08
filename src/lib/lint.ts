import { Parser } from "acorn";

const GLOBALS = new Set([
  // language
  "globalThis", "undefined", "NaN", "Infinity", "arguments", "this", "Object", "Array", "String",
  "Number", "Boolean", "Symbol", "BigInt", "Math", "JSON", "Date", "RegExp", "Map", "Set", "WeakMap",
  "WeakSet", "Promise", "Proxy", "Reflect", "Error", "TypeError", "RangeError", "SyntaxError",
  "ReferenceError", "Function", "parseInt", "parseFloat", "isNaN", "isFinite", "encodeURIComponent",
  "decodeURIComponent", "structuredClone", "queueMicrotask",
  // browser
  "window", "document", "console", "performance", "navigator", "location", "history", "screen",
  "requestAnimationFrame", "cancelAnimationFrame", "setTimeout", "clearTimeout", "setInterval",
  "clearInterval", "matchMedia", "getComputedStyle", "devicePixelRatio", "innerWidth", "innerHeight",
  "Image", "Audio", "URL", "Blob", "File", "FileReader", "OffscreenCanvas", "ImageData", "Path2D",
  "AudioContext", "webkitAudioContext", "AudioBuffer", "Event", "CustomEvent", "KeyboardEvent",
  "MouseEvent", "PointerEvent", "TouchEvent", "DOMMatrix", "TextEncoder", "TextDecoder", "fetch",
  "alert", "prompt", "confirm", "postMessage", "addEventListener", "removeEventListener",
  // this runtime
  "GameSave",
]);

/** Every name this module binds, in any scope. Deliberately over-inclusive. */
function collectDeclared(ast: unknown, out: Set<string>) {
  const patternNames = (node: any) => {
    if (!node || typeof node !== "object") return;
    switch (node.type) {
      case "Identifier": out.add(node.name); break;
      case "ObjectPattern": node.properties.forEach((p: any) => patternNames(p.value ?? p.argument)); break;
      case "ArrayPattern": node.elements.forEach((e: any) => e && patternNames(e)); break;
      case "AssignmentPattern": patternNames(node.left); break;
      case "RestElement": patternNames(node.argument); break;
    }
  };

  const visit = (node: any) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach(visit);
    if (typeof node.type !== "string") return;

    switch (node.type) {
      case "ImportDefaultSpecifier":
      case "ImportNamespaceSpecifier":
      case "ImportSpecifier":
        out.add(node.local.name);
        break;
      case "VariableDeclarator": patternNames(node.id); break;
      case "FunctionDeclaration":
      case "FunctionExpression":
      case "ArrowFunctionExpression":
        if (node.id) out.add(node.id.name);
        node.params.forEach(patternNames);
        break;
      case "ClassDeclaration":
      case "ClassExpression":
        if (node.id) out.add(node.id.name);
        break;
      case "CatchClause": if (node.param) patternNames(node.param); break;
    }
    for (const key of Object.keys(node)) if (key !== "type") visit(node[key]);
  };

  visit(ast);
}

/**
 * Catches references to names that are never defined or imported — typos and
 * dangling identifiers left behind by a partial refactor. These are invisible to
 * the parser and only surface as a blank screen at runtime.
 */
export function undefinedNames(content: string): string[] {
  let ast: unknown;
  try {
    ast = Parser.parse(content, { ecmaVersion: "latest", sourceType: "module" });
  } catch {
    return [];
  }

  const declared = new Set<string>();
  collectDeclared(ast, declared);

  const missing = new Set<string>();
  const visit = (node: any, parent: any) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach((n) => visit(n, parent));
    if (typeof node.type !== "string") return;

    if (node.type === "Identifier" && parent) {
      const isMemberProp = parent.type === "MemberExpression" && parent.property === node && !parent.computed;
      const isKey = parent.type === "Property" && parent.key === node && !parent.computed;
      const isLabel = parent.type === "LabeledStatement" || parent.type === "BreakStatement" || parent.type === "ContinueStatement";
      const isExported = parent.type === "ExportSpecifier" || parent.type === "ImportSpecifier";
      const isMethod = parent.type === "MethodDefinition" || parent.type === "PropertyDefinition";
      if (!isMemberProp && !isKey && !isLabel && !isExported && !isMethod) {
        if (!declared.has(node.name) && !GLOBALS.has(node.name)) missing.add(node.name);
      }
    }
    for (const key of Object.keys(node)) if (key !== "type") visit(node[key], node);
  };
  visit(ast, null);

  return [...missing].slice(0, 6);
}

const undefinedRefs = (path: string, content: string): string[] =>
  /\.(js|mjs)$/i.test(path)
    ? undefinedNames(content).map((n) => `${path} uses "${n}" but it is never defined or imported — this will throw at runtime.`)
    : [];


/* ------------------------------------------------------- sprite quality -- */

interface Grid {
  rows: number;
  cols: number;
  ink: number;
}

/** Array-of-equal-length-strings over a small character set: a pixel grid. */
function findGrids(ast: unknown): Grid[] {
  const grids: Grid[] = [];
  const visit = (node: any) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach(visit);
    if (typeof node.type !== "string") return;

    if (node.type === "ArrayExpression" && node.elements.length >= 6) {
      const strings = node.elements.filter(
        (e: any) => e && e.type === "Literal" && typeof e.value === "string"
      );
      if (strings.length === node.elements.length) {
        const values: string[] = strings.map((e: any) => e.value);
        const width = values[0].length;
        const uniform = values.every((v) => v.length === width);
        const chars = new Set(values.join(""));
        if (uniform && width >= 6 && chars.size <= 14) {
          const ink = [...chars].filter((c) => c !== "." && c !== " " && c !== "0").length;
          grids.push({ rows: values.length, cols: width, ink });
        }
      }
    }
    for (const key of Object.keys(node)) if (key !== "type") visit(node[key]);
  };
  visit(ast);
  return grids;
}

/**
 * Measures authored sprite data so "the character looks fake" becomes a concrete,
 * checkable complaint rather than a matter of taste. A 6x6 two-colour blob reads
 * as a blob no matter what the prompt asked for.
 */
export function spriteIssues(path: string, content: string): string[] {
  if (!/\.(js|mjs)$/i.test(path)) return [];

  // The toolkit's sprites.js *defines* bake(); it holds no sprite data by design.
  // Only files that actually author or bake sprites are held to this standard.
  if (/\bexport\s+function\s+bake\s*\(/.test(content)) return [];
  if (!/\bbake\s*\(/.test(content)) return [];

  let ast: unknown;
  try {
    ast = Parser.parse(content, { ecmaVersion: "latest", sourceType: "module" });
  } catch {
    return [];
  }

  const grids = findGrids(ast);
  const problems: string[] = [];

  if (grids.length === 0) {
    return [
      `${path} defines no pixel-grid sprite data. Characters must be authored as arrays of row strings and baked once (see the character-art skill) — shapes drawn with fillRect and arc read as placeholder art.`,
    ];
  }

  // The biggest grid is the hero; it carries the game's visual quality.
  const hero = grids.reduce((a, b) => (a.rows * a.cols >= b.rows * b.cols ? a : b));
  if (hero.rows < 10 || hero.cols < 8) {
    problems.push(
      `${path}: the largest sprite is only ${hero.cols}x${hero.rows}. That is too coarse to read as a character — use at least 12x14 so it has a head, a body and legs.`
    );
  }
  if (hero.ink < 4) {
    problems.push(
      `${path}: the main sprite uses only ${hero.ink} colour${hero.ink === 1 ? "" : "s"}. It needs at least four — an outline, a base, a shadow and a highlight or accent — or it renders as a flat blob.`
    );
  }
  const tiny = grids.filter((g) => g.rows < 6 || g.ink < 2).length;
  if (tiny) {
    problems.push(`${path}: ${tiny} sprite${tiny === 1 ? " is" : "s are"} too small or single-coloured to read.`);
  }
  if (grids.length < 2) {
    problems.push(
      `${path} has a single sprite frame. Animation is what makes a character look alive — add at least a two-frame idle and a three or four frame walk cycle.`
    );
  }

  return problems;
}

/** True when a file contains authored pixel-grid sprite data. */
export function hasSpriteGrids(content: string): boolean {
  try {
    const ast = Parser.parse(content, { ecmaVersion: "latest", sourceType: "module" });
    return findGrids(ast).length > 0;
  } catch {
    return false;
  }
}
