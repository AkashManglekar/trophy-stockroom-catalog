import type {
  AppSettings,
  Product,
  ProductSource,
  ProductType,
  ReorderFlag,
  Vendor,
} from "./domain";
import { num } from "./domain";

/** Vendors we no longer buy from don't set prices or get recommended. Mirrors vendor_buys_from(). */
export const buysFrom = (v: Pick<Vendor, "status"> | undefined) =>
  !!v && !["Archived", "Exited", "Paused"].includes(v.status ?? "");

export type SourceRow = ProductSource & {
  vendor: Vendor | undefined;
  /** We still buy from this vendor. */
  active: boolean;
  /** Lowest current price among active vendors: this one sets the product's cost and price. */
  best: boolean;
  /** Price plus this vendor's bill charges per unit. */
  landed: number | null;
};

/** Every vendor that has billed this product, best (lowest current price) first. */
export function sourcesFor(
  productId: string,
  sources: ProductSource[],
  vendors: Vendor[],
): SourceRow[] {
  const rows = sources
    .filter((s) => s.product_id === productId)
    .map((s) => {
      const vendor = vendors.find((v) => v.id === s.vendor_id);
      const cost = s.last_cost != null ? Number(s.last_cost) : null;
      return {
        ...s,
        vendor,
        active: buysFrom(vendor),
        best: false,
        landed: cost == null ? null : cost + Number(s.last_extra ?? 0),
      };
    })
    .sort(
      (a, b) =>
        Number(b.active) - Number(a.active) ||
        (a.last_cost ?? Infinity) - (b.last_cost ?? Infinity) ||
        String(b.last_date ?? "").localeCompare(String(a.last_date ?? "")),
    );
  const first = rows[0];
  if (first && first.active && first.last_cost != null) first.best = true;
  return rows;
}

export type Basis = {
  cost: number | null;
  extra: number | null;
  /** The vendor whose price the product is priced on. */
  vendorId: string | null;
  /** True when another vendor is cheaper than this bill, so the price stays on theirs. */
  other: boolean;
};

/**
 * What a product is priced on after this bill line: the lowest current price among the vendors we
 * buy from — this bill's price for this vendor, every other vendor's latest bill.
 */
export function pricingBasis(
  productId: string,
  vendorId: string,
  cost: number | null,
  extra: number | null,
  sources: ProductSource[],
  vendors: Vendor[],
): Basis {
  const mine: Basis = { cost, extra, vendorId: vendorId || null, other: false };
  if (cost == null) return mine;
  let best = mine;
  for (const s of sources) {
    if (s.product_id !== productId || s.vendor_id === vendorId || s.last_cost == null) continue;
    if (!buysFrom(vendors.find((v) => v.id === s.vendor_id))) continue;
    const c = Number(s.last_cost);
    const e = s.last_extra != null ? Number(s.last_extra) : null;
    if (best.cost == null || c < best.cost || (c === best.cost && (e ?? 0) < (best.extra ?? 0)))
      best = { cost: c, extra: e, vendorId: s.vendor_id, other: true };
  }
  return best;
}

// ---------------------------------------------------------------------------------------------
// Low-stock reminders
// ---------------------------------------------------------------------------------------------

export const typeKey = (p: Pick<Product, "div" | "type">) => `${p.div}:${p.type}`;

/** The stock level that triggers a reminder. Product's own level wins; blank = category's; 0 = off. */
export function reorderLevel(
  p: Pick<Product, "div" | "type" | "reorder_point">,
  settings: Pick<AppSettings, "reorder">,
): { level: number; from: "product" | "category" } | null {
  if (p.reorder_point != null)
    return p.reorder_point > 0 ? { level: p.reorder_point, from: "product" } : null;
  const r = settings.reorder[typeKey(p)];
  return r && r.low > 0 ? { level: r.low, from: "category" } : null;
}

/** How many to order to get back to the category's "order up to" (default: twice the level). */
export function suggestQty(
  p: Pick<Product, "div" | "type" | "reorder_point" | "stock">,
  settings: Pick<AppSettings, "reorder">,
  moq?: string | number | null,
): number {
  const lv = reorderLevel(p, settings);
  if (!lv) return 0;
  const upTo = Number(settings.reorder[typeKey(p)]?.upTo ?? 0);
  const target = upTo > lv.level ? upTo : lv.level * 2;
  const need = Math.max(1, target - Math.max(0, p.stock));
  const min = num(moq ?? null) ?? 0;
  return Math.max(need, min > 0 ? Math.ceil(min) : 0);
}

export function isLow(
  p: Product,
  settings: Pick<AppSettings, "reorder">,
  type: Pick<ProductType, "is_service"> | undefined,
): boolean {
  if (p.status === "Archived" || p.status === "Discontinued" || p.status === "Draft") return false;
  if (type?.is_service) return false;
  const lv = reorderLevel(p, settings);
  return !!lv && p.stock <= lv.level;
}

export type FlagView = "ordered" | "ignored" | null;

/**
 * Whether a dashboard decision still holds. "Ignored" lasts until its date. "Ordered" lasts until a
 * bill for the product arrives after the decision (or 60 days pass without one).
 */
export function flagView(
  f: ReorderFlag | undefined,
  lastReceived: string | null | undefined,
  now = Date.now(),
): FlagView {
  if (!f) return null;
  const today = new Date(now).toISOString().slice(0, 10);
  if (f.state === "ignored") return !f.until || f.until >= today ? "ignored" : null;
  if (lastReceived && Date.parse(lastReceived) > Date.parse(f.created_at)) return null;
  return now - Date.parse(f.created_at) <= 60 * 86_400_000 ? "ordered" : null;
}

/** When stock last came in on a bill, per product. */
export function lastReceivedBy(sources: ProductSource[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const s of sources) {
    if (!s.product_id || !s.received_at) continue;
    const cur = m.get(s.product_id);
    if (!cur || s.received_at > cur) m.set(s.product_id, s.received_at);
  }
  return m;
}
