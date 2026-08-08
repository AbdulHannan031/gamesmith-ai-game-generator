"use client";

import { useEffect, useRef, useState } from "react";
import type { Segment, TranscriptItem } from "@/lib/transcript";
import { TOOL_VERB } from "@/lib/transcript";
import { IconCamera, IconFile, IconSend, IconSpark, IconStop, IconWarn } from "./icons";

const MAX_SHOTS = 4;
const MAX_EDGE = 1200;

/** Shrinks a pasted screenshot before upload — a 4K grab is mostly wasted tokens. */
function toDataUrl(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext("2d")?.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/webp", 0.85));
      };
      img.onerror = () => resolve(null);
      img.src = String(reader.result);
    };
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

interface Props {
  items: TranscriptItem[];
  streaming: boolean;
  status: string | null;
  errorCount: number;
  onSend: (text: string, attachErrors: boolean, images: string[]) => void;
  onStop: () => void;
  /** Grabs the current preview frame so a problem can be shown, not described. */
  onCaptureFrame: () => Promise<string | null>;
}

/** Minimal inline markdown — bold, code, and dash lists. Nothing else is worth it. */
function Rich({ text }: { text: string }) {
  const blocks = text.trim().split(/\n{2,}/);
  return (
    <>
      {blocks.map((block, bi) => {
        const lines = block.split("\n");
        const isList = lines.every((l) => /^\s*[-*]\s+/.test(l)) && lines.length > 0;
        if (isList) {
          return (
            <ul key={bi}>
              {lines.map((l, li) => (
                <li key={li}>{inline(l.replace(/^\s*[-*]\s+/, ""))}</li>
              ))}
            </ul>
          );
        }
        return <p key={bi}>{inline(block)}</p>;
      })}
    </>
  );
}

