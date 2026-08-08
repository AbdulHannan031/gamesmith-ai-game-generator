/**
 * Cheap token accounting. We never need exactness here — only enough accuracy to
 * decide when to compact, well before any real context limit is in sight.
 * Real numbers come back from the API and are what we bill and display.
 */

/** ~4 chars per token for English + code, with a floor for structural overhead. */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

export function estimateMessageTokens(m: {
  content?: string | null;
  tool_calls?: string | null;
}): number {
  return estimateTokens(m.content ?? "") + estimateTokens(m.tool_calls ?? "") + 6;
}

/** Above this many estimated context tokens, fold old turns into a summary. */
export const COMPACT_AT = Number(process.env.COMPACT_AT ?? 48_000);

/** Recent turns always kept verbatim, even during compaction. */
export const KEEP_RECENT_TOKENS = Number(process.env.KEEP_RECENT_TOKENS ?? 14_000);

/** A single tool result never gets to dominate the window. */
export const MAX_TOOL_RESULT_CHARS = 24_000;

export function truncate(text: string, max = MAX_TOOL_RESULT_CHARS): string {
  if (text.length <= max) return text;
  const head = text.slice(0, Math.floor(max * 0.7));
  const tail = text.slice(-Math.floor(max * 0.2));
  const cut = text.length - head.length - tail.length;
  return `${head}\n\n… [${cut.toLocaleString()} characters truncated — read a specific line range to see this region] …\n\n${tail}`;
}

/** Rough USD, for the editor's cost readout. Per 1M tokens. */
const PRICES: Record<string, { in: number; cached: number; out: number }> = {
  "gpt-5.1": { in: 1.25, cached: 0.125, out: 10.0 },
  "gpt-4.1-mini": { in: 0.4, cached: 0.1, out: 1.6 },
  "gpt-4.1-nano": { in: 0.1, cached: 0.025, out: 0.4 },
  "gpt-4o-mini": { in: 0.15, cached: 0.075, out: 0.6 },
  "gpt-4.1": { in: 2.0, cached: 0.5, out: 8.0 },
};

export function estimateCost(model: string, prompt: number, output: number, cached = 0): number {
  const p = PRICES[model] ?? PRICES["gpt-4.1-mini"];
  const fresh = Math.max(0, prompt - cached);
  return (fresh * p.in + cached * p.cached + output * p.out) / 1_000_000;
}

export const MODEL_CHOICES = [
  { id: "gpt-5.1", label: "GPT-5.1", note: "Best games by a wide margin. Slower, ~8x the cost." },
  { id: "gpt-4.1", label: "4.1", note: "Strong. Good middle ground." },
  { id: "gpt-4.1-mini", label: "4.1 mini", note: "Cheap and quick. Fine for tweaks." },
  { id: "gpt-4o-mini", label: "4o mini", note: "Cheapest. Weakest at multi-file edits." },
] as const;

/**
 * GPT-5 models reason before answering and reject the sampling knobs the 4.x
 * models expect; everything else takes a low temperature instead.
 */
export function modelParams(model: string): Record<string, unknown> {
  if (/^gpt-5/.test(model)) {
    return { reasoning_effort: process.env.OPENAI_REASONING || "medium" };
  }
  return { temperature: 0.4 };
}
