import type { CodeItem, Division, ProductType, RefData } from "./domain";

export const slug = (s: string) =>
  String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
export const pad3 = (n: number | string) => String(n).padStart(3, "0");

/** Stored size: 3-digit number for in/mm/ft/W, size code for apparel, 000 when the type has no size. */
export function normaliseSize(raw: string | number | null | undefined, unit: string): string {
  if (unit === "none") return "000";
  const s = String(raw ?? "").trim();
  if (!s) return "";
  if (unit === "size") return s.toUpperCase();
  const digits = s.replace(/[^0-9.]/g, "");
  const n = Number(digits);
  if (!digits || !Number.isFinite(n)) return s.toUpperCase();
  // Whole sizes stay 3 digits (12 → "012"); fractions keep up to 2 decimals (2.5 → "002.5").
  const r = Math.round(n * 100) / 100;
  const whole = Math.floor(r);
  const frac = String(Math.round((r - whole) * 100))
    .padStart(2, "0")
    .replace(/0+$/, "");
  return frac ? `${pad3(whole)}.${frac}` : pad3(whole);
}

export function sizeLabel(size: string, unit: string, sizes: CodeItem[]): string {
  if (!size || unit === "none" || size === "000") return "";
  if (unit === "size") return sizes.find((x) => x.code === size)?.name ?? size;
  const n = Number(size);
  return `${Number.isFinite(n) ? n : size}${unit}`;
}

/** Size part of a SKU, mirroring the database: 011 (in) → "11", apparel LRG → "L", none → "". */
export function sizeTag(size: string, unit: string, sizes: CodeItem[]): string {
  if (unit === "none" || !size || size === "000") return "";
  if (unit === "size")
    return (sizes.find((x) => x.code === size)?.name ?? size)
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "");
  const t = size.replace(/^0+/, "");
  return t.startsWith(".") ? `0${t}` : t || "0";
}

/** Variant SKU: design code + size, plus finish only if that size already exists in another finish. */
export function variantSku(
  base: string,
  size: string,
  unit: string,
  finish: string,
  sizes: CodeItem[],
  taken: Set<string>,
  /** Type keeps each colour as its own variant (medals): the colour is always in the SKU. */
  byColour = false,
): string {
  const t = sizeTag(size, unit, sizes);
  const v = t ? `${base}-${t}` : base;
  if (byColour && finish && finish !== "NA") return `${v}-${finish}`;
  return taken.has(v) ? `${v}-${finish || "NA"}` : v;
}

export function friendlyName(
  designName: string,
  size: string,
  unit: string,
  finish: string,
  ref: Pick<RefData, "sizes" | "finishes">,
): string {
  const parts = [designName.trim()];
  const sl = sizeLabel(size, unit, ref.sizes);
  if (sl) parts.push(sl);
  if (finish && finish !== "NA")
    parts.push(ref.finishes.find((f) => f.code === finish)?.name ?? finish);
  return parts.filter(Boolean).join(" · ");
}

export function specCode(
  div: string,
  type: string,
  mat: string,
  sport: string,
  designNo: number,
  size: string,
  finish: string,
) {
  return [div, type, mat, sport, pad3(designNo), size || "000", finish || "NA"].join("-");
}

const GENERIC = new Set(
  "trophy trophies award awards the and of with for sports sport item product set series model design type new plain standard std size colour color".split(
    " ",
  ),
);

export function categoryWords(ref: RefData): Set<string> {
  const w = new Set(GENERIC);
  for (const list of [
    ref.types,
    ref.divisions,
    ref.materials,
    ref.sports,
    ref.finishes,
    ref.sizes,
  ] as { name: string }[][])
    for (const x of list) for (const t of slug(x.name).split(" ")) if (t) w.add(t);
  return w;
}

/** Returns a problem message, or null when the design name is acceptable. */
export function designNameProblem(name: string, ref: RefData, isService: boolean): string | null {
  if (isService) return null;
  const n = String(name || "").trim();
  if (!n) return "Give this design a name (e.g. Aurora, Titan Cup)";
  const cw = categoryWords(ref);
  const words = slug(n).split(" ").filter(Boolean);
  if (!words.some((w) => !cw.has(w) && !/^\d+(in|mm|ft|w|cm)?$/.test(w)))
    return `"${n}" is only category words — use a distinctive design name`;
  return null;
}

const TAXW = "HSN|SAC|GSTIN|GST|IGST|CGST|SGST";
/** Removes tax references (HSN/SAC/GST…) from customer-facing text. */
export function stripTax(d: string | null | undefined): string {
  return String(d || "")
    .replace(
      new RegExp(
        `\\b(incl\\.?|inclusive|excl\\.?|exclusive|plus)\\s*(of\\s+)?(${TAXW}|taxes|tax)\\b`,
        "gi",
      ),
      " ",
    )
    .replace(new RegExp(`\\s*[\\(\\[][^\\)\\]]*\\b(${TAXW})\\b[^\\)\\]]*[\\)\\]]`, "gi"), " ")
    .replace(
      new RegExp(
        `\\b(${TAXW})\\b[\\s:#.-]*(code|no\\.?|number|rate)?[\\s:#@.-]*([0-9][0-9A-Z]*\\s*%?)?`,
        "gi",
      ),
      " ",
    )
    .replace(/\s*,\s*(,\s*)+/g, ", ")
    .replace(/\s+([,.;])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s,;·.-]+|[\s,;·-]+$/g, "")
    .trim();
}

export function publicPrefix(div: Division | undefined, type: ProductType | undefined) {
  return div && type ? div.letter + type.letter : "";
}

export function normDesc(desc: string) {
  return slug(desc).slice(0, 80);
}
export function matchKey(vendorItemCode: string, desc: string) {
  const c = String(vendorItemCode || "").trim();
  if (c) return "c:" + c.toLowerCase();
  const d = normDesc(desc);
  return d ? "d:" + d : "";
}
