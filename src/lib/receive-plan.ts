import type { Draft, DraftLine } from "./draft";
import type { Family, Product, ProductSource, RefData, Vendor, VendorCode } from "./domain";
import { num } from "./domain";
import { computePrice, type PriceResult } from "./pricing";
import {
  designNameProblem,
  friendlyName,
  matchKey,
  normaliseSize,
  publicPrefix,
  slug,
  specCode,
  variantSku,
} from "./naming";

export type LinePlan = {
  kind: "known" | "link" | "new";
  productId?: string | undefined;
  matchBy?: "code" | "vendor" | undefined;
  errors: string[];
  warns: string[];
  received: number | null;
  preview?: {
    /** Variant SKU, e.g. TC-1005-14. */
    code: string;
    /** Design code shared by all sizes, e.g. TC-1005. */
    base: string;
    /** True when this adds a size to a design that already has a code. */
    newSize: boolean;
    friendly: string;
    spec: string;
    price: PriceResult;
    designNo: number;
    designName: string;
    familyMode: "new" | "existing" | "same";
    familyId?: string | undefined;
    sameAs?: number | undefined;
    renameFamily?: boolean;
    size: string;
  };
  twin?: string | undefined; // product id with same spec
};

export type PlanCtx = {
  ref: RefData;
  products: Product[];
  families: Family[];
  vendorCodes: VendorCode[];
  counters: Record<string, number>;
  /** Each vendor's latest price per product: a product is priced on the lowest. */
  sources?: ProductSource[] | undefined;
  vendors?: Vendor[] | undefined;
};

export function findMatch(
  line: DraftLine,
  vendorId: string,
  ctx: PlanCtx,
): { productId: string; by: "code" | "vendor" } | null {
  if (line.unmap) return null;
  const own = line.vitem.trim().toUpperCase();
  if (own) {
    const p =
      ctx.products.find((x) => x.code === own) ??
      ctx.products.find((x) => (x.alias_codes ?? []).includes(own));
    if (p) return { productId: p.id, by: "code" };
  }
  if (vendorId && vendorId !== "NEW") {
    const key = matchKey(line.vitem, line.desc);
    const vc = key
      ? ctx.vendorCodes.find((v) => v.vendor_id === vendorId && v.match_key === key)
      : undefined;
    if (vc && ctx.products.some((p) => p.id === vc.product_id))
      return { productId: vc.product_id, by: "vendor" };
  }
  return null;
}

