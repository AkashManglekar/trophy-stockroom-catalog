import { createServerFn } from "@tanstack/react-start";
import { stripTax } from "@/lib/naming";

export type CatalogueVariant = { label: string; price: number; sku: string };
export type CatalogueItem = {
  /** Design code, shared by all sizes. */
  code: string;
  name: string;
  /** Lowest price across sizes. */
  price: number;
  maxPrice: number;
  /** Sizes (and finishes) with their prices, smallest first. */
  variants: CatalogueVariant[];
  description: string;
  group: string;
  /** Cached photo addresses (full size). Add `?w=t` for the small copy. */
  photos: string[];
};
export type CatalogueData = { items: CatalogueItem[]; updatedAt: string };

// Warm workers reuse the last answer for a short while so busy moments don't hit the database
// on every visit. Stockroom changes show up within this window.
const TTL_MS = 60_000;
let memo: { at: number; data: CatalogueData } | null = null;

/** Public, read-only catalogue: one database call, no internal fields. */
export const getCatalogue = createServerFn({ method: "GET" }).handler(
  async (): Promise<CatalogueData> => {
    if (memo && Date.now() - memo.at < TTL_MS) return memo.data;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin.rpc("get_catalogue");
    if (error) {
      if (memo) return memo.data; // serve the last good copy rather than an error
      throw new Error("Catalogue is unavailable right now.");
    }
    const out: CatalogueData = {
      items: (data ?? []).map((r) => {
        const variants = ((r.variants as CatalogueVariant[] | null) ?? []).map((v) => ({
          label: String(v.label ?? ""),
          price: Number(v.price),
          sku: String(v.sku ?? ""),
        }));
        const prices = variants.map((v) => v.price).filter((n) => Number.isFinite(n));
        return {
          code: r.code,
          name: r.name,
          price: prices.length ? Math.min(...prices) : Number(r.price),
          maxPrice: prices.length ? Math.max(...prices) : Number(r.price),
          variants,
          description: stripTax(r.description),
          group: r.type_name,
          photos: (r.photos ?? []).filter(Boolean).map((p) => `/media/${p}`),
        };
      }),
      updatedAt: new Date().toISOString(),
    };
    memo = { at: Date.now(), data: out };
    return out;
  },
);
