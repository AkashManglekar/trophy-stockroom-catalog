import { createFileRoute } from "@tanstack/react-router";

// Product photo paths are random UUIDs, so a path works like a private link (same as a signed URL),
// but it is stable — browsers and the edge cache it for a year instead of re-downloading.
const SAFE = /^products\/[A-Za-z0-9-]+\/[A-Za-z0-9-]+(\.t)?\.jpg$/;
const YEAR = "public, max-age=31536000, immutable";

type EdgeCache = {
  match(r: Request): Promise<Response | undefined>;
  put(r: Request, res: Response): Promise<void>;
};
const edgeCache = (): EdgeCache | null =>
  (globalThis as unknown as { caches?: { default?: EdgeCache } }).caches?.default ?? null;

const miss = (status: number) =>
  new Response(status === 404 ? "Not found" : "Unavailable", {
    status,
    headers: { "cache-control": "no-store" },
  });

export const Route = createFileRoute("/media/$")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const path = String(params._splat ?? "");
        if (!SAFE.test(path)) return miss(404);
        const url = new URL(request.url);
        const cache = edgeCache();
        const key = new Request(url.toString(), { method: "GET" });
        const hit = await cache?.match(key).catch(() => undefined);
        if (hit) return hit;

        const thumb = url.searchParams.get("w") === "t";
        let file: { data: Blob | null } | null = null;
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const bucket = supabaseAdmin.storage.from("media");
          // Small copy first for grids; older photos without one fall back to the full image.
          if (thumb) file = await bucket.download(path.replace(/\.jpg$/, ".t.jpg"));
          if (!file?.data) file = await bucket.download(path);
        } catch {
          return miss(503);
        }
        if (!file?.data) return miss(404);

        const res = new Response(file.data, {
          headers: {
            "content-type": file.data.type || "image/jpeg",
            "cache-control": YEAR,
            "x-content-type-options": "nosniff",
          },
        });
        await cache?.put(key, res.clone()).catch(() => undefined);
        return res;
      },
    },
  },
});
