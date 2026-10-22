import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, Copy, ExternalLink, LayoutGrid, List, Star, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import {
  ADJUST_REASONS,
  AWARD_CLASSES,
  PRODUCT_STATUSES,
  inr,
  num,
  pct,
  type Photo,
  type Product,
  type RefData,
} from "@/lib/domain";
import {
  attentionReasons,
  errMsg,
  priceFor,
  useAdjustments,
  useFamilies,
  useInvalidate,
  usePhotoMap,
  useProducts,
  useRefData,
  useSignedUrls,
  useVendorCodes,
  useVendors,
} from "@/lib/data";
import { designNameProblem, sizeLabel } from "@/lib/naming";
import { pricePayload } from "@/lib/pricing";
import { removePhoto, setMainPhoto } from "@/lib/photos";
import { Card, Code, Empty, Field, PageHead, Pill, Select, TextInput } from "@/components/kit";
import { PhotoButtons, Thumb } from "@/components/photos";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Search = {
  q?: string | undefined;
  div?: string | undefined;
  status?: string | undefined;
  view?: "grid" | "list" | undefined;
  sel?: string | undefined;
};

export const Route = createFileRoute("/_app/products")({
  head: () => ({ meta: [{ title: "Products · Sportagon Stockroom" }] }),
  validateSearch: (s: Record<string, unknown>): Search => ({
    q: typeof s["q"] === "string" ? s["q"] : undefined,
    div: typeof s["div"] === "string" ? s["div"] : undefined,
    status: typeof s["status"] === "string" ? s["status"] : undefined,
    view: s["view"] === "list" ? "list" : undefined,
    sel: typeof s["sel"] === "string" ? s["sel"] : undefined,
  }),
  component: ProductsPage,
});

