import { runAgent } from "@/lib/agent";
import { handler, HttpError, readJson, requireOwnedGame } from "@/lib/http";
import type { StreamEvent } from "@/lib/types";

type Params = { params: Promise<{ id: string }> };

export const maxDuration = 800;

export const POST = handler(async (req: Request, { params }: Params) => {
  const { game } = await requireOwnedGame((await params).id);
  const { message, diagnostics, images } = await readJson<{
    message?: string;
    diagnostics?: string;
    images?: string[];
  }>(req);

  const text = (message ?? "").trim();
  if (!text) throw new HttpError("Type what you want to change.");
  if (text.length > 8000) throw new HttpError("That message is too long. Break it into smaller steps.");

  // Screenshots the user attached to show a problem.
  const attachments = (images ?? [])
    .filter((d) => typeof d === "string" && /^data:image\/(png|jpeg|webp);base64,/.test(d))
    .slice(0, 4);
  if (attachments.some((d) => d.length > 4_000_000)) {
    throw new HttpError("One of those images is too large. Keep attachments under about 3 MB.");
  }

  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || new URL(req.url).host;
  const proto = req.headers.get("x-forwarded-proto") || new URL(req.url).protocol.replace(":", "");
  const origin = `${proto}://${host}`;

  const encoder = new TextEncoder();
  const controller = new AbortController();
  req.signal.addEventListener("abort", () => controller.abort());

  const stream = new ReadableStream({
    async start(ctrl) {
      let closed = false;
      const send = (event: StreamEvent) => {
        if (closed) return;
        try {
          ctrl.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          closed = true;
        }
      };

      // A long tool step can leave the stream silent for minutes; proxies and
      // HTTP clients read that as a dead connection. Comment frames keep it warm
      // and are ignored by EventSource parsers.
      const heartbeat = setInterval(() => {
        if (closed) return;
        try {
          ctrl.enqueue(encoder.encode(": keep-alive\n\n"));
        } catch {
          closed = true;
        }
      }, 15_000);

      try {
        await runAgent({
          gameId: game.id,
          baseUrl: origin,
          userText: text,
          images: attachments,
          diagnostics: diagnostics?.slice(0, 6000),
          signal: controller.signal,
          emit: send,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "The assistant hit an unexpected error.";
        if (!controller.signal.aborted) send({ type: "error", message });
      } finally {
        clearInterval(heartbeat);
        closed = true;
        try {
          ctrl.close();
        } catch {
          /* already closed by the client disconnecting */
        }
      }
    },
    cancel() {
      controller.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
});
