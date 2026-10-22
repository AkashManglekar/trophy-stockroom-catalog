import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  normaliseSettings,
  type Adjustment,
  type AppSettings,
  type Family,
  type Photo,
  type Product,
  type Receipt,
  type ReceiptLine,
  type RefData,
  type Submission,
  type Vendor,
  type VendorCode,
} from "./domain";
import { computePrice, pricePayload } from "./pricing";
import { designNameProblem } from "./naming";

const STALE = 30_000;

async function all<T>(
  q: PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data ?? [];
}

export function useRefData() {
  return useQuery({
    queryKey: ["ref"],
    staleTime: STALE,
    queryFn: async (): Promise<RefData> => {
      const [divisions, types, lists, settings] = await Promise.all([
        all(supabase.from("divisions").select("*").order("sort")),
        all(supabase.from("types").select("*").order("div").order("name")),
        all(supabase.from("code_lists").select("*").order("sort")),
        supabase.from("app_settings").select("data").eq("id", 1).maybeSingle(),
      ]);
      return {
        divisions,
        types,
        materials: lists.filter((x) => x.kind === "material"),
        sports: lists.filter((x) => x.kind === "sport"),
        finishes: lists.filter((x) => x.kind === "finish"),
        sizes: lists.filter((x) => x.kind === "apparel_size"),
        settings: normaliseSettings(settings.data?.data),
      };
    },
  });
}

export const useProducts = () =>
  useQuery({
    queryKey: ["products"],
    staleTime: STALE,
    queryFn: () => all<Product>(supabase.from("products").select("*").order("code")),
  });
export const useFamilies = () =>
  useQuery({
    queryKey: ["families"],
    staleTime: STALE,
    queryFn: () => all<Family>(supabase.from("design_families").select("*")),
  });
export const useVendors = () =>
  useQuery({
    queryKey: ["vendors"],
    staleTime: STALE,
    queryFn: () => all<Vendor>(supabase.from("vendors").select("*").order("code")),
  });
export const usePhotos = () =>
  useQuery({
    queryKey: ["photos"],
    staleTime: STALE,
    queryFn: () =>
      all<Photo>(
        supabase
          .from("product_photos")
          .select("*")
          .order("is_main", { ascending: false })
          .order("sort")
          .order("created_at"),
      ),
  });
export const useVendorCodes = () =>
  useQuery({
    queryKey: ["vendor_codes"],
    staleTime: STALE,
    queryFn: () => all<VendorCode>(supabase.from("vendor_codes").select("*")),
  });
export const useReceipts = () =>
  useQuery({
    queryKey: ["receipts"],
    staleTime: STALE,
    queryFn: async () => {
      const receipts = await all<Receipt>(
        supabase.from("receipts").select("*").order("created_at", { ascending: false }).limit(40),
      );
      const ids = receipts.map((r) => r.id);
      const lines = ids.length
        ? await all<ReceiptLine>(
            supabase.from("receipt_lines").select("*").in("receipt_id", ids).order("line_no"),
          )
        : [];
      return receipts.map((r) => ({ ...r, lines: lines.filter((l) => l.receipt_id === r.id) }));
    },
  });
/** Bills submitted for approval: approvers see everyone's, others see their own. */
export const useSubmissions = (enabled = true) =>
  useQuery({
    queryKey: ["submissions"],
    enabled,
    staleTime: 15_000,
    refetchInterval: 60_000,
    queryFn: () =>
      all<Submission>(
        supabase
          .from("bill_submissions")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(60),
      ),
  });
export const useAdjustments = (productId: string | null) =>
  useQuery({
    queryKey: ["adjustments", productId],
    enabled: !!productId,
    queryFn: () =>
      all<Adjustment>(
        supabase
          .from("adjustments")
          .select("*")
          .eq("product_id", productId!)
          .order("created_at", { ascending: false })
          .limit(20),
      ),
  });

/** Photos grouped by product, main photo first. */
export function usePhotoMap() {
  const q = usePhotos();
  return useMemo(() => {
    const m = new Map<string, Photo[]>();
    for (const p of q.data ?? []) {
      const list = m.get(p.product_id) ?? [];
      list.push(p);
      m.set(p.product_id, list);
    }
    return m;
  }, [q.data]);
}

