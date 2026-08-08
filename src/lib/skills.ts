import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

export interface Skill {
  name: string;
  title: string;
  description: string;
  body: string;
}

const SKILL_DIR = join(process.cwd(), "game-skills");

const cache = globalThis as unknown as { __gsSkills?: Skill[] };

function parse(raw: string, fallbackName: string): Skill {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw);
  const meta: Record<string, string> = {};
  let body = raw;

  if (match) {
    body = raw.slice(match[0].length).trim();
    for (const line of match[1].split(/\r?\n/)) {
      const at = line.indexOf(":");
      if (at === -1) continue;
      meta[line.slice(0, at).trim()] = line.slice(at + 1).trim();
    }
  }

  return {
    name: meta.name || fallbackName,
    title: meta.title || fallbackName,
    description: meta.description || "",
    body,
  };
}

export function allSkills(): Skill[] {
  if (cache.__gsSkills && process.env.NODE_ENV === "production") return cache.__gsSkills;
  if (!existsSync(SKILL_DIR)) return (cache.__gsSkills = []);

  const skills = readdirSync(SKILL_DIR)
    .filter((f) => f.endsWith(".md"))
    .map((f) => parse(readFileSync(join(SKILL_DIR, f), "utf8"), f.replace(/\.md$/, "")))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (cache.__gsSkills = skills);
}

export function getSkill(name: string): Skill | null {
  const wanted = name.trim().toLowerCase();
  return allSkills().find((s) => s.name.toLowerCase() === wanted) ?? null;
}

/** The cheap index that lives in every system prompt; bodies load on demand. */
export function skillIndex(): string {
  return allSkills()
    .map((s) => `- ${s.name} — ${s.description}`)
    .join("\n");
}
