import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, type Division, type ProductType, type RefData } from "@/lib/domain";
import { computePrice } from "@/lib/pricing";
import {
  designNameProblem,
  friendlyName,
  matchKey,
  normaliseSize,
  specCode,
  stripTax,
} from "@/lib/naming";
import { gstinAutofill, vendorIssues } from "@/lib/gst";

const TR: Division = {
  code: "TR",
  name: "Trophies & Awards",
  letter: "T",
  freight_pct: 5,
  packaging: 20,
  rounding: 10,
  target_margin: 45,
  floor_margin: 30,
  bulk_pct: 10,
  bulk_min_qty: 25,
  pricing_mode: "bands",
  sort: 1,
};
const AP: Division = {
  ...TR,
  code: "AP",
  name: "Apparel",
  letter: "A",
  freight_pct: 4,
  packaging: 15,
  target_margin: 40,
  floor_margin: 25,
  bulk_pct: 12,
  bulk_min_qty: 15,
};
const CUP: ProductType = {
  id: "1",
  div: "TR",
  code: "CUP",
  name: "Cup Trophy",
  letter: "C",
  size_unit: "in",
  uom: "pcs",
  hsn: "83062920",
  gst: 18,
  is_service: false,
  margin_override: null,
};
const JRS: ProductType = {
  ...CUP,
  div: "AP",
  code: "JRS",
  name: "Jersey",
  letter: "J",
  size_unit: "size",
  gst: null,
};
const S = DEFAULT_SETTINGS;

describe("pricing bands", () => {
  it("prices under ₹1,000 landed at ×2.5", () => {
    const r = computePrice({ unitCost: 420, division: TR, type: CUP, settings: S });
    expect(r.landed).toBe(461);
    expect(r.selling).toBe(1160);
    expect(r.mrp).toBe(1370);
    expect(r.rule).toBe("Band ×2.5");
  });
  it("uses ×2 from ₹1,000 and ×1.5 from ₹2,001", () => {
    expect(computePrice({ unitCost: 1000, division: TR, type: CUP, settings: S }).selling).toBe(
      2140,
    );
    expect(computePrice({ unitCost: 2000, division: TR, type: CUP, settings: S }).selling).toBe(
      3180,
    );
  });
  it("edge protection never prices below the band beneath", () => {
    const r = computePrice({
      unitCost: 1000,
      division: TR,
      type: CUP,
      settings: { ...S, edge_protection: true },
    });
    expect(r.selling).toBe(2510);
  });
  it("supports custom multiplier, margin and fixed price", () => {
    expect(
      computePrice({ unitCost: 420, division: TR, type: CUP, settings: S, mode: "mult", value: 3 })
        .selling,
    ).toBe(1390);
    expect(
      computePrice({
        unitCost: 420,
        division: TR,
        type: CUP,
        settings: S,
        mode: "margin",
        value: 50,
      }).selling,
    ).toBe(930);
    const f = computePrice({
      unitCost: 420,
      division: TR,
      type: CUP,
      settings: S,
      mode: "fixed",
      value: 300,
    });
    expect(f.selling).toBe(300);
    expect(f.belowCost).toBe(true);
    expect(f.floor).toBe(300);
  });
  it("applies apparel GST by the price threshold", () => {
    expect(computePrice({ unitCost: 290, division: AP, type: JRS, settings: S }).gst).toBe(5);
    expect(computePrice({ unitCost: 1200, division: AP, type: JRS, settings: S }).gst).toBe(18);
  });
  it("falls back to target margin when the division uses margins", () => {
    const r = computePrice({
      unitCost: 420,
      division: { ...TR, pricing_mode: "margin" },
      type: CUP,
      settings: S,
    });
    expect(r.selling).toBe(840);
  });
  it("returns no price without a cost", () => {
    expect(
      computePrice({ unitCost: null, division: TR, type: CUP, settings: S }).selling,
    ).toBeNull();
  });
});

const ref = {
  divisions: [TR, AP],
  types: [CUP, JRS],
  materials: [{ kind: "material", code: "MT", name: "Metal", sort: 1 }],
  sports: [{ kind: "sport", code: "CRK", name: "Cricket", sort: 1 }],
  finishes: [
    { kind: "finish", code: "GD", name: "Gold", sort: 1 },
    { kind: "finish", code: "CL", name: "Clear", sort: 2 },
  ],
  sizes: [{ kind: "apparel_size", code: "MED", name: "M", sort: 1 }],
  settings: S,
} as RefData;

