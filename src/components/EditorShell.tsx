"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { GameFrame, type GameFrameHandle, type LogEntry } from "./GameFrame";
import { ChatRail } from "./ChatRail";
import { FilesPanel } from "./FilesPanel";
import { Wordmark } from "./Wordmark";
import { IconCamera, IconChevron, IconGlobe, IconRestart, IconWarn } from "./icons";
import type { Segment, TranscriptItem } from "@/lib/transcript";
import type { FileMap, Game, StreamEvent } from "@/lib/types";
import { estimateCost, MODEL_CHOICES } from "@/lib/tokens";

interface Props {
  game: Game;
  initialFiles: FileMap;
  initialItems: TranscriptItem[];
  initialContextTokens: number;
}

let liveId = 0;

export function EditorShell({ game, initialFiles, initialItems, initialContextTokens }: Props) {
  const router = useRouter();
  const search = useSearchParams();
  const frame = useRef<GameFrameHandle>(null);
  const abort = useRef<AbortController | null>(null);

  const [items, setItems] = useState<TranscriptItem[]>(initialItems);
  const [files, setFiles] = useState(initialFiles);
  const [revision, setRevision] = useState(0);
  const [streaming, setStreaming] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [logsOpen, setLogsOpen] = useState(false);
  const [tab, setTab] = useState<"play" | "code">("play");
  const [running, setRunning] = useState<"loading" | "running">("loading");

  const [title, setTitle] = useState(game.title);
  const [tagline, setTagline] = useState(game.tagline);
  const [visibility, setVisibility] = useState(game.visibility);
  const [model, setModel] = useState(game.model);
  const [publishing, setPublishing] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);

  const [usage, setUsage] = useState({
    prompt: game.prompt_tokens,
    output: game.output_tokens,
    cached: game.cached_tokens,
    context: initialContextTokens,
  });

  const errors = logs.filter((l) => l.level === "error");

  const onLog = useCallback((entry: LogEntry) => {
    setLogs((prev) => [...prev.slice(-199), entry]);
  }, []);

  /* ------------------------------------------------------------ streaming -- */

  const send = useCallback(
    async (text: string, attachErrors: boolean, images: string[] = []) => {
      if (streaming) return;

      const diagnostics = attachErrors
        ? errors
            .slice(-8)
            .map((e) => `${e.text}${e.stack ? `\n${e.stack}` : ""}`)
            .join("\n\n")
        : undefined;

      const userItem: TranscriptItem = {
        id: `u-${++liveId}`,
        role: "user",
        segments: [
          { type: "text", text },
          ...(images.length
            ? [{ type: "tool" as const, trace: { id: "img", name: "attached", summary: `${images.length} screenshot${images.length === 1 ? "" : "s"}`, ok: true } }]
            : []),
          ...(diagnostics
            ? [{ type: "tool" as const, trace: { id: "d", name: "attached", summary: `${errors.length} runtime errors`, ok: true } }]
            : []),
        ],
      };
      const liveKey = `a-${++liveId}`;
      setItems((prev) => [...prev, userItem, { id: liveKey, role: "assistant", segments: [] }]);
      setStreaming(true);
      setStatus(null);
      setBanner(null);

      const controller = new AbortController();
      abort.current = controller;

      const pushSegment = (fn: (segments: Segment[]) => Segment[]) =>
        setItems((prev) =>
          prev.map((item) => (item.id === liveKey ? { ...item, segments: fn(item.segments) } : item))
        );

      try {
        const res = await fetch(`/api/games/${game.id}/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: text, diagnostics, images }),
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          const body = await res.json().catch(() => ({ error: "The assistant is unreachable." }));
          throw new Error(body.error ?? "The assistant is unreachable.");
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const chunks = buffer.split("\n\n");
          buffer = chunks.pop() ?? "";

          for (const chunk of chunks) {
            const line = chunk.split("\n").find((l) => l.startsWith("data: "));
            if (!line) continue;

            let event: StreamEvent;
            try {
              event = JSON.parse(line.slice(6));
            } catch {
              continue;
            }

            switch (event.type) {
              case "text":
                pushSegment((segs) => {
                  const last = segs[segs.length - 1];
                  if (last?.type === "text") {
                    return [...segs.slice(0, -1), { type: "text", text: last.text + event.delta }];
                  }
                  return [...segs, { type: "text", text: event.delta }];
                });
                break;

              case "tool":
                pushSegment((segs) => [...segs, { type: "tool", trace: event.trace }]);
                setStatus(null);
                break;

              case "files":
                setFiles(event.files);
                setRevision((r) => r + 1);
                setLogs([]);
                break;

              case "title":
                setTitle(event.title);
                setTagline(event.tagline);
                break;

              case "status":
                setStatus(event.text);
                break;

              case "compacted":
                setItems((prev) => {
                  const at = prev.findIndex((i) => i.id === liveKey);
                  const note: TranscriptItem = {
                    id: `n-${++liveId}`,
                    role: "note",
                    segments: [
                      { type: "text", text: `Compacted ${event.removed} earlier messages into a summary.` },
                    ],
                  };
                  return [...prev.slice(0, at), note, ...prev.slice(at)];
                });
                break;

              case "usage":
                setUsage((u) => ({
                  prompt: u.prompt + event.prompt,
                  output: u.output + event.output,
                  cached: u.cached + event.cached,
                  context: event.contextTokens,
                }));
                break;

              case "error":
                setBanner(event.message);
                break;

              case "done":
                break;
            }
          }
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          setBanner(err instanceof Error ? err.message : "Something went wrong.");
        }
      } finally {
        setStreaming(false);
        setStatus(null);
        abort.current = null;
        // Drop the placeholder if the model produced nothing at all.
        setItems((prev) => prev.filter((i) => i.id !== liveKey || i.segments.length > 0));
        router.refresh();
      }
    },
    [streaming, errors, game.id, router]
  );

  /* --------------------------------------------------- first-run auto send -- */

  const idea = search.get("idea");
  const autoSent = useRef(false);
  useEffect(() => {
    if (idea && !autoSent.current && items.length === 0) {
      autoSent.current = true;
      window.history.replaceState(null, "", `/editor/${game.id}`);
      void send(idea, false);
    }
  }, [idea, items.length, send, game.id]);

  /* -------------------------------------------------------- thumbnail sync -- */

  useEffect(() => {
    if (running !== "running") return;
    const timer = setTimeout(async () => {
      const shot = await frame.current?.screenshot();
      if (!shot) return;
      void fetch(`/api/games/${game.id}/thumbnail`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dataUrl: shot }),
      }).catch(() => {});
    }, 4000);
    return () => clearTimeout(timer);
  }, [running, revision, game.id]);

  /* -------------------------------------------------------------- actions -- */

  async function saveTitle(next: string) {
    const clean = next.trim();
    if (!clean || clean === title) return;
    setTitle(clean);
    await fetch(`/api/games/${game.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: clean }),
    });
    router.refresh();
  }

  async function changeModel(next: string) {
    setModel(next);
    await fetch(`/api/games/${game.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: next }),
    });
  }

  async function togglePublish() {
    setPublishing(true);
    setBanner(null);
    try {
      const res = await fetch(`/api/games/${game.id}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ publish: visibility !== "public" }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Could not publish.");
      setVisibility(body.game.visibility);
      router.refresh();
    } catch (err) {
      setBanner(err instanceof Error ? err.message : "Could not publish.");
    } finally {
      setPublishing(false);
    }
  }

  const cost = estimateCost(model, usage.prompt, usage.output, usage.cached);

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      {/* ------------------------------------------------------- top bar -- */}
      <header className="flex h-13 shrink-0 items-center gap-3 border-b border-line px-3 py-2.5">
        <Link href="/dashboard" className="btn btn-ghost btn-sm !px-2" aria-label="Back to your games">
          <IconChevron className="h-3.5 w-3.5 rotate-180" />
        </Link>
        <Wordmark className="hidden lg:flex" />
        <span className="hidden h-5 w-px bg-line lg:block" />

        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={(e) => saveTitle(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          className="u-marquee min-w-0 flex-1 truncate rounded-md bg-transparent px-2 py-1 text-[0.875rem] outline-none transition-colors hover:bg-surface-2 focus:bg-surface-2 sm:max-w-xs"
          style={{ color: `hsl(${game.hue} 80% 78%)` }}
          aria-label="Game title"
          maxLength={80}
        />

        <div className="ml-auto flex items-center gap-2">
          <div
            className="chip hidden md:flex"
            title={`${usage.prompt.toLocaleString()} in · ${usage.output.toLocaleString()} out · ${usage.cached.toLocaleString()} cached`}
          >
            <span className="text-dim">ctx</span>
            {(usage.context / 1000).toFixed(1)}k
            <span className="text-line-bright">·</span>
            <span className="text-dim">${cost.toFixed(3)}</span>
          </div>

          <label className="sr-only" htmlFor="model">
            Model
          </label>
          <select
            id="model"
            value={model}
            onChange={(e) => changeModel(e.target.value)}
            className="chip hidden cursor-pointer !text-muted focus:!text-text sm:flex"
          >
            {MODEL_CHOICES.map((m) => (
              <option key={m.id} value={m.id} className="bg-surface">
                {m.label}
              </option>
            ))}
          </select>

          {visibility === "public" ? (
            <Link href={`/play/${game.id}`} className="btn btn-sm hidden sm:inline-flex">
              <IconGlobe className="h-3.5 w-3.5 text-good" />
              View live
            </Link>
          ) : null}

          <button type="button" onClick={togglePublish} className="btn btn-primary btn-sm" disabled={publishing}>
            {publishing ? "Working…" : visibility === "public" ? "Republish" : "Publish"}
          </button>
        </div>
      </header>

      {banner ? (
        <div role="alert" className="flex items-center gap-2 border-b border-danger/40 bg-danger/10 px-4 py-2 text-[0.8125rem] text-danger">
          <IconWarn className="h-3.5 w-3.5 shrink-0" />
          {banner}
          <button type="button" className="ml-auto text-dim hover:text-text" onClick={() => setBanner(null)}>
            Dismiss
          </button>
        </div>
      ) : null}

      {/* --------------------------------------------------------- body -- */}
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <main className="flex min-h-0 flex-1 flex-col p-3 lg:pr-0">
          <div className="cabinet flex min-h-0 flex-1 flex-col" style={{ ["--hue" as string]: game.hue }}>
            <div className="relative z-[2] flex shrink-0 items-center gap-2 border-b border-line px-3 py-2">
              <span className={running === "running" ? "pulse-live" : "h-[7px] w-[7px] rounded-full bg-dim"} />

              <div className="ml-1 flex overflow-hidden rounded-md border border-line">
                {(["play", "code"] as const).map((key) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setTab(key)}
                    className={`u-label px-2.5 py-1 transition-colors ${
                      tab === key ? "bg-surface-2 !text-text" : "hover:!text-text"
                    }`}
                  >
                    {key === "play" ? "Preview" : `Files (${Object.keys(files).length})`}
                  </button>
                ))}
              </div>

              <div className="ml-auto flex items-center gap-1">
                <button
                  type="button"
                  className="btn btn-ghost btn-sm !px-2"
                  onClick={() => frame.current?.restart()}
                  aria-label="Restart game"
                >
                  <IconRestart className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm !px-2"
                  onClick={async () => {
                    const shot = await frame.current?.screenshot();
                    if (!shot) {
                      setBanner("No canvas found to capture.");
                      return;
                    }
                    await fetch(`/api/games/${game.id}/thumbnail`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ dataUrl: shot }),
                    });
                    router.refresh();
                  }}
                  aria-label="Use current frame as the cover image"
                  title="Use current frame as the cover image"
                >
                  <IconCamera className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            <div className="relative min-h-0 flex-1">
              {tab === "play" ? (
                <div className="screen vignette absolute inset-0">
                  <GameFrame
                    ref={frame}
                    src={`/g/d/${game.id}/${game.preview_key}/index.html`}
                    gameId={game.id}
                    signedIn
                    revision={revision}
                    onLog={onLog}
                    onStatus={setRunning}
                    className="absolute inset-0 h-full w-full border-0"
                  />
                </div>
              ) : (
                <div className="absolute inset-0 overflow-hidden">
                  <FilesPanel files={files} />
                </div>
              )}
            </div>

            {/* Console drawer */}
            <div className="shrink-0 border-t border-line">
              <button
                type="button"
                onClick={() => setLogsOpen((v) => !v)}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left"
              >
                <IconChevron className={`h-3 w-3 text-dim transition-transform ${logsOpen ? "rotate-90" : ""}`} />
                <span className="u-label">Console</span>
                {errors.length > 0 ? (
                  <span className="chip !h-5 !border-danger/50 !text-danger">
                    {errors.length} {errors.length === 1 ? "error" : "errors"}
                  </span>
                ) : logs.length > 0 ? (
                  <span className="u-label !text-dim">{logs.length}</span>
                ) : null}
                {logs.length > 0 ? (
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      e.stopPropagation();
                      setLogs([]);
                    }}
                    onKeyDown={(e) => e.key === "Enter" && setLogs([])}
                    className="u-label ml-auto cursor-pointer hover:!text-text"
                  >
                    Clear
                  </span>
                ) : null}
              </button>

              {logsOpen ? (
                <div className="max-h-44 overflow-y-auto border-t border-line px-3 py-2">
                  {logs.length === 0 ? (
                    <p className="py-2 text-[0.75rem] text-dim">Nothing logged since the last reload.</p>
                  ) : (
                    logs.map((log) => (
                      <div
                        key={log.id}
                        className={`u-num py-[3px] text-[0.72rem] leading-relaxed ${
                          log.level === "error" ? "text-danger" : log.level === "warn" ? "text-amber" : "text-muted"
                        }`}
                      >
                        <span className="mr-2 text-dim">{log.level}</span>
                        <span className="whitespace-pre-wrap">{log.text}</span>
                      </div>
                    ))
                  )}
                </div>
              ) : null}
            </div>
          </div>
        </main>

        {/* --------------------------------------------------------- chat -- */}
        <aside className="flex h-[52vh] shrink-0 flex-col border-t border-line lg:h-auto lg:w-[380px] lg:border-l lg:border-t-0 xl:w-[420px]">
          <ChatRail
            items={items}
            streaming={streaming}
            status={status}
            errorCount={errors.length}
            onSend={send}
            onStop={() => abort.current?.abort()}
            onCaptureFrame={async () => (await frame.current?.screenshot()) ?? null}
          />
        </aside>
      </div>
    </div>
  );
}