export function planDraft(d: Draft, ctx: PlanCtx): Record<string, LinePlan> {
  const { ref } = ctx;
  const plans: Record<string, LinePlan> = {};
  const serial: Record<string, number> = { ...ctx.counters };
  const alloc = chargeAllocation(d).perUnit;
  const takenSkus = new Set(ctx.products.map((p) => p.code));
  const designMax: Record<string, number> = {};
  for (const f of ctx.families) {
    const k = [f.div, f.type, f.mat, f.sport].join("-");
    designMax[k] = Math.max(designMax[k] ?? 0, f.design_no);
  }
  const takenNames = new Map<string, string>(); // lower name -> family id
  for (const f of ctx.families)
    if (f.design_name) takenNames.set(f.design_name.trim().toLowerCase(), f.id);
  const productNames = new Set(ctx.products.map((p) => p.friendly_name.toLowerCase()));
  const productSpecs = new Map(ctx.products.map((p) => [p.spec_code, p.id]));
  const draftNames = new Map<string, number>();
  const isBill = d.type === "bill";

  d.lines.forEach((l, idx) => {
    const P: LinePlan = { kind: "new", errors: [], warns: [], received: null };
    plans[l.id] = P;
    const billed = num(l.billed);
    const received = l.received.trim() === "" ? billed : num(l.received);
    P.received = received;
    if (billed == null || billed < 0) P.errors.push("quantity");
    if (received == null || received < 0 || !Number.isInteger(received))
      P.errors.push("received quantity (whole number)");
    if (billed != null && received != null && received > billed)
      P.warns.push("received more than billed");
    const cost = num(l.cost);
    if (isBill && cost === 0) P.warns.push("unit cost is ₹0");

    const match = findMatch(l, d.vendorId, ctx);
    if (!isBill && (match || l.mode === "link")) {
      const pid = match?.productId ?? l.linkId;
      const code = ctx.products.find((x) => x.id === pid)?.code ?? "This item";
      P.kind = match ? "known" : "link";
      P.productId = pid || undefined;
      P.errors.push(`${code} already has a code — add its stock in Products → Adjust stock`);
      return;
    }
    const existingCheck = (pid: string) => {
      const p = ctx.products.find((x) => x.id === pid);
      if (!p) return;
      if (isBill && p.unit_cost && cost && Math.abs(cost - p.unit_cost) / p.unit_cost > 0.25)
        P.warns.push(
          `cost ${cost > p.unit_cost ? "up" : "down"} ${Math.round((Math.abs(cost - p.unit_cost) / p.unit_cost) * 100)}% vs current (₹${p.unit_cost})`,
        );
      if (p.status === "Discontinued") P.warns.push(`${p.code} is discontinued`);
      if (p.status === "Archived")
        P.warns.push(`${p.code} is archived — restore it on Products to sell it`);
    };
    if (match) {
      P.kind = "known";
      P.productId = match.productId;
      P.matchBy = match.by;
      existingCheck(match.productId);
      return;
    }
    if (l.mode === "link") {
      P.kind = "link";
      P.productId = l.linkId || undefined;
      if (!l.linkId || !ctx.products.some((p) => p.id === l.linkId))
        P.errors.push("pick the product to link");
      else existingCheck(l.linkId);
      return;
    }
    // new product
    const c = l.cls;
    const div = ref.divisions.find((x) => x.code === c.div);
    const type = ref.types.find((x) => x.div === c.div && x.code === c.type);
    if (cost == null) P.errors.push("unit cost");
    if (!div) P.errors.push("division");
    if (!type) P.errors.push("type");
    if (!c.mat) P.errors.push("material");
    if (!c.sport) P.errors.push("sport");
    if (!c.finish) P.errors.push("finish / colour");
    const unit = type?.size_unit ?? "none";
    const size = type ? normaliseSize(c.size, unit) : "";
    if (type && unit !== "none" && !size) P.errors.push("size");
    if (type && unit === "size" && size && !ref.sizes.some((s) => s.code === size))
      P.errors.push("size from the list");
    if (P.errors.length || !div || !type) return;

    const k = [c.div, c.type, c.mat, c.sport].join("-");
    let designNo = 0;
    let designName = c.designName.trim();
    let familyMode: "new" | "existing" | "same" = "new";
    let familyId: string | undefined;
    let sameAs: number | undefined;
    let renameFamily = false;
    let base = "";
    if (c.family.startsWith("f:")) {
      familyMode = "existing";
      familyId = c.family.slice(2);
      const f = ctx.families.find((x) => x.id === familyId);
      if (!f) {
        P.errors.push("design family not found");
        return;
      }
      designNo = f.design_no;
      base = f.code ?? "";
      if (f.design_name) designName = f.design_name;
      else renameFamily = true;
    } else if (c.family.startsWith("l:")) {
      familyMode = "same";
      const refId = c.family.slice(2);
      const refIdx = d.lines.findIndex((x) => x.id === refId);
      const rp = plans[refId];
      if (refIdx < 0 || refIdx >= idx || !rp?.preview) {
        P.errors.push("the line it copies has errors");
        return;
      }
      sameAs = refIdx + 1;
      designNo = rp.preview.designNo;
      base = rp.preview.base;
      designName = rp.preview.designName;
      familyId = rp.preview.familyId;
    } else {
      designNo = (designMax[k] ?? 0) + 1;
    }
    if (familyMode !== "same") {
      const prob = designNameProblem(designName, ref, type.is_service);
      if (prob) P.errors.push(prob);
      const owner = takenNames.get(designName.toLowerCase());
      if (designName && owner && owner !== familyId)
        P.errors.push(
          `"${designName}" already belongs to another design — pick it under Design family or choose another name`,
        );
      if (familyMode === "new" && designName) {
        const prevLine = draftNames.get(designName.toLowerCase());
        if (prevLine != null)
          P.errors.push(
            `same name as line #${prevLine} — set Design family to "Same new design as line #${prevLine}"`,
          );
      }
    }
    if (type.is_service && !designName) designName = type.name;
    const friendly = friendlyName(designName, size, unit, c.finish, ref);
    const spec = specCode(c.div, c.type, c.mat, c.sport, designNo, size, c.finish);
    if (productSpecs.has(spec)) {
      P.twin = productSpecs.get(spec);
      P.errors.push("you already stock this exact item — link it instead");
    } else if (productNames.has(friendly.toLowerCase()))
      P.errors.push(`"${friendly}" already exists — link it instead`);
    const prevSame = [...Object.values(plans)].find(
      (o) => o !== P && o.preview && o.preview.friendly.toLowerCase() === friendly.toLowerCase(),
    );
    if (prevSame) P.errors.push("duplicates another line on this receipt");
    if (P.errors.length) return;

    const prefix = publicPrefix(div, type);
    const newSize = !!base;
    if (!base) {
      const no = serial[prefix] ?? 1001;
      serial[prefix] = no + 1;
      base = `${prefix}-${no}`;
    }
    const sku = variantSku(
      base,
      size,
      unit,
      c.finish,
      ref.sizes,
      takenSkus,
      !!type.colour_variants,
    );
    takenSkus.add(sku);
    if (familyMode === "new") {
      designMax[k] = designNo;
      draftNames.set(designName.toLowerCase(), idx + 1);
    }
    const price = computePrice({
      unitCost: cost,
      division: div,
      type,
      settings: ref.settings,
      extraPerUnit: alloc?.[l.id] ?? null,
      // Selling GST follows the GST % typed on the bill line (else the type's usual rate).
      gstRate: num(l.gst),
    });
    P.preview = {
      code: sku,
      base,
      newSize,
      friendly,
      spec,
      price,
      designNo,
      designName,
      familyMode,
      familyId,
      sameAs,
      renameFamily,
      size,
    };
  });
  return plans;
}

