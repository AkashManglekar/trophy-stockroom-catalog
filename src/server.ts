import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as { unhandled?: unknown; message?: unknown };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

// The public catalogue page is the same for every visitor, so a ready copy is kept at the edge for
// two minutes instead of rebuilding it per visit. The key carries the build id, so a new deploy
// never serves a page that points at old script files.
declare const __BUILD_ID__: string | undefined;
const BUILD = typeof __BUILD_ID__ === "string" ? __BUILD_ID__ : "dev";
const PAGE_TTL = 120;
type EdgeCache = {
  match(r: Request): Promise<Response | undefined>;
  put(r: Request, res: Response): Promise<void>;
};
const edgeCache = (): EdgeCache | null =>
  (globalThis as unknown as { caches?: { default?: EdgeCache } }).caches?.default ?? null;
const waitUntil = (ctx: unknown, p: Promise<unknown>) => {
  const w = (ctx as { waitUntil?: (p: Promise<unknown>) => void } | null)?.waitUntil;
  if (typeof w === "function") w.call(ctx, p);
  else void p;
};

function cataloguePageKey(request: Request): Request | null {
  if (request.method !== "GET") return null;
  const url = new URL(request.url);
  const host = (request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? url.host)
    .split(",")[0]!
    .trim()
    .toLowerCase()
    .split(":")[0];
  if (host !== "catalogue.sportagon.in" || url.pathname !== "/") return null;
  return new Request(`https://${host}/__page/${BUILD}`, { method: "GET" });
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const key = cataloguePageKey(request);
      const cache = key ? edgeCache() : null;
      if (key && cache) {
        const hit = await cache.match(key).catch(() => undefined);
        if (hit) return hit;
      }
      const handler = await getServerEntry();
      const response = await normalizeCatastrophicSsrResponse(
        await handler.fetch(request, env, ctx),
      );
      if (
        key &&
        cache &&
        response.status === 200 &&
        !response.headers.has("set-cookie") &&
        (response.headers.get("content-type") ?? "").includes("text/html")
      ) {
        const copy = new Response(response.body, response);
        copy.headers.set("cache-control", `public, max-age=0, s-maxage=${PAGE_TTL}`);
        waitUntil(
          ctx,
          cache.put(key, copy.clone()).catch(() => undefined),
        );
        return copy;
      }
      return response;
    } catch (error) {
      console.error(error);
      return new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
};