/** Short-lived signed URLs for private photos, fetched in one batch. */
export function useSignedUrls(paths: string[]) {
  const key = useMemo(() => [...new Set(paths.filter(Boolean))].sort(), [paths]);
  const q = useQuery({
    queryKey: ["signed", key],
    enabled: key.length > 0,
    staleTime: 50 * 60_000,
    queryFn: async () => {
      const out: Record<string, string> = {};
      for (let i = 0; i < key.length; i += 100) {
        const { data, error } = await supabase.storage
          .from("media")
          .createSignedUrls(key.slice(i, i + 100), 3600);
        if (error) throw error;
        for (const d of data ?? []) if (d.path && d.signedUrl) out[d.path] = d.signedUrl;
      }
      return out;
    },
  });
  return q.data ?? {};
}

export function useInvalidate() {
  const qc = useQueryClient();
  return (...keys: string[]) =>
    Promise.all(keys.map((k) => qc.invalidateQueries({ queryKey: [k] })));
}

export async function saveSettings(next: AppSettings) {
  const { error } = await supabase
    .from("app_settings")
    .update({ data: next, updated_at: new Date().toISOString() })
    .eq("id", 1);
  if (error) throw new Error(error.message);
}

/** Recomputes stored prices for products whose computed price changed. Returns the number updated. */
export async function repriceProducts(products: Product[], ref: RefData): Promise<number> {
  let n = 0;
  for (const p of products) {
    const d = ref.divisions.find((x) => x.code === p.div);
    const t = ref.types.find((x) => x.div === p.div && x.code === p.type);
    if (!d || !t) continue;
    const r = computePrice({
      unitCost: p.unit_cost,
      division: d,
      type: t,
      settings: ref.settings,
      mode: p.price_mode,
      value: p.price_value,
    });
    const pl = pricePayload(r);
    const same =
      p.landed === pl.landed &&
      p.selling === pl.selling &&
      p.mrp === pl.mrp &&
      p.floor_price === pl.floor &&
      p.bulk_price === pl.bulk &&
      p.gst === pl.gst &&
      p.price_rule === pl.rule;
    if (same) continue;
    const { error } = await supabase
      .from("products")
      .update({
        landed: pl.landed,
        selling: pl.selling,
        mrp: pl.mrp,
        floor_price: pl.floor,
        bulk_price: pl.bulk,
        bulk_min_qty: pl.bulk_min,
        gst: pl.gst,
        price_rule: pl.rule,
        updated_at: new Date().toISOString(),
      })
      .eq("id", p.id);
    if (error) throw new Error(error.message);
    n++;
  }
  return n;
}

export function priceFor(
  p: Pick<Product, "div" | "type" | "unit_cost" | "price_mode" | "price_value">,
  ref: RefData,
) {
  const d = ref.divisions.find((x) => x.code === p.div);
  const t = ref.types.find((x) => x.div === p.div && x.code === p.type);
  if (!d || !t) return null;
  return computePrice({
    unitCost: p.unit_cost,
    division: d,
    type: t,
    settings: ref.settings,
    mode: p.price_mode,
    value: p.price_value,
  });
}

/** Reasons a product needs attention (empty when fine). */
export function attentionReasons(
  p: Product,
  ref: RefData,
  families: Family[],
  photoCount: number,
): string[] {
  if (p.status === "Discontinued" || p.status === "Archived") return [];
  const t = ref.types.find((x) => x.div === p.div && x.code === p.type);
  const fam = families.find((f) => f.id === p.family_id);
  const out: string[] = [];
  if (designNameProblem(fam?.design_name ?? "", ref, !!t?.is_service)) out.push("name");
  if (p.unit_cost == null) out.push("cost");
  if (!t?.is_service) {
    if (!p.location) out.push("location");
    if (!photoCount) out.push("photo");
    if ((p.reorder_point ?? 0) > 0 && p.stock <= (p.reorder_point ?? 0)) out.push("low stock");
  }
  if (p.selling != null && p.landed != null && p.selling <= p.landed) out.push("below cost");
  return out;
}

export function errMsg(e: unknown) {
  if (e && typeof e === "object" && "message" in e)
    return String((e as { message: string }).message);
  return String(e);
}
