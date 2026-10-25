import { describe, expect, it } from "vitest";
import { newDraft, newLine } from "@/lib/draft";
import {
  applyGroup,
  cellKey,
  groupFromLine,
  groupLines,
  groupSizes,
  removeGroup,
} from "@/lib/variant-grid";

const finishes = [
  { code: "GD", name: "Gold", kind: "finish", sort: 1 },
  { code: "SV", name: "Silver", kind: "finish", sort: 2 },
  { code: "BZ", name: "Bronze", kind: "finish", sort: 3 },
] as never[];
const ctx = { unit: "in", apparelSizes: [], finishes, products: [] as never[] };
const cls = {
  div: "TR",
  type: "MED",
  mat: "MT",
  sport: "GEN",
  size: "",
  finish: "",
  family: "new",
  designName: "Laurel",
  description: "",
};

describe("size × colour bill entry", () => {
  it("parses sizes as typed", () => {
    expect(groupSizes({ sizesText: '2, 2.5,3"' }, "in")).toEqual(["002", "002.5", "003"]);
    expect(groupSizes({ sizesText: "2 2.5 3" }, "in")).toEqual(["002", "002.5", "003"]);
    expect(groupSizes({ sizesText: "" }, "none")).toEqual(["000"]);
  });

  it("expands filled cells into one line per variant under one new design", () => {
    const g = {
      ...groupFromLine(newLine({ vitem: "MD7", desc: "Laurel medal", cost: "40", cls }), "in"),
      sizesText: "2, 2.5",
      colours: ["GD", "SV", "BZ"],
      cells: {
        [cellKey("002", "GD")]: { qty: "100" },
        [cellKey("002", "SV")]: { qty: "100" },
        [cellKey("002.5", "GD")]: { qty: "50", cost: "55" },
        [cellKey("002", "BZ")]: { qty: "" },
      },
    };
    const lines = groupLines(g, [], ctx);
    expect(lines.map((l) => [l.cls.size, l.cls.finish, l.billed, l.cost])).toEqual([
      ["002", "GD", "100", "40"],
      ["002.5", "GD", "50", "55"],
      ["002", "SV", "100", "40"],
    ]);
    // first line opens the new design; the others are sizes/colours of it
    expect(lines[0]!.cls.family).toBe("new");
    expect(lines[0]!.cls.designName).toBe("Laurel");
    expect(lines[1]!.cls.family).toBe(`l:${lines[0]!.id}`);
    expect(lines[1]!.cls.designName).toBe("");
    // each variant gets its own vendor code + description, so codes map one-to-one
    expect(lines.map((l) => l.vitem)).toEqual(["MD7-2-GD", "MD7-2.5-GD", "MD7-2-SV"]);
    expect(lines[2]!.desc).toBe("Laurel medal · 2in Silver");
  });

  it("links variants that already exist in the chosen design and creates the rest", () => {
    const g = {
      ...groupFromLine(newLine({ cost: "40", cls: { ...cls, family: "f:fam1" } }), "in"),
      sizesText: "2",
      colours: ["GD", "SV"],
      cells: { [cellKey("002", "GD")]: { qty: "10" }, [cellKey("002", "SV")]: { qty: "5" } },
    };
    const lines = groupLines(g, [], {
      ...ctx,
      products: [{ id: "p-gold", family_id: "fam1", size: "002", finish: "GD" }] as never[],
    });
    expect(lines[0]).toMatchObject({ mode: "link", linkId: "p-gold" });
    expect(lines[1]).toMatchObject({ mode: "new", cls: { family: "f:fam1", finish: "SV" } });
  });

  it("keeps line ids stable across edits and removes cleanly", () => {
    const g = {
      ...groupFromLine(newLine({ cost: "40", cls }), "in"),
      sizesText: "2",
      colours: ["GD", "SV"],
      cells: { [cellKey("002", "GD")]: { qty: "10" }, [cellKey("002", "SV")]: { qty: "5" } },
    };
    const other = newLine({ desc: "other item" });
    let d = { ...newDraft(), lines: [other] };
    d = applyGroup(d, g, ctx);
    const ids = d.lines.filter((l) => l.group).map((l) => l.id);
    d = applyGroup(d, { ...g, cells: { ...g.cells, [cellKey("002", "SV")]: { qty: "7" } } }, ctx);
    expect(d.lines.filter((l) => l.group).map((l) => l.id)).toEqual(ids);
    expect(d.lines.find((l) => l.cls.finish === "SV")!.billed).toBe("7");
    d = removeGroup(d, g.id);
    expect(d.lines).toEqual([other]);
    expect(d.grids?.[g.id]).toBeUndefined();
  });
});

describe("cost by size and colour", () => {
  it("uses the cell's cost, else the size's cost, else the default", () => {
    const g = {
      ...groupFromLine(newLine({ cost: "40", cls }), "in"),
      sizesText: "2, 3",
      colours: ["GD", "SV"],
      sizeCost: { "003": "60" },
      cells: {
        [cellKey("002", "GD")]: { qty: "10", cost: "45" },
        [cellKey("002", "SV")]: { qty: "10" },
        [cellKey("003", "GD")]: { qty: "5", cost: "68" },
        [cellKey("003", "SV")]: { qty: "5" },
      },
    };
    const lines = groupLines(g, [], ctx);
    expect(lines.map((l) => `${l.cls.size}-${l.cls.finish}=${l.cost}`)).toEqual([
      "002-GD=45",
      "003-GD=68",
      "002-SV=40",
      "003-SV=60",
    ]);
  });
});
