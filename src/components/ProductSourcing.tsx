import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { Link2, Star } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { inr, num, type Product, type RefData } from "@/lib/domain";
import {
  errMsg,
  repriceProducts,
  useInvalidate,
  useReviews,
  useSources,
  useVendorCodes,
  useVendors,
} from "@/lib/data";
import { sourcesFor, type SourceRow } from "@/lib/sourcing";
import { Code, Field, Pill, TextInput } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const H = "text-xs font-extrabold uppercase tracking-[0.1em] text-muted-foreground";
const fmtDate = (d: string | null | undefined) =>
  d
    ? new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "2-digit" })
    : "—";

/** Average of a vendor's quality / delivery / pricing reviews (1–5), or null. */
export function useVendorRatings(): Map<string, { avg: number; n: number }> {
  const reviews = useReviews();
  return useMemo(() => {
    const acc = new Map<string, { sum: number; n: number }>();
    for (const r of reviews.data ?? []) {
      const parts = [r.quality, r.delivery, r.pricing].filter((x): x is number => x != null);
      if (!parts.length) continue;
      const a = acc.get(r.vendor_id) ?? { sum: 0, n: 0 };
      a.sum += parts.reduce((x, y) => x + y, 0) / parts.length;
      a.n += 1;
      acc.set(r.vendor_id, a);
    }
    return new Map([...acc].map(([k, v]) => [k, { avg: v.sum / v.n, n: v.n }]));
  }, [reviews.data]);
}

/** Who to buy from next: the lowest current price among vendors we buy from; ties go to the
 *  better-rated, then the faster one. */
export function bestNext(
  rows: SourceRow[],
  ratings: Map<string, { avg: number; n: number }>,
): SourceRow | undefined {
  return rows
    .filter((r) => r.active && r.last_cost != null)
    .sort(
      (a, b) =>
        Number(a.last_cost) - Number(b.last_cost) ||
        (ratings.get(b.vendor_id ?? "")?.avg ?? 0) - (ratings.get(a.vendor_id ?? "")?.avg ?? 0) ||
        (a.vendor?.lead_time_days ?? 99) - (b.vendor?.lead_time_days ?? 99),
    )[0];
}

/** Product page: every vendor that supplies this product, and the one to buy from next. */
export function ProductSourcing({ p }: { p: Product }) {
  const sources = useSources();
  const vendors = useVendors();
  const vcodes = useVendorCodes();
  const ratings = useVendorRatings();
  const rows = sourcesFor(p.id, sources.data ?? [], vendors.data ?? []);
  // Vendor codes mapped to this product without a bill yet (e.g. linked but not billed).
  const mappedOnly = (vcodes.data ?? []).filter(
    (c) => c.product_id === p.id && !rows.some((r) => r.vendor_id === c.vendor_id),
  );
  const next = bestNext(rows, ratings);
  const codeOf = (r: SourceRow) =>
    r.vendor_code ??
    (vcodes.data ?? []).find((c) => c.product_id === p.id && c.vendor_id === r.vendor_id)
      ?.vendor_item_code ??
    null;

  return (
    <section className="grid gap-2">
      <h4 className={H}>
        Sourcing · {rows.length + mappedOnly.length} vendor
        {rows.length + mappedOnly.length === 1 ? "" : "s"}
      </h4>
      {next && (
        <div className="rounded-xl bg-success/10 p-3 text-sm">
          <span className="text-[11px] font-bold uppercase tracking-wide text-success">
            Best to order from next
          </span>
          <p className="mt-0.5">
            <b>{next.vendor?.display_name}</b> at {inr(next.last_cost)}
            {next.last_extra != null ? ` + ${inr(next.last_extra)} charges` : ""}
            {next.vendor?.lead_time_days ? ` · ${next.vendor.lead_time_days} days lead time` : ""}
            {next.vendor?.moq ? ` · MOQ ${next.vendor.moq}` : ""}
            {ratings.get(next.vendor_id ?? "") ? (
              <span className="ml-1 inline-flex items-center gap-0.5 text-muted-foreground">
                · <Star className="size-3 fill-current" />
                {ratings.get(next.vendor_id ?? "")!.avg.toFixed(1)}
              </span>
            ) : null}
          </p>
          {rows.filter((r) => r.active && r.last_cost != null).length > 1 && (
            <p className="text-xs text-muted-foreground">
              Lowest current price of the vendors you buy from — it also sets this product's cost
              and selling price.
            </p>
          )}
        </div>
      )}
      {rows.length ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10.5px] uppercase tracking-wide text-muted-foreground">
                <th className="py-1 pr-2 font-semibold">Vendor</th>
                <th className="py-1 pr-2 font-semibold">Their code</th>
                <th className="py-1 pr-2 text-right font-semibold">Latest</th>
                <th className="py-1 text-right font-semibold">Bought</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.vendor_id}
                  className={cn("border-t align-top", !r.active && "opacity-60")}
                >
                  <td className="py-1.5 pr-2">
                    <Link
                      to="/vendors"
                      search={{ sel: r.vendor_id ?? "" }}
                      className="font-medium hover:underline"
                    >
                      {r.vendor?.display_name ?? "Vendor"}
                    </Link>
                    <span className="mt-0.5 flex flex-wrap gap-1">
                      {r.best && <Pill tone="ok">sets price</Pill>}
                      {!r.active && <Pill>{r.vendor?.status ?? "inactive"}</Pill>}
                    </span>
                  </td>
                  <td className="py-1.5 pr-2">{codeOf(r) ? <Code>{codeOf(r)}</Code> : "—"}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">
                    {inr(r.last_cost)}
                    <span className="block text-[11px] text-muted-foreground">
                      {fmtDate(r.last_date)}
                      {r.avg_cost != null && Number(r.avg_cost) !== Number(r.last_cost)
                        ? ` · avg ${inr(r.avg_cost)}`
                        : ""}
                    </span>
                  </td>
                  <td className="py-1.5 text-right tabular-nums">
                    {r.units}
                    <span className="block text-[11px] text-muted-foreground">
                      {r.bills} bill{r.bills === 1 ? "" : "s"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          Not bought on a vendor bill yet. When another vendor bills this item, pick{" "}
          <b>Same as an existing product</b> on Receive — it stays one product with both vendors
          listed here.
        </p>
      )}
      {mappedOnly.map((c) => (
        <p key={c.id} className="text-xs text-muted-foreground">
          {vendors.data?.find((v) => v.id === c.vendor_id)?.display_name}:{" "}
          {c.vendor_item_code ? <Code>{c.vendor_item_code}</Code> : "description match"} maps here
          {c.last_cost != null ? ` · last ${inr(c.last_cost)}` : ""}
        </p>
      ))}
    </section>
  );
}