const r2 = (x: number) => Math.round(x * 100) / 100;

/** Spreads the bill's extra charges over its lines by value (unit cost × billed quantity). Returns
 *  the charge per unit for each line, or null when the bill has no charges (estimates apply). */
export function chargeAllocation(d: Draft): {
  net: number;
  gst: number;
  perUnit: Record<string, number> | null;
} {
  const rows = (d.charges ?? []).map((c) => ({ a: num(c.amount) ?? 0, g: num(c.gst) ?? 0 }));
  const net = r2(rows.reduce((s, c) => s + c.a, 0));
  const gst = r2(rows.reduce((s, c) => s + (c.a * c.g) / 100, 0));
  if (d.type !== "bill" || net <= 0) return { net, gst, perUnit: null };
  const vals = d.lines.map((l) => {
    const c = num(l.cost);
    const q = num(l.billed);
    return { id: l.id, v: c != null && q != null && q > 0 ? c * q : 0, q: q ?? 0 };
  });
  const goods = vals.reduce((s, x) => s + x.v, 0);
  if (goods <= 0) return { net, gst, perUnit: null };
  const perUnit: Record<string, number> = {};
  for (const x of vals) perUnit[x.id] = x.q > 0 ? r2((net * x.v) / goods / x.q) : 0;
  return { net, gst, perUnit };
}

/** GST rate of a line: what was typed on the bill, else the product's / new item's usual rate. */
export function lineGstRate(l: DraftLine, P: LinePlan | undefined, ctx: PlanCtx): number {
  const typed = num(l.gst);
  if (typed != null) return typed;
  const known = P?.productId ? ctx.products.find((p) => p.id === P.productId) : undefined;
  return Number(known?.gst ?? P?.preview?.price.gst ?? 18);
}

