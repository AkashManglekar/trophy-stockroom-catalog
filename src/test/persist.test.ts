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

describe("device cache safety", () => {
  it("never saves data that would come back changed", async () => {
    vi.useFakeTimers();
    const a = new QueryClient();
    const stop = persistQueries(a);
    await a.fetchQuery({ queryKey: ["guide", "u1"], queryFn: async () => new Set(["x"]) });
    await a.fetchQuery({ queryKey: ["members"], queryFn: async () => [{ email: "a" }] });
    await a.fetchQuery({ queryKey: ["vendors"], queryFn: async () => [{ code: "V1" }] });
    vi.advanceTimersByTime(2000);
    stop();
    vi.useRealTimers();
    const b = new QueryClient();
    restoreQueries(b);
    expect(b.getQueryData(["guide", "u1"])).toBeUndefined();
    expect(b.getQueryData(["members"])).toBeUndefined();
    expect(b.getQueryData(["vendors"])).toEqual([{ code: "V1" }]);
  });
});
