import { entryHtml, mimeFor, MISSING_ENTRY_HTML, injectHarness } from "./runtime";
import type { FileMap } from "./types";

/**
 * The frame is sandboxed without allow-same-origin, so it loads these files from
 * an opaque origin — every request is cross-origin and credential-less. That is
 * exactly what we want (no cookie access), but it means CORS has to be open and
 * 'self' is useless in the CSP, so the host origin is named explicitly.
 */
/**
 * The origin the browser actually used. `req.url` is reconstructed by the server
 * and reports localhost even when the page was opened over a LAN address, which
 * would put the wrong host in the CSP and block the game's own CSS and scripts.
 */
function requestOrigin(req: Request): string {
  const forwardedHost = req.headers.get("x-forwarded-host");
  const host = forwardedHost || req.headers.get("host");
  if (!host) return new URL(req.url).origin;
  const proto = req.headers.get("x-forwarded-proto") || new URL(req.url).protocol.replace(":", "");
  return `${proto}://${host}`;
}

export function serveGameFile(files: FileMap, segments: string[] | undefined, req: Request): Response {
  const path = (segments ?? []).join("/") || "index.html";
  const origin = requestOrigin(req);

  const headers = new Headers({
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store, must-revalidate",
    "X-Content-Type-Options": "nosniff",
  });

  const isEntry = path === "index.html";
  let body: string | undefined = files[path];

  if (isEntry) {
    body = body === undefined ? MISSING_ENTRY_HTML : entryHtml(files);
  } else if (body !== undefined && /\.html$/i.test(path)) {
    body = injectHarness(body);
  }

  if (body === undefined) {
    headers.set("Content-Type", "text/plain; charset=utf-8");
    return new Response(`Not found: ${path}`, { status: 404, headers });
  }

  headers.set("Content-Type", mimeFor(path));

  if (/\.html$/i.test(path)) {
    headers.set(
      "Content-Security-Policy",
      [
        "default-src 'none'",
        `script-src ${origin} 'unsafe-inline' 'unsafe-eval' blob:`,
        `style-src ${origin} 'unsafe-inline'`,
        `img-src ${origin} data: blob:`,
        `media-src ${origin} data: blob:`,
        `font-src ${origin} data:`,
        "worker-src blob:",
        "connect-src 'none'",
        "base-uri 'none'",
        "form-action 'none'",
      ].join("; ")
    );
  }

  return new Response(body, { status: 200, headers });
}

export function corsPreflight(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Max-Age": "600",
    },
  });
}
