import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { Check, ClipboardCopy, EyeOff, Undo2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { inr, num, type Family, type Product, type RefData } from "@/lib/domain";
import {
  designCode,
  errMsg,
  useInvalidate,
  useReorderFlags,
  useSources,
  useVendorCodes,
  useVendors,
} from "@/lib/data";
import {
  flagView,
  isLow,
  lastReceivedBy,
  reorderLevel,
  sourcesFor,
  suggestQty,
  type SourceRow,
} from "@/lib/sourcing";
import { bestNext, useVendorRatings } from "@/components/ProductSourcing";
import { Card, CardTitle, Code, Pill, Select, TextInput } from "@/components/kit";
import { Button } from "@/components/ui/button";

type Item = {
  p: Product;
  level: number;
  from: "product" | "category";
  qty: number;
  best: SourceRow | undefined;
  sold30: number;
};

const plusDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const fmt = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "";

/**
 * Dashboard: products at or below their low-stock level, grouped by the best vendor to buy from,
 * with a suggested quantity. Each can be marked ordered or ignored.
 */
export function OrderNext({
  products,
  families,
  ref_,
  sold30,
}: {
  products: Product[];
  families: Family[];
  ref_: RefData;
  sold30: Map<string, number>;
}) {
  const { canContribute, email } = useAuth();
  const sources = useSources();
  const vendors = useVendors();
  const vcodes = useVendorCodes();
  const flags = useReorderFlags();
  const ratings = useVendorRatings();
  const inv = useInvalidate();
  const [qtyEdit, setQtyEdit] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [show, setShow] = useState<"" | "ordered" | "ignored">("");

  const { decide, ordered, ignored, configured } = useMemo(() => {
    const s = ref_.settings;
    const received = lastReceivedBy(sources.data ?? []);
    const flagBy = new Map((flags.data ?? []).map((f) => [f.product_id, f]));
    const decide: Item[] = [];
    const ordered: { it: Item; qty: number | null; vendor: string | null; at: string }[] = [];
    const ignored: { it: Item; until: string | null }[] = [];
    for (const p of products) {
      const t = ref_.types.find((x) => x.div === p.div && x.code === p.type);
      if (!isLow(p, s, t)) continue;
      const lv = reorderLevel(p, s)!;
      const rows = sourcesFor(p.id, sources.data ?? [], vendors.data ?? []);
      const best = bestNext(rows, ratings);
      const it: Item = {
        p,
        level: lv.level,
        from: lv.from,
        qty: suggestQty(p, s, best?.vendor?.moq),
        best,
        sold30: sold30.get(p.id) ?? 0,
      };
      const f = flagBy.get(p.id);
      const view = flagView(f, received.get(p.id));
      if (view === "ordered" && f)
        ordered.push({
          it,
          qty: f.qty,
          vendor: vendors.data?.find((v) => v.id === f.vendor_id)?.display_name ?? null,
          at: f.created_at,
        });
      else if (view === "ignored" && f) ignored.push({ it, until: f.until });
      else decide.push(it);
    }
    decide.sort((a, b) => a.p.stock - a.level - (b.p.stock - b.level) || b.sold30 - a.sold30);
    const configured =
      Object.keys(s.reorder ?? {}).length > 0 || products.some((p) => (p.reorder_point ?? 0) > 0);
    return { decide, ordered, ignored, configured };
  }, [products, ref_, sources.data, vendors.data, flags.data, ratings, sold30]);

  const groups = useMemo(() => {
    const m = new Map<string, Item[]>();
    for (const it of decide) {
      const k = it.best?.vendor_id ?? "";
      m.set(k, [...(m.get(k) ?? []), it]);
    }
    return [...m.entries()].sort(([a], [b]) => (a ? 0 : 1) - (b ? 0 : 1));
  }, [decide]);

  const qtyOf = (it: Item) => num(qtyEdit[it.p.id] ?? "") ?? it.qty;
  const theirCode = (it: Item) =>
    it.best?.vendor_code ??
    (vcodes.data ?? []).find(
      (c) => c.product_id === it.p.id && c.vendor_id === it.best?.vendor_id && c.vendor_item_code,
    )?.vendor_item_code ??
    null;

  async function flag(items: Item[], state: "ordered" | "ignored", until: string | null) {
    setBusy(items.map((i) => i.p.id).join(","));
    try {
      const rows = items.map((it) => ({
        product_id: it.p.id,
        state,
        until,
        qty: state === "ordered" ? qtyOf(it) : null,
        vendor_id: state === "ordered" ? (it.best?.vendor_id ?? null) : null,
        created_by_email: email,
        created_at: new Date().toISOString(),
      }));
      const { error } = await supabase.from("reorder_flags").upsert(rows);
      if (error) throw new Error(error.message);
      await inv("reorder_flags");
      toast.success(
        state === "ordered"
          ? `${items.length === 1 ? items[0]!.p.code : `${items.length} items`} marked ordered — back here if the bill doesn't arrive`
          : `${items.length === 1 ? items[0]!.p.code : `${items.length} items`} hidden until ${fmt(until)}`,
      );
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy("");
    }
  }
  async function never(it: Item) {
    setBusy(it.p.id);
    const { error } = await supabase
      .from("products")
      .update({ reorder_point: 0, updated_at: new Date().toISOString() })
      .eq("id", it.p.id);
    if (!error) await supabase.from("reorder_flags").delete().eq("product_id", it.p.id);
    setBusy("");
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(`${it.p.code}: no more low-stock reminders (change it on the product page)`);
    await inv("products", "reorder_flags");
  }
  async function undo(id: string) {
    setBusy(id);
    const { error } = await supabase.from("reorder_flags").delete().eq("product_id", id);
    setBusy("");
    if (error) {
      toast.error(error.message);
      return;
    }
    await inv("reorder_flags");
  }
  function copyOrder(vendor: string, items: Item[]) {
    const lines = items.map((it, i) => {
      const c = theirCode(it);
      return `${i + 1}. ${c ? `${c} — ` : ""}${it.p.friendly_name} (our code ${it.p.code}) × ${qtyOf(it)}`;
    });
    const text = `Order from Sportagon — ${vendor}\n${lines.join("\n")}\n\nPlease confirm price and delivery date.`;
    navigator.clipboard?.writeText(text).then(
      () => toast.success("Order copied — paste it into WhatsApp or email"),
      () => toast(text),
    );
  }

  const ro = !canContribute;
  return (
    <Card>
      <CardTitle
        right={
          <span className="flex flex-wrap gap-1.5">
            {decide.length > 0 && <Pill tone="warn">{decide.length} to decide</Pill>}
            {ordered.length > 0 && (
              <button onClick={() => setShow(show === "ordered" ? "" : "ordered")}>
                <Pill tone="info">{ordered.length} on order</Pill>
              </button>
            )}
            {ignored.length > 0 && (
              <button onClick={() => setShow(show === "ignored" ? "" : "ignored")}>
                <Pill>{ignored.length} ignored</Pill>
              </button>
            )}
          </span>
        }
      >
        Order next
      </CardTitle>
      {!configured ? (
        <p className="text-sm text-muted-foreground">
          Set low-stock levels per category in{" "}
          <Link to="/settings" className="font-semibold text-primary hover:underline">
            Settings → Low-stock reminders
          </Link>{" "}
          and anything running low shows here with what to order and from whom.
        </p>
      ) : !decide.length ? (
        <p className="text-sm text-muted-foreground">
          Nothing to reorder right now
          {ordered.length ? " — the rest is already on order" : ""}.
        </p>
      ) : (
        <div className="grid gap-4">
          {groups.map(([vid, items]) => {
            const vname = items[0]?.best?.vendor?.display_name ?? "";
            const total = items.reduce(
              (a, it) => a + qtyOf(it) * Number(it.best?.last_cost ?? it.p.unit_cost ?? 0),
              0,
            );
            return (
              <div key={vid || "none"} className="grid gap-2 rounded-xl border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <b className="text-sm">{vid ? `From ${vname}` : "No vendor bill yet"}</b>
                  <span className="text-xs text-muted-foreground">
                    {items.length} item{items.length === 1 ? "" : "s"}
                    {total ? ` · about ${inr(Math.round(total))} before GST` : ""}
                    {items[0]?.best?.vendor?.lead_time_days
                      ? ` · ${items[0].best.vendor.lead_time_days} days lead time`
                      : ""}
                  </span>
                  {vid && (
                    <span className="ml-auto flex gap-1.5">
                      <Button
                        size="sm"
                        variant="outline"
                        className="rounded-full"
                        onClick={() => copyOrder(vname, items)}
                      >
                        <ClipboardCopy className="size-4" /> Copy order
                      </Button>
                      {!ro && items.length > 1 && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="rounded-full"
                          disabled={!!busy}
                          onClick={() => flag(items, "ordered", null)}
                        >
                          <Check className="size-4" /> All ordered
                        </Button>
                      )}
                    </span>
                  )}
                </div>
                <ul className="grid gap-1.5">
                  {items.map((it) => (
                    <li
                      key={it.p.id}
                      className="grid gap-2 rounded-lg bg-muted/50 p-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
                    >
                      <Link
                        to="/products"
                        search={{ sel: it.p.id }}
                        className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-sm hover:underline"
                      >
                        <Code>{designCode(it.p, families)}</Code>
                        <span className="wrap-any min-w-0">{it.p.friendly_name}</span>
                        <Pill tone={it.p.stock <= 0 ? "bad" : "warn"}>
                          {it.p.stock} left · alert {it.level}
                        </Pill>
                        <span className="text-xs text-muted-foreground">
                          {it.sold30 ? `${it.sold30} sold in 30 days · ` : ""}
                          {it.best
                            ? `${inr(it.best.last_cost)} each${theirCode(it) ? ` · their code ${theirCode(it)}` : ""}`
                            : "no vendor price yet"}
                        </span>
                      </Link>
                      {!ro && (
                        <div className="flex flex-wrap items-center gap-1.5">
                          <label className="flex items-center gap-1 text-xs text-muted-foreground">
                            Qty
                            <TextInput
                              inputMode="numeric"
                              className="h-8 w-16"
                              value={qtyEdit[it.p.id] ?? String(it.qty)}
                              aria-label={`Quantity to order for ${it.p.code}`}
                              onChange={(e) =>
                                setQtyEdit((m) => ({ ...m, [it.p.id]: e.target.value }))
                              }
                            />
                          </label>
                          <Button
                            size="sm"
                            className="rounded-full"
                            disabled={!!busy}
                            onClick={() => flag([it], "ordered", null)}
                          >
                            <Check className="size-4" /> Ordered
                          </Button>
                          <Select
                            className="h-8 w-auto text-xs"
                            value=""
                            disabled={!!busy}
                            aria-label={`Ignore ${it.p.code}`}
                            onChange={(e) => {
                              const v = e.target.value;
                              if (v === "never") never(it);
                              else if (v) flag([it], "ignored", plusDays(Number(v)));
                            }}
                          >
                            <option value="">Ignore…</option>
                            <option value="7">for a week</option>
                            <option value="30">for 30 days</option>
                            <option value="90">for 3 months</option>
                            <option value="never">never remind</option>
                          </Select>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}

      {show === "ordered" && ordered.length > 0 && (
        <div className="grid gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            On order — clears when the bill is received
          </span>
          {ordered.map(({ it, qty, vendor, at }) => (
            <div key={it.p.id} className="flex flex-wrap items-center gap-2 text-sm">
              <Code>{it.p.code}</Code>
              <span className="wrap-any min-w-0 flex-1">{it.p.friendly_name}</span>
              <span className="text-xs text-muted-foreground">
                {qty ? `${qty} ` : ""}
                {vendor ? `from ${vendor} ` : ""}since {fmt(at)}
              </span>
              {!ro && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="rounded-full"
                  disabled={!!busy}
                  onClick={() => undo(it.p.id)}
                >
                  <Undo2 className="size-4" /> Undo
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
      {show === "ignored" && ignored.length > 0 && (
        <div className="grid gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Ignored
          </span>
          {ignored.map(({ it, until }) => (
            <div key={it.p.id} className="flex flex-wrap items-center gap-2 text-sm">
              <EyeOff className="size-3.5 text-muted-foreground" />
              <Code>{it.p.code}</Code>
              <span className="wrap-any min-w-0 flex-1">{it.p.friendly_name}</span>
              <span className="text-xs text-muted-foreground">
                {it.p.stock} left · until {fmt(until)}
              </span>
              {!ro && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="rounded-full"
                  disabled={!!busy}
                  onClick={() => undo(it.p.id)}
                >
                  <Undo2 className="size-4" /> Show again
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

/** How many items need a reorder decision (for the dashboard tile). */
export function useOrderNextCount(products: Product[], ref_: RefData | undefined): number {
  const sources = useSources();
  const flags = useReorderFlags();
  return useMemo(() => {
    if (!ref_) return 0;
    const received = lastReceivedBy(sources.data ?? []);
    const flagBy = new Map((flags.data ?? []).map((f) => [f.product_id, f]));
    return products.filter((p) => {
      const t = ref_.types.find((x) => x.div === p.div && x.code === p.type);
      return isLow(p, ref_.settings, t) && !flagView(flagBy.get(p.id), received.get(p.id));
    }).length;
  }, [products, ref_, sources.data, flags.data]);
}
