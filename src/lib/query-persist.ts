import { dehydrate, hydrate, type QueryClient } from "@tanstack/react-query";

/**
 * Keeps the stockroom's data on this device so the app opens instantly with the last copy,
 * then refreshes in the background. Cleared on sign-out.
 */
// v1 could hold data that doesn't survive saving (the Guide's ticks); bumping the key drops it.
// v3: settings gained low-stock levels; copies saved by older versions are dropped.
const KEY = "sgn-stockroom-cache-v3";
const OLD_KEYS = ["sgn-stockroom-cache-v1", "sgn-stockroom-cache-v2"];
/** Only plain lists/records with a stable shape are kept on the device. */
const KEEP = new Set([
  "ref",
  "products",
  "families",
  "vendors",
  "photos",
  "vendor_codes",
  "receipts",
  "my-role",
  "payments",
  "reviews",
  "quotes",
  "submissions",
  "sales",
  "guide",
  "vendor_notes",
  "sources",
  "reorder_flags",
  "issues",
]);
/** True when the value comes back identical after JSON (no Set, Map, Date, class instances). */
function plain(v: unknown, depth = 0): boolean {
  if (v === null || ["string", "number", "boolean"].includes(typeof v)) return true;
  if (depth > 6) return true;
  if (Array.isArray(v)) return v.length === 0 || plain(v[0], depth + 1);
  if (typeof v === "object") {
    const proto = Object.getPrototypeOf(v);
    if (proto !== Object.prototype && proto !== null) return false;
    return Object.values(v as Record<string, unknown>).every((x) => plain(x, depth + 1));
  }
  return false;
}
const MAX_AGE = 7 * 86_400_000;
const MAX_BYTES = 4_000_000;

type Saved = { at: number; state: ReturnType<typeof dehydrate> };

export function restoreQueries(qc: QueryClient) {
  try {
    for (const k of OLD_KEYS) localStorage.removeItem(k);
    const raw = localStorage.getItem(KEY);
    if (!raw) return;
    const saved = JSON.parse(raw) as Saved;
    if (!saved?.state || Date.now() - saved.at > MAX_AGE) {
      localStorage.removeItem(KEY);
      return;
    }
    hydrate(qc, saved.state);
  } catch {
    /* storage blocked or corrupt — start fresh */
  }
}

export function persistQueries(qc: QueryClient): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const save = () => {
    timer = undefined;
    try {
      const state = dehydrate(qc, {
        shouldDehydrateQuery: (q) =>
          q.state.status === "success" &&
          KEEP.has(String(q.queryKey[0])) &&
          q.state.data !== undefined &&
          plain(q.state.data),
      });
      const raw = JSON.stringify({ at: Date.now(), state } satisfies Saved);
      if (raw.length < MAX_BYTES) localStorage.setItem(KEY, raw);
    } catch {
      /* quota or blocked storage — keep working without the cache */
    }
  };
  const schedule = () => {
    if (!timer) timer = setTimeout(save, 1500);
  };
  const unsub = qc.getQueryCache().subscribe((e) => {
    if (e.type === "updated" && e.action.type === "success") schedule();
  });
  const onHide = () => {
    if (timer) {
      clearTimeout(timer);
      save();
    }
  };
  window.addEventListener("pagehide", onHide);
  return () => {
    unsub();
    window.removeEventListener("pagehide", onHide);
    onHide();
  };
}

export function clearPersisted() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