/**
 * Editors: the same item ended up with two codes (e.g. one per vendor). Moves this product's stock,
 * bills, vendor prices, photos and sales onto the other code; this code keeps working as an alias.
 */
export function LinkToProduct({
  p,
  products,
  ref_,
  onDone,
}: {
  p: Product;
  products: Product[];
  ref_: RefData;
  onDone: (intoId: string) => void;
}) {
  const inv = useInvalidate();
  const [q, setQ] = useState("");
  const [sure, setSure] = useState(false);
  const [busy, setBusy] = useState(false);
  const code = (q.split(" ")[0] ?? "").trim().toUpperCase();
  const target = products.find((x) => x.code === code && x.id !== p.id);
  const sameKind = target && target.div === p.div && target.type === p.type;

  async function run() {
    if (!target) return;
    if (!sure) {
      setSure(true);
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.rpc("merge_products", { p_from: p.id, p_into: target.id });
      if (error) throw new Error(error.message);
      const fresh = await supabase.from("products").select("*").eq("id", target.id);
      if (fresh.data) await repriceProducts(fresh.data, ref_);
      toast.success(
        `${p.code} is now part of ${target.code} — ${p.stock} moved, old code kept as alias`,
      );
      await inv(
        "products",
        "families",
        "photos",
        "vendor_codes",
        "receipts",
        "sales",
        "reorder_flags",
      );
      onDone(target.id);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
      setSure(false);
    }
  }

  return (
    <section className="grid gap-2 rounded-xl border border-dashed p-3">
      <h4 className={H}>
        <Link2 className="mr-1 inline size-3.5" />
        Same item as another code?
      </h4>
      <p className="text-xs text-muted-foreground">
        If this item already exists under another code (say each vendor's bill made its own), link
        it there. <b>{p.code}</b>'s {p.stock} in stock, bills, vendor prices, photos and sales move
        to that product, the catalogue shows one product, and <b>{p.code}</b> still finds it (in
        Zoho and on bills). {p.code} itself is removed — this can't be undone.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Product to keep" className="min-w-[220px] flex-1">
          <TextInput
            list={`merge-${p.id}`}
            value={q}
            placeholder="type a code or name"
            onChange={(e) => {
              setQ(e.target.value);
              setSure(false);
            }}
          />
          <datalist id={`merge-${p.id}`}>
            {products
              .filter((x) => x.id !== p.id && x.status !== "Archived")
              .map((x) => (
                <option key={x.id} value={`${x.code} · ${x.friendly_name}`} />
              ))}
          </datalist>
        </Field>
        <Button
          size="sm"
          variant={sure ? "destructive" : "outline"}
          className="rounded-full"
          disabled={!target || busy}
          onClick={run}
          onBlur={() => setSure(false)}
        >
          {busy ? "Linking…" : sure ? `Tap again: move ${p.code} into ${target?.code}` : "Link"}
        </Button>
      </div>
      {target && (
        <p className="text-xs">
          Keeps <Code>{target.code}</Code> {target.friendly_name} · {target.stock} in stock →{" "}
          <b>{target.stock + p.stock}</b> after linking.
          {!sameKind && (
            <span className="ml-1 font-semibold text-warning-foreground dark:text-warning">
              Different product type — check it's really the same item.
            </span>
          )}
        </p>
      )}
    </section>
  );
}

/** Low-stock level on the product page: blank follows the category, 0 turns reminders off. */
export function ReorderLevelField({
  p,
  ref_,
  ro,
  onSave,
}: {
  p: Product;
  ref_: RefData;
  ro: boolean;
  onSave: (v: number | null) => void;
}) {
  const cat = ref_.settings.reorder[`${p.div}:${p.type}`]?.low;
  return (
    <Field
      label="Low-stock alert at"
      hint={
        p.reorder_point === 0
          ? "Never reminds"
          : p.reorder_point == null
            ? cat
              ? `Category level (${cat})`
              : "Category has no level — set one in Settings"
            : "This product's own level"
      }
    >
      <TextInput
        key={`${p.id}-${p.reorder_point ?? ""}`}
        disabled={ro}
        inputMode="numeric"
        placeholder={cat ? String(cat) : "off"}
        defaultValue={p.reorder_point ?? ""}
        onBlur={(e) => {
          const raw = e.target.value.trim();
          const v = raw === "" ? null : num(raw);
          if (raw !== "" && (v == null || v < 0)) {
            toast.error("Enter 0 or more (blank = category level)");
            return;
          }
          if (v !== p.reorder_point) onSave(v);
        }}
      />
    </Field>
  );
}
