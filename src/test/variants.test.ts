import { describe, expect, it } from "vitest";
import { variantAxes } from "@/lib/variants";
import { variantSku } from "@/lib/naming";

const medal = [
  { size: "50mm", colour: "Bronze" },
  { size: "50mm", colour: "Gold" },
  { size: "50mm", colour: "Silver" },
  { size: "65mm", colour: "Gold" },
];

describe("colour × size variants", () => {
  it("splits sizes and colours", () => {
    const ax = variantAxes(medal);
    expect(ax.sizes).toEqual(["50mm", "65mm"]);
    expect(ax.colours).toEqual(["Bronze", "Gold", "Silver"]);
    expect(ax.find("65mm", "Silver")).toBe(-1);
  });
  it("keeps the other choice when it exists, else picks the first match", () => {
    const ax = variantAxes(medal);
    expect(ax.choose(1, { size: "65mm" })).toBe(3); // Gold 50 → Gold 65
    expect(ax.choose(3, { colour: "Silver" })).toBe(2); // Gold 65 → Silver (only 50mm)
    expect(ax.choose(2, { colour: "Bronze" })).toBe(0);
  });
  it("medal SKUs always carry the colour; trophies only on a clash", () => {
    expect(variantSku("TM-1001", "050", "mm", "GD", [], new Set(), true)).toBe("TM-1001-50-GD");
    expect(variantSku("TM-1001", "050", "mm", "SV", [], new Set(["TM-1001-50-GD"]), true)).toBe(
      "TM-1001-50-SV",
    );
    expect(variantSku("TC-1005", "011", "in", "GD", [], new Set())).toBe("TC-1005-11");
    expect(variantSku("TC-1005", "011", "in", "SV", [], new Set(["TC-1005-11"]))).toBe(
      "TC-1005-11-SV",
    );
  });
});

import { normaliseSize, sizeLabel, sizeTag } from "@/lib/naming";
describe("fractional inch sizes (medals)", () => {
  it("keeps halves and quarters distinct", () => {
    expect(normaliseSize("2.5", "in")).toBe("002.5");
    expect(normaliseSize("2.75 inch", "in")).toBe("002.75");
    expect(normaliseSize("3", "in")).toBe("003");
    expect(normaliseSize("12in", "in")).toBe("012");
    expect(normaliseSize("0.5", "in")).toBe("000.5");
  });
  it("labels and SKU tags read naturally", () => {
    expect(sizeLabel("002.5", "in", [])).toBe("2.5in");
    expect(sizeTag("002.5", "in", [])).toBe("2.5");
    expect(sizeTag("000.5", "in", [])).toBe("0.5");
    expect(sizeTag("012", "in", [])).toBe("12");
  });
});