function inline(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const token = m[0];
    if (token.startsWith("**")) parts.push(<strong key={key++}>{token.slice(2, -2)}</strong>);
    else parts.push(<code key={key++}>{token.slice(1, -1)}</code>);
    last = m.index + token.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

function ToolChip({ segment }: { segment: Extract<Segment, { type: "tool" }> }) {
  const { trace } = segment;
  const verb = TOOL_VERB[trace.name] ?? trace.name;
  return (
    <div className="flex items-start gap-2 py-[3px] text-[0.75rem]">
      <span
        className={`mt-[7px] h-1 w-1 shrink-0 rounded-full ${trace.ok ? "bg-line-bright" : "bg-danger"}`}
        aria-hidden
      />
      <span className={trace.ok ? "text-dim" : "text-danger"}>
        <span className="text-muted">{verb}</span>
        {trace.summary ? <span className="u-num ml-1.5">{trace.summary}</span> : null}
      </span>
    </div>
  );
}

export function ChatRail({ items, streaming, status, errorCount, onSend, onStop, onCaptureFrame }: Props) {
  const [draft, setDraft] = useState("");
  const [attach, setAttach] = useState(true);
  const [shots, setShots] = useState<string[]>([]);
  const [grabbing, setGrabbing] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);

  // Follow the stream unless the reader has scrolled up to look at something.
  useEffect(() => {
    const el = scroller.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [items, status]);

  function submit(e?: React.FormEvent) {
    e?.preventDefault();
    const text = draft.trim();
    if ((!text && !shots.length) || streaming) return;
    onSend(text || "Look at the attached screenshot and fix what it shows.", attach && errorCount > 0, shots);
    setDraft("");
    setShots([]);
  }

  async function addFiles(files: FileList | File[]) {
    const picked = [...files].filter((f) => f.type.startsWith("image/")).slice(0, MAX_SHOTS);
    const urls = (await Promise.all(picked.map(toDataUrl))).filter(Boolean) as string[];
    if (urls.length) setShots((prev) => [...prev, ...urls].slice(0, MAX_SHOTS));
  }

  async function grabFrame() {
    setGrabbing(true);
    const shot = await onCaptureFrame();
    if (shot) setShots((prev) => [...prev, shot].slice(0, MAX_SHOTS));
    setGrabbing(false);
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        className="min-h-0 flex-1 overflow-y-auto px-4 py-4"
      >
        {items.length === 0 ? (
          <div className="mt-6 text-center">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-line bg-surface-2 text-amber">
              <IconSpark className="h-4 w-4" />
            </span>
            <p className="mt-3 text-sm text-muted">Tell it what to build.</p>
            <p className="mx-auto mt-1.5 max-w-[30ch] text-[0.8125rem] leading-relaxed text-dim">
              The template is already playable. Try “turn this into a platformer with wall jumps”.
            </p>
          </div>
        ) : null}

        <div className="space-y-5">
          {items.map((item) => {
            if (item.role === "note") {
              return (
                <p key={item.id} className="u-label !text-dim text-center">
                  {item.segments[0]?.type === "text" ? item.segments[0].text : ""}
                </p>
              );
            }

            if (item.role === "user") {
              return (
                <div key={item.id} className={item.faded ? "opacity-45" : ""}>
                  <div className="ml-auto max-w-[92%] rounded-xl rounded-br-sm border border-line bg-surface-2 px-3 py-2 text-[0.875rem] leading-relaxed">
                    {item.segments.map((s, i) =>
                      s.type === "text" ? (
                        <span key={i} className="whitespace-pre-wrap">
                          {s.text}
                        </span>
                      ) : (
                        <span key={i} className="mt-1.5 flex items-center gap-1.5 text-[0.6875rem] text-dim">
                          <IconWarn className="h-3 w-3" />
                          {s.trace.summary}
                        </span>
                      )
                    )}
                  </div>
                </div>
              );
            }

            return (
              <div key={item.id} className={item.faded ? "opacity-45" : ""}>
                {item.segments.map((s, i) =>
                  s.type === "text" ? (
                    <div key={i} className="reply">
                      <Rich text={s.text} />
                    </div>
                  ) : (
                    <ToolChip key={i} segment={s} />
                  )
                )}
              </div>
            );
          })}

          {streaming ? (
            <p className="u-label !text-amber flex items-center gap-2">
              <span className="pulse-live !bg-amber" />
              {status ?? "Working"}
            </p>
          ) : null}
        </div>
      </div>

      <form onSubmit={submit} className="border-t border-line p-3">
        {errorCount > 0 ? (
          <label className="mb-2 flex cursor-pointer items-center gap-2 text-[0.75rem] text-muted">
            <input
              type="checkbox"
              checked={attach}
              onChange={(e) => setAttach(e.target.checked)}
              className="accent-amber"
            />
            <IconWarn className="h-3 w-3 text-danger" />
            Send the {errorCount} runtime {errorCount === 1 ? "error" : "errors"} with this message
          </label>
        ) : null}

        {shots.length > 0 ? (
          <div className="mb-2 flex flex-wrap gap-2">
            {shots.map((src, i) => (
              <div key={i} className="group relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={src}
                  alt={`Attachment ${i + 1}`}
                  className="h-14 w-20 rounded-md border border-line object-cover"
                />
                <button
                  type="button"
                  onClick={() => setShots((prev) => prev.filter((_, n) => n !== i))}
                  className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-line bg-surface-2 text-[11px] text-muted hover:text-danger"
                  aria-label={`Remove attachment ${i + 1}`}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        ) : null}

        <div className="relative">
          <textarea
            value={draft}
            onPaste={(e) => {
              const files = [...e.clipboardData.files];
              if (files.length) {
                e.preventDefault();
                void addFiles(files);
              }
            }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              if (e.dataTransfer.files.length) {
                e.preventDefault();
                void addFiles(e.dataTransfer.files);
              }
            }}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) submit(e as unknown as React.FormEvent);
            }}
            rows={3}
            placeholder="Describe a change, or paste a screenshot…"
            className="field resize-none pr-12 text-[0.875rem]"
            disabled={streaming}
          />
          <div className="absolute bottom-2 left-2 flex items-center gap-1">
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files) void addFiles(e.target.files);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              className="btn btn-ghost btn-sm !h-7 !px-1.5"
              title="Attach an image"
              aria-label="Attach an image"
              disabled={streaming || shots.length >= MAX_SHOTS}
            >
              <IconFile className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={grabFrame}
              className="btn btn-ghost btn-sm !h-7 !px-1.5"
              title="Attach the current preview frame"
              aria-label="Attach the current preview frame"
              disabled={streaming || grabbing || shots.length >= MAX_SHOTS}
            >
              <IconCamera className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="absolute bottom-2 right-2">
            {streaming ? (
              <button type="button" onClick={onStop} className="btn btn-sm !h-8 !px-2.5" aria-label="Stop">
                <IconStop className="h-3 w-3" />
              </button>
            ) : (
              <button
                type="submit"
                className="btn btn-primary btn-sm !h-8 !px-2.5"
                disabled={!draft.trim() && !shots.length}
                aria-label="Send"
              >
                <IconSend className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
        <p className="mt-1.5 text-[0.6875rem] text-dim">Enter to send · Shift+Enter for a new line · paste or drop an image to show a problem</p>
      </form>
    </div>
  );
}
