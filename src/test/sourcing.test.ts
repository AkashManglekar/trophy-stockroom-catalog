import { describe, expect, it } from "vitest";
import {
  flagView,
  isLow,
  pricingBasis,
  reorderLevel,
  sourcesFor,
  suggestQty,
} from "@/lib/sourcing";
import { normaliseSettings } from "@/lib/domain";

const src = (vendor_id: string, last_cost: number, o: Record<string, unknown> = {}) =>
  ({
    product_id: "p1",
    vendor_id,
    last_cost,
    last_extra: null,
    last_date: "2026-10-01",
    bills: 1,
    units: 10,
    avg_cost: last_cost,
    min_cost: last_cost,
    last_bill: "2026-10-01",
    vendor_code: null,
    received_at: "2026-10-01T10:00:00Z",
    ...o,
  }) as never;
const vendor = (id: string, status = "Active") => ({ id, status, display_name: id }) as never;
const vendors = [vendor("A"), vendor("B"), vendor("C", "Exited")];

describe("one product, several vendors", () => {
  const sources = [src("A", 450), src("B", 400), src("C", 300)];

  it("lists the cheapest vendor we still buy from first and marks it as setting the price", () => {
    const rows = sourcesFor("p1", sources, vendors);
    expect(rows.map((r) => r.vendor_id)).toEqual(["B", "A", "C"]);
    expect(rows[0]!.best).toBe(true);
    expect(rows.find((r) => r.vendor_id === "C")!.active).toBe(false);
  });

  it("prices a new bill on the lowest current vendor price", () => {
    // A bills at 450, B's latest is 400 → priced on B.
    expect(pricingBasis("p1", "A", 450, null, sources, vendors)).toMatchObject({
      cost: 400,
      vendorId: "B",
      other: true,
    });
    // A bills at 380 → A is now the cheapest.
    expect(pricingBasis("p1", "A", 380, 12, sources, vendors)).toMatchObject({
      cost: 380,
      extra: 12,
      vendorId: "A",
      other: false,
    });
    // The exited vendor's 300 never counts.
    expect(pricingBasis("p1", "B", 420, null, sources, vendors)).toMatchObject({
      cost: 420,
      vendorId: "B",
    });
  });
});

describe("low-stock reminders", () => {
  const settings = normaliseSettings({ reorder: { "TR:CUP": { low: 5, upTo: 20 } } });
  const p = (o: Record<string, unknown>) =>
    ({
      id: "p1",
      div: "TR",
      type: "CUP",
      stock: 3,
      reorder_point: null,
      status: "Active",
      ...o,
    }) as never;

  it("uses the category level unless the product sets its own (0 = never)", () => {
    expect(reorderLevel(p({}), settings)).toEqual({ level: 5, from: "category" });
    expect(reorderLevel(p({ reorder_point: 8 }), settings)).toEqual({ level: 8, from: "product" });
    expect(reorderLevel(p({ reorder_point: 0 }), settings)).toBeNull();
    expect(reorderLevel(p({ type: "MED" }), settings)).toBeNull();
  });

  it("flags low stock and suggests ordering up to the target, at least the MOQ", () => {
    expect(isLow(p({}), settings, undefined)).toBe(true);
    expect(isLow(p({ stock: 6 }), settings, undefined)).toBe(false);
    expect(isLow(p({ status: "Archived" }), settings, undefined)).toBe(false);
    expect(suggestQty(p({}), settings)).toBe(17);
    expect(suggestQty(p({}), settings, "25")).toBe(25);
    // No "order up to": twice the level.
    const s2 = normaliseSettings({ reorder: { "TR:CUP": { low: 5 } } });
    expect(suggestQty(p({ stock: 0 }), s2)).toBe(10);
  });

  it("an 'ordered' decision lasts until stock arrives on a later bill", () => {
    const f = { state: "ordered", until: null, created_at: "2026-10-10T09:00:00Z" } as never;
    const now = Date.parse("2026-10-12T00:00:00Z");
    expect(flagView(f, "2026-10-10T08:00:00Z", now)).toBe("ordered"); // bill before the order
    expect(flagView(f, "2026-10-11T08:00:00Z", now)).toBeNull(); // received after ordering
    expect(flagView(f, null, Date.parse("2027-01-01T00:00:00Z"))).toBeNull(); // 60 days passed
    const ig = {
      state: "ignored",
      until: "2026-10-20",
      created_at: "2026-10-10T09:00:00Z",
    } as never;
    expect(flagView(ig, null, now)).toBe("ignored");
    expect(flagView(ig, null, Date.parse("2026-10-21T00:00:00Z"))).toBeNull();
  });
});