function ProductsPage() {
  const search = Route.useSearch();
  const nav = Route.useNavigate();
  const set = (patch: Partial<Search>) =>
    nav({ search: (s: Search) => ({ ...s, ...patch }), replace: true });
  const ref = useRefData();
  const products = useProducts();
  const families = useFamilies();
  const vendors = useVendors();
  const photoMap = usePhotoMap();
  const [qLocal, setQLocal] = useState(search.q ?? "");

  const rows = useMemo(() => {
    if (!ref.data) return [];
    const q = qLocal.trim().toLowerCase();
    return (products.data ?? [])
      .map((p) => ({
        p,
        attn: attentionReasons(p, ref.data!, families.data ?? [], photoMap.get(p.id)?.length ?? 0),
      }))
      .filter(
        ({ p, attn }) =>
          (!search.div || p.div === search.div) &&
          (!search.status ||
            (search.status === "ATTN" ? attn.length > 0 : p.status === search.status)),
      )
      .filter(
        ({ p }) =>
          !q ||
          [
            p.code,
            p.friendly_name,
            p.spec_code,
            p.description,
            vendors.data?.find((v) => v.id === p.preferred_vendor_id)?.display_name,
          ]
            .join(" ")
            .toLowerCase()
            .includes(q),
      )
      .sort((a, b) => a.p.code.localeCompare(b.p.code, undefined, { numeric: true }));
  }, [
    ref.data,
    products.data,
    families.data,
    photoMap,
    vendors.data,
    qLocal,
    search.div,
    search.status,
  ]);

  const mainPaths = useMemo(
    () => rows.map(({ p }) => photoMap.get(p.id)?.[0]?.path ?? "").filter(Boolean),
    [rows, photoMap],
  );
  const urls = useSignedUrls(mainPaths);
  const sel = search.sel ? (products.data ?? []).find((p) => p.id === search.sel) : undefined;
  const grid = search.view !== "list";
  const stockValue = rows.reduce((a, { p }) => a + (p.landed ?? 0) * p.stock, 0);
  const low = rows.filter(({ attn }) => attn.includes("low stock")).length;
  const noPhoto = rows.filter(({ attn }) => attn.includes("photo")).length;

  if (!ref.data) return <Empty>Loading…</Empty>;
  return (
    <>
      <PageHead
        title="Products"
        lede="Your master list. Open a product to see everything behind its code."
        right={
          <Button variant="outline" size="sm" className="rounded-full" asChild>
            <a href="/catalogue" target="_blank" rel="noopener">
              <ExternalLink className="size-4" /> Public catalogue
            </a>
          </Button>
        }
      />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-[1fr_200px_180px]">
        <Field label="Search code, name, vendor" className="col-span-2 sm:col-span-1">
          <TextInput
            type="search"
            value={qLocal}
            placeholder="TC-1001, Champion, vendor…"
            onChange={(e) => setQLocal(e.target.value)}
            onBlur={() => set({ q: qLocal || undefined })}
          />
        </Field>
        <Field label="Division">
          <Select
            value={search.div ?? ""}
            onChange={(e) => set({ div: e.target.value || undefined })}
          >
            <option value="">All divisions</option>
            {ref.data.divisions.map((d) => (
              <option key={d.code} value={d.code}>
                {d.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Status">
          <Select
            value={search.status ?? ""}
            onChange={(e) => set({ status: e.target.value || undefined })}
          >
            <option value="">Any status</option>
            <option value="ATTN">Needs attention</option>
            {PRODUCT_STATUSES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1.5">
          <Pill>{rows.length} products</Pill>
          <Pill>stock value {inr(Math.round(stockValue))}</Pill>
          {low ? <Pill tone="warn">{low} at or below reorder</Pill> : null}
          {noPhoto ? <Pill>{noPhoto} without photos</Pill> : null}
        </div>
        <div className="inline-flex gap-1 rounded-full border bg-muted p-1">
          <button
            aria-pressed={grid}
            onClick={() => set({ view: undefined })}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-bold uppercase text-muted-foreground",
              grid && "bg-card text-primary shadow-sm",
            )}
          >
            <LayoutGrid className="size-3.5" />
            Photos
          </button>
          <button
            aria-pressed={!grid}
            onClick={() => set({ view: "list" })}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-bold uppercase text-muted-foreground",
              !grid && "bg-card text-primary shadow-sm",
            )}
          >
            <List className="size-3.5" />
            List
          </button>
        </div>
      </div>
      <div
        className={cn(
          "grid items-start gap-5",
          sel && "lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]",
        )}
      >
        <div className="min-w-0">
          {!rows.length ? (
            <Empty>
              {products.data?.length
                ? "No products match."
                : "No products yet. Receive your first bill to create codes."}
            </Empty>
          ) : grid ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
              {rows.map(({ p, attn }) => {
                const url = urls[photoMap.get(p.id)?.[0]?.path ?? ""];
                return (
                  <button
                    key={p.id}
                    onClick={() => set({ sel: p.id })}
                    className={cn(
                      "card-lift grid min-w-0 overflow-hidden text-left",
                      sel?.id === p.id && "ring-2 ring-accent",
                    )}
                  >
                    {url ? (
                      <img
                        src={url}
                        alt=""
                        loading="lazy"
                        className="aspect-square w-full bg-white object-contain"
                      />
                    ) : (
                      <span className="grid aspect-square place-items-center bg-muted text-xs text-muted-foreground">
                        <span className="code-tag">{p.code}</span>no photo
                      </span>
                    )}
                    <span className="grid min-w-0 gap-0.5 p-3 text-[12.5px]">
                      <Code>{p.code}</Code>
                      <strong className="wrap-any">{p.friendly_name}</strong>
                      <span className="text-muted-foreground">
                        {inr(p.mrp)} · stock {p.stock}
                      </span>
                      {attn.includes("name") && (
                        <Pill tone="warn" className="w-fit">
                          name needed
                        </Pill>
                      )}
                      {p.is_sample && <Pill className="w-fit">sample</Pill>}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="panel overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted text-left text-[10.5px] uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="p-2.5" />
                    <th className="p-2.5">Code</th>
                    <th className="p-2.5">Name</th>
                    <th className="p-2.5 text-right">Stock</th>
                    <th className="p-2.5 text-right">Price</th>
                    <th className="hidden p-2.5 text-right sm:table-cell">Sell ex-GST</th>
                    <th className="hidden p-2.5 text-right md:table-cell">Landed</th>
                    <th className="hidden p-2.5 md:table-cell">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ p, attn }) => (
                    <tr
                      key={p.id}
                      onClick={() => set({ sel: p.id })}
                      className={cn(
                        "cursor-pointer border-t hover:bg-muted/60",
                        sel?.id === p.id && "bg-accent/10",
                      )}
                    >
                      <td className="p-2">
                        <Thumb url={urls[photoMap.get(p.id)?.[0]?.path ?? ""]} label={p.code} />
                      </td>
                      <td className="p-2.5">
                        <Code>{p.code}</Code>
                      </td>
                      <td className="p-2.5">
                        {p.friendly_name}{" "}
                        {attn.includes("name") && <Pill tone="warn">name needed</Pill>}
                      </td>
                      <td className="p-2.5 text-right tabular-nums">
                        {p.stock}
                        {attn.includes("low stock") && (
                          <Pill tone="warn" className="ml-1">
                            low
                          </Pill>
                        )}
                      </td>
                      <td className="p-2.5 text-right tabular-nums">{inr(p.mrp)}</td>
                      <td className="hidden p-2.5 text-right tabular-nums sm:table-cell">
                        {inr(p.selling)}
                      </td>
                      <td className="hidden p-2.5 text-right tabular-nums md:table-cell">
                        {inr(p.landed)}
                      </td>
                      <td className="hidden p-2.5 md:table-cell">
                        <StatusPill s={p.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        {sel && (
          <ProductPanel
            key={sel.id}
            p={sel}
            ref_={ref.data}
            photos={photoMap.get(sel.id) ?? []}
            onClose={() => set({ sel: undefined })}
          />
        )}
      </div>
    </>
  );
}

export function StatusPill({ s }: { s: string }) {
  return (
    <Pill
      tone={
        s === "Active" ? "ok" : s === "Discontinued" ? "bad" : s === "Clearance" ? "warn" : "mute"
      }
    >
      {s}
    </Pill>
  );
}

function ProductPanel({
  p,
  ref_,
  photos,
  onClose,
}: {
  p: Product;
  ref_: RefData;
  photos: Photo[];
  onClose: () => void;
}) {
  const { canContribute } = useAuth();
  const families = useFamilies();
  const vendors = useVendors();
  const vcodes = useVendorCodes();
  const adj = useAdjustments(p.id);
  const inv = useInvalidate();
  const urls = useSignedUrls(photos.map((x) => x.path ?? ""));
  const [big, setBig] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const [adjQty, setAdjQty] = useState("");
  const [adjReason, setAdjReason] = useState("");
  const [adjNote, setAdjNote] = useState("");
  const fam = families.data?.find((f) => f.id === p.family_id);
  const t = ref_.types.find((x) => x.div === p.div && x.code === p.type);
  const d = ref_.divisions.find((x) => x.code === p.div);
  const live = priceFor(p, ref_);
  const sources = (vcodes.data ?? []).filter((v) => v.product_id === p.id);
  const ro = !canContribute;

  async function save(patch: Partial<Product>, msg = "Saved") {
    const next = { ...p, ...patch };
    const pr = priceFor(next, ref_);
    const pl = pr ? pricePayload(pr) : null;
    const { error } = await supabase
      .from("products")
      .update({
        ...patch,
        ...(pl
          ? {
              landed: pl.landed,
              selling: pl.selling,
              mrp: pl.mrp,
              floor_price: pl.floor,
              bulk_price: pl.bulk,
              bulk_min_qty: pl.bulk_min,
              gst: pl.gst,
              price_rule: pl.rule,
            }
          : {}),
        updated_at: new Date().toISOString(),
      })
      .eq("id", p.id);
    if (error) {
      toast.error(
        error.message.includes("friendly")
          ? "Another product already has that name"
          : error.message,
      );
      return;
    }
    toast.success(msg);
    inv("products");
  }
  async function rename(name: string) {
    if (!fam || name.trim() === (fam.design_name ?? "")) return;
    const prob = designNameProblem(name, ref_, !!t?.is_service);
    if (prob) {
      toast.error(prob);
      return;
    }
    const { error } = await supabase.rpc("rename_family", {
      p_family: fam.id,
      p_name: name.trim(),
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Renamed the whole design family");
    inv("products", "families");
  }
  async function adjust() {
    const q = num(adjQty);
    if (!q || !Number.isInteger(q)) {
      toast.error("Enter a whole number, e.g. -2 or 5");
      return;
    }
    if (!adjReason) {
      toast.error("Pick a reason");
      return;
    }
    if (p.stock + q < 0) {
      toast.error(`Stock can't go below zero (now ${p.stock})`);
      return;
    }
    const { error } = await supabase.rpc("adjust_stock", {
      p_product: p.id,
      p_qty: q,
      p_reason: adjReason,
      p_note: adjNote,
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(`Stock ${p.stock} → ${p.stock + q}`);
    setAdjQty("");
    setAdjNote("");
    setAdjReason("");
    inv("products", "adjustments");
  }
  const main = photos[0];
  return (
    <aside
      className="panel fixed inset-0 z-40 grid content-start gap-4 overflow-y-auto p-4 lg:sticky lg:inset-auto lg:top-20 lg:z-0 lg:max-h-[calc(100dvh-6rem)] lg:p-5"
      style={{
        paddingTop: "max(1rem, env(safe-area-inset-top))",
        paddingBottom: "max(1.5rem, env(safe-area-inset-bottom))",
      }}
      aria-label="Product detail"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Code big>{p.code}</Code>
          <h3 className="wrap-any mt-1 text-lg font-bold">{p.friendly_name}</h3>
        </div>
        <div className="flex shrink-0 gap-1">
          <Button
            size="icon"
            variant="outline"
            className="rounded-full"
            title="Copy code"
            onClick={() =>
              navigator.clipboard?.writeText(p.code).then(
                () => toast.success("Copied " + p.code),
                () => toast(p.code),
              )
            }
          >
            <Copy className="size-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="rounded-full"
            title="Close"
            onClick={onClose}
          >
            <ArrowLeft className="size-4 lg:hidden" />
            <X className="hidden size-4 lg:block" />
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Pill tone="ok">Price {inr(p.mrp)}</Pill>
        <StatusPill s={p.status} />
        {p.is_sample && <Pill>sample</Pill>}
      </div>

      {main && urls[main.path ?? ""] ? (
        <img
          src={urls[main.path ?? ""]}
          alt={p.friendly_name}
          className="aspect-[4/3] w-full cursor-zoom-in rounded-xl border bg-white object-contain"
          onClick={() => setBig(urls[main.path ?? ""] ?? null)}
        />
      ) : (
        <div className="grid aspect-[4/3] place-items-center rounded-xl border bg-muted p-4 text-center text-sm text-muted-foreground">
          <span>
            <strong className="block">No photo yet</strong>Add one so staff can confirm this item by
            sight.
          </span>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {photos.map((ph, i) => (
          <span key={ph.id} className="relative">
            <img
              src={urls[ph.path ?? ""]}
              alt={`Photo ${i + 1}`}
              className={cn(
                "size-14 cursor-zoom-in rounded-lg border bg-white object-cover",
                i === 0 && "ring-2 ring-accent",
              )}
              onClick={() => setBig(urls[ph.path ?? ""] ?? null)}
            />
            {!ro && (
              <>
                {i > 0 && (
                  <button
                    className="absolute -left-2 -top-2 grid size-6 place-items-center rounded-full border bg-card"
                    title="Make main photo"
                    aria-label="Make main photo"
                    onClick={async () => {
                      try {
                        await setMainPhoto(p.id, ph.id);
                        inv("photos");
                      } catch (e) {
                        toast.error(errMsg(e));
                      }
                    }}
                  >
                    <Star className="size-3" />
                  </button>
                )}
                <button
                  className="absolute -right-2 -top-2 grid size-6 place-items-center rounded-full border bg-card text-xs"
                  title="Remove photo"
                  aria-label={`Remove photo ${i + 1}`}
                  onClick={async () => {
                    if (confirmDel !== ph.id) {
                      setConfirmDel(ph.id);
                      toast("Tap × again to remove this photo");
                      return;
                    }
                    try {
                      await removePhoto(ph);
                      inv("photos");
                      toast.success("Photo removed");
                    } catch (e) {
                      toast.error(errMsg(e));
                    }
                  }}
                >
                  {confirmDel === ph.id ? "!" : "×"}
                </button>
              </>
            )}
          </span>
        ))}
        {!ro && <PhotoButtons productId={p.id} count={photos.length} />}
      </div>

      <section className="grid gap-2">
        <h4 className="text-xs font-extrabold uppercase tracking-[0.1em] text-muted-foreground">
          What it is
        </h4>
        <dl className="grid grid-cols-[minmax(110px,max-content)_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm">
          <dt className="text-muted-foreground">Spec code</dt>
          <dd className="code-tag wrap-any">{p.spec_code}</dd>
          <dt className="text-muted-foreground">Division</dt>
          <dd>{d?.name}</dd>
          <dt className="text-muted-foreground">Type</dt>
          <dd>{t?.name}</dd>
          <dt className="text-muted-foreground">Material</dt>
          <dd>{ref_.materials.find((m) => m.code === p.mat)?.name}</dd>
          <dt className="text-muted-foreground">Sport</dt>
          <dd>{ref_.sports.find((m) => m.code === p.sport)?.name}</dd>
          <dt className="text-muted-foreground">Size</dt>
          <dd>{sizeLabel(p.size, t?.size_unit ?? "none", ref_.sizes) || "—"}</dd>
          <dt className="text-muted-foreground">Finish</dt>
          <dd>{ref_.finishes.find((m) => m.code === p.finish)?.name}</dd>
          <dt className="text-muted-foreground">HSN · GST</dt>
          <dd>
            {t?.hsn} · {pct(p.gst)}
          </dd>
        </dl>
      </section>

      <section className="grid gap-2">
        <h4 className="text-xs font-extrabold uppercase tracking-[0.1em] text-muted-foreground">
          Money
        </h4>
        <dl className="grid grid-cols-[minmax(110px,max-content)_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm tabular-nums">
          <dt className="text-muted-foreground">Unit cost</dt>
          <dd>{inr(p.unit_cost)}</dd>
          <dt className="text-muted-foreground">Landed</dt>
          <dd>{inr(live?.landed)}</dd>
          <dt className="text-muted-foreground">Price rule</dt>
          <dd>
            {live?.rule}
            {live?.belowCost && (
              <Pill tone="bad" className="ml-1">
                below cost
              </Pill>
            )}
          </dd>
          <dt className="text-muted-foreground">Selling ex-GST</dt>
          <dd>
            {inr(live?.selling)} ({pct(live?.margin)} margin)
          </dd>
          <dt className="text-muted-foreground">Price (MRP)</dt>
          <dd>{inr(live?.mrp)}</dd>
          <dt className="text-muted-foreground">Floor</dt>
          <dd>{inr(live?.floor)}</dd>
          <dt className="text-muted-foreground">Bulk</dt>
          <dd>
            {inr(live?.bulk)} at {live?.bulkMin}+
          </dd>
        </dl>
      </section>

      <section className="grid gap-2">
        <h4 className="text-xs font-extrabold uppercase tracking-[0.1em] text-muted-foreground">
          Pricing
        </h4>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Price rule">
            <Select
              disabled={ro}
              value={p.price_mode}
              onChange={(e) =>
                save(
                  {
                    price_mode: e.target.value,
                    price_value: e.target.value === "auto" ? null : p.price_value,
                  },
                  "Price rule updated",
                )
              }
            >
              <option value="auto">Automatic</option>
              <option value="mult">Custom multiplier</option>
              <option value="margin">Custom margin %</option>
              <option value="fixed">Fixed selling price</option>
            </Select>
          </Field>
          {p.price_mode !== "auto" && (
            <Field
              label={
                p.price_mode === "mult"
                  ? "× landed"
                  : p.price_mode === "margin"
                    ? "Margin %"
                    : "Selling ₹ before GST"
              }
            >
              <TextInput
                disabled={ro}
                inputMode="decimal"
                defaultValue={p.price_value ?? ""}
                onBlur={(e) => {
                  const v = num(e.target.value);
                  if (v == null || v <= 0) {
                    toast.error("Enter a positive number");
                    return;
                  }
                  if (p.price_mode === "mult" && v <= 1) {
                    toast.error("Multiplier must be more than 1");
                    return;
                  }
                  if (p.price_mode === "margin" && v >= 100) {
                    toast.error("Margin must be under 100");
                    return;
                  }
                  if (v !== p.price_value) save({ price_value: v }, "Price updated");
                }}
              />
            </Field>
          )}
        </div>
      </section>

      <section className="grid gap-2">
        <h4 className="text-xs font-extrabold uppercase tracking-[0.1em] text-muted-foreground">
          Stock · {p.stock} {t?.uom}
        </h4>
        {!ro && !t?.is_service && (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-[90px_1fr_1fr_auto]">
            <Field label="Change by">
              <TextInput
                inputMode="numeric"
                value={adjQty}
                placeholder="-2 or 5"
                onChange={(e) => setAdjQty(e.target.value)}
              />
            </Field>
            <Field label="Reason">
              <Select value={adjReason} onChange={(e) => setAdjReason(e.target.value)}>
                <option value="">Choose…</option>
                {ADJUST_REASONS.map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </Select>
            </Field>
            <Field label="Note" className="col-span-2 sm:col-span-1">
              <TextInput
                value={adjNote}
                onChange={(e) => setAdjNote(e.target.value)}
                placeholder="optional"
              />
            </Field>
            <Button className="col-span-2 self-end rounded-full sm:col-span-1" onClick={adjust}>
              Adjust
            </Button>
          </div>
        )}
        {(adj.data ?? []).length ? (
          <ul className="grid gap-1 text-xs">
            {adj.data!.map((a) => (
              <li key={a.id} className="flex flex-wrap gap-x-2">
                <span className="tabular-nums font-semibold">
                  {a.qty > 0 ? "+" : ""}
                  {a.qty}
                </span>
                <span>
                  {a.reason}
                  {a.note ? ` · ${a.note}` : ""}
                </span>
                <span className="text-muted-foreground">
                  {String(a.created_at).slice(0, 10)} · {a.created_by_email}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">
            Stock = everything received minus adjustments. Sales are recorded in Zoho.
          </p>
        )}
      </section>

      <section className="grid gap-2">
        <h4 className="text-xs font-extrabold uppercase tracking-[0.1em] text-muted-foreground">
          Sources
        </h4>
        {sources.length ? (
          <ul className="grid gap-1 text-sm">
            {sources.map((s) => (
              <li key={s.id} className="flex flex-wrap gap-x-2">
                <span>{vendors.data?.find((v) => v.id === s.vendor_id)?.display_name}</span>
                <Code>{s.vendor_item_code ?? "—"}</Code>
                <span className="text-muted-foreground">last {inr(s.last_cost)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">No vendor codes mapped yet.</p>
        )}
      </section>

      <section className="grid gap-3">
        <h4 className="text-xs font-extrabold uppercase tracking-[0.1em] text-muted-foreground">
          Details
        </h4>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Design name (whole family)" className="col-span-2">
            <TextInput
              disabled={ro}
              defaultValue={fam?.design_name ?? ""}
              onBlur={(e) => rename(e.target.value)}
            />
          </Field>
          <Field label="Status">
            <Select
              disabled={ro}
              value={p.status}
              onChange={(e) => save({ status: e.target.value })}
            >
              {PRODUCT_STATUSES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </Select>
          </Field>
          <Field label="Unit cost ₹">
            <TextInput
              disabled={ro}
              inputMode="decimal"
              defaultValue={p.unit_cost ?? ""}
              onBlur={(e) => {
                const v = num(e.target.value);
                if (v !== p.unit_cost) save({ unit_cost: v }, "Cost updated — re-priced");
              }}
            />
          </Field>
          <Field label="Reorder point">
            <TextInput
              disabled={ro}
              inputMode="numeric"
              defaultValue={p.reorder_point ?? ""}
              onBlur={(e) => {
                const v = num(e.target.value);
                if (v !== p.reorder_point) save({ reorder_point: v ?? 0 });
              }}
            />
          </Field>
          <Field label="Shelf location">
            <TextInput
              disabled={ro}
              defaultValue={p.location ?? ""}
              onBlur={(e) => {
                if (e.target.value !== (p.location ?? ""))
                  save({ location: e.target.value || null });
              }}
            />
          </Field>
          <Field label="Award class">
            <Select
              disabled={ro}
              value={p.award_class ?? ""}
              onChange={(e) => save({ award_class: e.target.value || null })}
            >
              <option value="">—</option>
              {AWARD_CLASSES.map((a) => (
                <option key={a}>{a}</option>
              ))}
            </Select>
          </Field>
          <Field label="Customisable">
            <Select
              disabled={ro}
              value={p.customisable ? "Y" : "N"}
              onChange={(e) => save({ customisable: e.target.value === "Y" })}
            >
              <option value="N">No</option>
              <option value="Y">Yes</option>
            </Select>
          </Field>
          <Field label="Customer description" className="col-span-2">
            <TextInput
              disabled={ro}
              defaultValue={p.description ?? ""}
              onBlur={(e) => {
                if (e.target.value !== (p.description ?? ""))
                  save({ description: e.target.value || null });
              }}
            />
          </Field>
        </div>
        <p className="text-xs text-muted-foreground">
          Changes save when you leave a field. The code never changes — retire a product with
          Discontinued.
        </p>
      </section>

      {big && (
        <div
          className="fixed inset-0 z-50 grid cursor-zoom-out place-items-center bg-[#050B1C] p-4"
          onClick={() => setBig(null)}
          role="dialog"
          aria-label="Photo"
        >
          <img src={big} alt="" className="max-h-full max-w-full rounded-lg object-contain" />
        </div>
      )}
    </aside>
  );
}
