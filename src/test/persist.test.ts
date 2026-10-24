// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { clearPersisted, persistQueries, restoreQueries } from "@/lib/query-persist";

describe("device cache", () => {
  it("restores saved data on the next open and clears on sign-out", async () => {
    vi.useFakeTimers();
    const a = new QueryClient();
    const stop = persistQueries(a);
    await a.fetchQuery({ queryKey: ["products"], queryFn: async () => [{ code: "TC-1005-11" }] });
    vi.advanceTimersByTime(2000);
    stop();
    vi.useRealTimers();

    const b = new QueryClient();
    restoreQueries(b);
    expect(b.getQueryData(["products"])).toEqual([{ code: "TC-1005-11" }]);

    clearPersisted();
    const c = new QueryClient();
    restoreQueries(c);
    expect(c.getQueryData(["products"])).toBeUndefined();
  });
});