describe("naming", () => {
  it("normalises sizes by unit", () => {
    expect(normaliseSize("12", "in")).toBe("012");
    expect(normaliseSize("65mm", "mm")).toBe("065");
    expect(normaliseSize("med", "size")).toBe("MED");
    expect(normaliseSize("", "none")).toBe("000");
  });
  it("builds friendly names and spec codes", () => {
    expect(friendlyName("Champion Cup", "012", "in", "GD", ref)).toBe("Champion Cup · 12in · Gold");
    expect(friendlyName("Velocity", "MED", "size", "NA", ref)).toBe("Velocity · M");
    expect(specCode("TR", "CUP", "MT", "CRK", 1, "012", "GD")).toBe("TR-CUP-MT-CRK-001-012-GD");
  });
  it("rejects category-only design names", () => {
    expect(designNameProblem("Cup Trophy", ref, false)).toMatch(/category/);
    expect(designNameProblem("Gold Cup Trophy", ref, false)).toMatch(/category/);
    expect(designNameProblem("", ref, false)).toMatch(/name/);
    expect(designNameProblem("Titan Cup", ref, false)).toBeNull();
    expect(designNameProblem("", ref, true)).toBeNull();
  });
  it("strips tax references from customer text", () => {
    expect(stripTax("Item 3617 (HSN 8306)")).toBe("Item 3617");
    expect(stripTax("Crystal award, HSN: 70139900, gift box")).toBe("Crystal award, gift box");
    expect(stripTax("Price incl. GST")).toBe("Price");
    expect(stripTax("Metal medal with ribbon")).toBe("Metal medal with ribbon");
  });
  it("builds vendor match keys", () => {
    expect(matchKey(" STW-CC12 ", "x")).toBe("c:stw-cc12");
    expect(matchKey("", "Cricket Cup, 12 inch!")).toBe("d:cricket cup 12 inch");
  });
});

describe("vendors", () => {
  it("fills state, source of supply and PAN from GSTIN", () => {
    const v: Record<string, unknown> = gstinAutofill({
      display_name: "X",
      gstin: "27aabcs1429b1z1",
      gst_treatment: "business_unregistered",
    });
    expect(v["source_of_supply"]).toBe("MH");
    expect(v["pan"]).toBe("AABCS1429B");
    expect(v["gst_treatment"]).toBe("business_registered_regular");
    expect(vendorIssues(v as never)).toEqual([]);
  });
  it("lists missing Zoho fields", () => {
    expect(vendorIssues({ gst_treatment: "business_registered_regular" })).toEqual([
      "display name",
      "GSTIN",
      "source of supply",
    ]);
  });
});

import { sizeTag, variantSku } from "@/lib/naming";
import { chargeAllocation } from "@/lib/receive-plan";
import { newDraft, newLine } from "@/lib/draft";

describe("one code per design", () => {
  const sizes = [{ code: "LRG", name: "L" }] as never;
  it("builds variant SKUs from the design code", () => {
    expect(sizeTag("011", "in", sizes)).toBe("11");
    expect(sizeTag("LRG", "size", sizes)).toBe("L");
    expect(sizeTag("000", "none", sizes)).toBe("");
    expect(variantSku("TC-1005", "014", "in", "GD", sizes, new Set())).toBe("TC-1005-14");
    expect(variantSku("TC-1005", "014", "in", "SL", sizes, new Set(["TC-1005-14"]))).toBe(
      "TC-1005-14-SL",
    );
    expect(variantSku("TS-1001", "000", "none", "NA", sizes, new Set())).toBe("TS-1001");
  });
});

describe("bill charges", () => {
  it("spreads charges over lines by value, per billed unit", () => {
    const d = {
      ...newDraft(),
      charges: [{ id: "a", label: "Shipping / freight", amount: "300", gst: "18" }],
      lines: [
        newLine({ id: "x", cost: "100", billed: "10" }), // value 1000
        newLine({ id: "y", cost: "500", billed: "4" }), // value 2000
      ],
    };
    const a = chargeAllocation(d);
    expect(a.net).toBe(300);
    expect(a.gst).toBe(54);
    expect(a.perUnit).toEqual({ x: 10, y: 50 }); // 100 over 10 units, 200 over 4 units
  });
  it("uses estimates when the bill has no charges", () => {
    expect(
      chargeAllocation({ ...newDraft(), lines: [newLine({ cost: "1", billed: "1" })] }).perUnit,
    ).toBeNull();
  });
});