export type GstSlab = { rate: number; taxable: number; tax: number };

/** What the bill costs the company: goods + charges + GST, with GST split by rate and by type
 *  (IGST for another state, CGST + SGST for the same state). */
export function billCosts(
  d: Draft,
  plans: Record<string, LinePlan>,
  ctx: PlanCtx,
  supply: "igst" | "intra" | null = null,
) {
  const ch = chargeAllocation(d);
  const slabs = new Map<number, GstSlab>();
  const add = (rate: number, taxable: number) => {
    const s = slabs.get(rate) ?? { rate, taxable: 0, tax: 0 };
    s.taxable += taxable;
    s.tax += (taxable * rate) / 100;
    slabs.set(rate, s);
  };
  let goods = 0;
  for (const l of d.lines) {
    const v = (num(l.cost) ?? 0) * (num(l.billed) ?? 0);
    goods += v;
    if (v > 0) add(lineGstRate(l, plans[l.id], ctx), v);
  }
  for (const c of d.charges ?? []) {
    const a = num(c.amount) ?? 0;
    if (a > 0) add(num(c.gst) ?? 0, a);
  }
  const breakup = [...slabs.values()]
    .map((x) => ({ rate: x.rate, taxable: r2(x.taxable), tax: r2(x.tax) }))
    .sort((a, b) => a.rate - b.rate);
  const gstCalculated = r2(breakup.reduce((a, x) => a + x.tax, 0));
  const typed = num(d.billGst);
  const gst = typed != null ? r2(typed) : gstCalculated;
  const type = d.gstType || supply || "intra";
  goods = r2(goods);
  return {
    goods,
    charges: ch.net,
    gst,
    gstEstimated: gstCalculated,
    gstFromBill: typed != null,
    gstType: type as "igst" | "intra",
    gstTypeAuto: !d.gstType && !!supply,
    breakup,
    total: r2(goods + ch.net + gst),
    perUnit: ch.perUnit,
  };
}

export function summarise(d: Draft, plans: Record<string, LinePlan>) {
  const s = {
    lines: d.lines.length,
    known: 0,
    link: 0,
    new: 0,
    err: 0,
    warn: 0,
    units: 0,
    value: 0,
    short: 0,
  };
  for (const l of d.lines) {
    const p = plans[l.id];
    if (!p) continue;
    s[p.kind]++;
    if (p.errors.length) s.err++;
    if (p.warns.length) s.warn++;
    s.units += p.received ?? 0;
    s.value += (num(l.cost) ?? 0) * (num(l.billed) ?? 0);
    const b = num(l.billed);
    if (p.received != null && b != null && p.received < b) s.short++;
  }
  s.value = Math.round(s.value * 100) / 100;
  return s;
}

export { slug };

/** Compares the typed bill total with the lines: before GST (goods + charges) or after GST. */
export function totalCheck(
  typed: number | null,
  beforeGst: number,
  afterGst: number | null | undefined,
): { ok: boolean; diff: number; basis: "before GST" | "incl. GST" } | null {
  if (typed == null) return null;
  const r = (x: number) => Math.round(x * 100) / 100;
  const dPre = r(typed - beforeGst);
  const dPost = afterGst != null ? r(typed - afterGst) : null;
  if (Math.abs(dPre) <= 1) return { ok: true, diff: dPre, basis: "before GST" };
  if (dPost != null && Math.abs(dPost) <= 1) return { ok: true, diff: dPost, basis: "incl. GST" };
  return dPost != null && Math.abs(dPost) < Math.abs(dPre)
    ? { ok: false, diff: dPost, basis: "incl. GST" }
    : { ok: false, diff: dPre, basis: "before GST" };
}
export function billTotalBeforeGst(
  typed: number | null,
  beforeGst: number,
  afterGst: number | null | undefined,
): number | null {
  const c = totalCheck(typed, beforeGst, afterGst);
  if (!c || typed == null) return typed;
  return c.ok && c.basis === "incl. GST" ? Math.round(beforeGst * 100) / 100 : typed;
}
