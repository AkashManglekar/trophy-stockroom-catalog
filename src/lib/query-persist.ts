import { dehydrate, hydrate, type QueryClient } from "@tanstack/react-query";

/**
 * Keeps the stockroom's data on this device so the app opens instantly with the last copy,
 * then refreshes in the background. Cleared on sign-out.
 */
const KEY = "sgn-stockroom-cache-v1";
const MAX_AGE = 7 * 86_400_000;
const MAX_BYTES = 4_000_000;

type Saved = { at: number; state: ReturnType<typeof dehydrate> };

export function restoreQueries(qc: QueryClient) {
  try {
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
        shouldDehydrateQuery: (q) => q.state.status === "success" && q.state.data !== undefined,
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
