import type { Draft, DraftLine } from "./draft";
import { newLine, uid } from "./draft";
import type { CodeItem, Product } from "./domain";
import { normaliseSize, sizeLabel, sizeTag } from "./naming";
import { num } from "./domain";

/**
 * One bill entry for a design bought in several sizes and/or colours (medals 2"/2.5"/3" in
 * Gold/Silver/Bronze…). The group holds the shared details and a quantity (and optional cost)
 * per size × colour; it expands into one ordinary bill line per variant, so codes, stock,
 * pricing, GST and charges work exactly as for single lines.
 */
export type VariantCell = { qty: string; cost?: string | undefined; received?: string | undefined };
export type VariantGroup = {
  id: string;
  vitem: string;
  desc: string;
  location: string;
  gst?: string | undefined;
  /** Default unit cost: used where neither the size nor the cell has its own. */
  cost: string;
  /** Unit cost per size (applies to every colour of that size unless the cell has its own). */
  sizeCost?: Record<string, string> | undefined;
  cls: DraftLine["cls"];
  /** Sizes as typed ("2, 2.5, 3") for in/mm/ft; apparel size codes joined by commas. */
  sizesText: string;
  /** Finish codes; empty = the design comes in one colour (cls.finish). */
  colours: string[];
  cells: Record<string, VariantCell>;
  /** @deprecated cost per cell is always available now. */
  perCellCost?: boolean | undefined;
  perCellReceived?: boolean | undefined;
};

export type GridCtx = {
  unit: string;
  apparelSizes: CodeItem[];
  finishes: CodeItem[];
  products: Pick<Product, "id" | "family_id" | "size" | "finish">[];
};

export const cellKey = (size: string, finish: string) => `${size}|${finish}`;

/** Unit cost of one variant: its own cell cost, else its size's cost, else the default. */
export function variantCost(
  g: Pick<VariantGroup, "cells" | "sizeCost" | "cost">,
  size: string,
  finish: string,
): string {
  return (
    g.cells[cellKey(size, finish)]?.cost?.trim() || g.sizeCost?.[size]?.trim() || g.cost.trim()
  );
}

/** Stored sizes in the order typed, duplicates removed. */
export function groupSizes(g: Pick<VariantGroup, "sizesText">, unit: string): string[] {
  if (unit === "none") return ["000"];
  const parts = g.sizesText
    .split(/[,;\n]+|\s{2,}/)
    .flatMap((x) => (unit === "size" ? [x] : x.trim().split(/\s+/)))
    .map((x) => x.trim())
    .filter(Boolean);
  return [...new Set(parts.map((x) => normaliseSize(x, unit)).filter(Boolean))];
}
export const groupColours = (g: Pick<VariantGroup, "colours" | "cls">) =>
  g.colours.length ? g.colours : [g.cls.finish || ""];

/** Start a group from a single line: its size/colour become the first cell. */
export function groupFromLine(l: DraftLine, unit: string): VariantGroup {
  const size = l.cls.size ? normaliseSize(l.cls.size, unit) : "";
  const sizeText = size && unit !== "none" ? sizeLabel(size, unit, []).replace(unit, "") : "";
  return {
    id: uid(),
    vitem: l.vitem,
    desc: l.desc,
    location: l.location,
    gst: l.gst,
    cost: l.cost,
    cls: { ...l.cls, size: "" },
    sizesText: unit === "size" ? l.cls.size : sizeText,
    colours: l.cls.finish ? [l.cls.finish] : [],
    cells:
      l.billed && (size || unit === "none")
        ? { [cellKey(unit === "none" ? "000" : size, l.cls.finish)]: { qty: l.billed } }
        : {},
  };
}

/** The bill lines this group stands for, reusing ids of existing members so edits stay stable. */
export function groupLines(g: VariantGroup, members: DraftLine[], ctx: GridCtx): DraftLine[] {
  const byKey = new Map(members.map((m) => [cellKey(m.cls.size, m.cls.finish), m]));
  const famId = g.cls.family.startsWith("f:") ? g.cls.family.slice(2) : null;
  const out: DraftLine[] = [];
  for (const finish of groupColours(g))
    for (const size of groupSizes(g, ctx.unit)) {
      const cell = g.cells[cellKey(size, finish)];
      if (!cell || !(num(cell.qty) ?? 0)) continue;
      const tag = sizeTag(size, ctx.unit, ctx.apparelSizes);
      const label = [
        sizeLabel(size, ctx.unit, ctx.apparelSizes),
        g.colours.length > 1 || g.colours.length === 1
          ? (ctx.finishes.find((f) => f.code === finish)?.name ?? finish)
          : "",
      ]
        .filter(Boolean)
        .join(" ");
      const existing = famId
        ? ctx.products.find((p) => p.family_id === famId && p.size === size && p.finish === finish)
        : undefined;
      const first = out.find((x) => x.mode === "new");
      const family = g.cls.family === "new" && first ? `l:${first.id}` : g.cls.family;
      const prev = byKey.get(cellKey(size, finish));
      out.push(
        newLine({
          id: prev?.id ?? uid(),
          group: g.id,
          vitem: g.vitem.trim() ? [g.vitem.trim(), tag, finish].filter(Boolean).join("-") : "",
          desc: [g.desc.trim(), label].filter(Boolean).join(" · "),
          billed: cell.qty,
          received: g.perCellReceived ? (cell.received ?? "") : "",
          cost: variantCost(g, size, finish),
          location: g.location,
          gst: g.gst,
          mode: existing ? "link" : "new",
          linkId: existing?.id ?? "",
          ...(prev?.ai ? { ai: true } : {}),
          cls: {
            ...g.cls,
            size,
            finish,
            family: existing ? g.cls.family : family,
            designName: family.startsWith("l:") ? "" : g.cls.designName,
          },
        }),
      );
    }
  return out;
}

/** Replace the group's members in the draft (kept where the group sits on the bill). */
export function applyGroup(d: Draft, g: VariantGroup, ctx: GridCtx): Draft {
  const members = d.lines.filter((l) => l.group === g.id);
  const fresh = groupLines(g, members, ctx);
  const at = d.lines.findIndex((l) => l.group === g.id);
  const rest = d.lines.filter((l) => l.group !== g.id);
  const pos = at < 0 ? rest.length : d.lines.slice(0, at).filter((l) => l.group !== g.id).length;
  const lines = [...rest.slice(0, pos), ...fresh, ...rest.slice(pos)];
  return { ...d, lines, grids: { ...(d.grids ?? {}), [g.id]: g } };
}

export function removeGroup(d: Draft, id: string): Draft {
  const grids = { ...(d.grids ?? {}) };
  delete grids[id];
  return { ...d, lines: d.lines.filter((l) => l.group !== id), grids };
}
