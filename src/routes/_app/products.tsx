import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  Copy,
  ExternalLink,
  LayoutGrid,
  List,
  SlidersHorizontal,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import {
  AWARD_CLASSES,
  HIDDEN_STATUSES,
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
  usePhotoUrls,
  variantLabel,
  useVendorCodes,
  useVendors,
} from "@/lib/data";
import { designNameProblem, sizeLabel } from "@/lib/naming";
import { pricePayload } from "@/lib/pricing";
import { removePhoto, setMainPhoto, withThumbs } from "@/lib/photos";
import { Card, Code, Empty, Field, PageHead, Pill, Select, TextInput } from "@/components/kit";
import { PhotoButtons, Thumb } from "@/components/photos";
import { BulkAdjust, StockAdjustForm } from "@/components/StockAdjust";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { publicCatalogueUrl } from "@/lib/hosts";

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
  const { canPublish } = useAuth();
  const [bulk, setBulk] = useState(false);
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
          (!search.status
            ? !HIDDEN_STATUSES.includes(p.status)
            : search.status === "ATTN"
              ? attn.length > 0 && !HIDDEN_STATUSES.includes(p.status)
              : p.status === search.status),
      )
      .filter(
        ({ p }) =>
          !q ||
          [
            p.code,
            families.data?.find((f) => f.id === p.family_id)?.code,
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

  // One listing per design: sizes (and finishes) of the same design share its product code.
  const groups = useMemo(() => {
    const m = new Map<string, Row[]>();
    for (const r of rows) {
      const k = r.p.family_id ?? r.p.id;
      const g = m.get(k) ?? [];
      g.push(r);
      m.set(k, g);
    }
    return [...m.entries()]
      .map(([k, items]) => {
        items.sort(
          (a, b) => a.p.size.localeCompare(b.p.size) || a.p.finish.localeCompare(b.p.finish),
        );
        const fam = families.data?.find((f) => f.id === k);
        const prices = items.map((x) => x.p.mrp).filter((n): n is number => n != null);
        const withPhoto = items.find((x) => photoMap.get(x.p.id)?.length);
        return {
          key: k,
          items,
          code: fam?.code ?? items[0]!.p.code,
          name: fam?.design_name || items[0]!.p.friendly_name,
          minP: prices.length ? Math.min(...prices) : null,
          maxP: prices.length ? Math.max(...prices) : null,
          stock: items.reduce((a, x) => a + x.p.stock, 0),
          photo: withPhoto ? (photoMap.get(withPhoto.p.id)?.[0]?.path ?? "") : "",
          attn: [...new Set(items.flatMap((x) => x.attn))],
          sizes: items
            .map((x) => variantLabel(x.p, ref.data, hasManyFinishes(items)))
            .filter(Boolean),
          sample: items.some((x) => x.p.is_sample),
        };
      })
      .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
  }, [rows, families.data, photoMap, ref.data]);
  const mainPaths = useMemo(() => groups.map((g) => g.photo).filter(Boolean), [groups]);
  const urls = usePhotoUrls(mainPaths);
  const sel = search.sel ? (products.data ?? []).find((p) => p.id === search.sel) : undefined;
  const siblings = sel
    ? (products.data ?? [])
        .filter(
          (x) => x.family_id === sel.family_id && (x.status !== "Archived" || x.id === sel.id),
        )
        .sort((a, b) => a.size.localeCompare(b.size) || a.finish.localeCompare(b.finish))
    : [];
  const open = (g: (typeof groups)[number]) =>
    set({ sel: g.items.find((x) => x.p.id === sel?.id)?.p.id ?? g.items[0]!.p.id });
  const grid = search.view !== "list";
  const stockValue = rows.reduce((a, { p }) => a + (p.landed ?? 0) * p.stock, 0);
  const low = rows.filter(({ attn }) => attn.includes("low stock")).length;
  const noPhoto = rows.filter(({ attn }) => attn.includes("photo")).length;
  const archived = (products.data ?? []).filter((p) => p.status === "Archived").length;

  if (!ref.data) return <Empty>Loading…</Empty>;
  return (
    <>
      <PageHead
        title="Products"
        lede="Your master list — one listing per design, with its sizes inside. Open a product to see everything behind its code."
        right={
          <div className="flex flex-wrap gap-2">
            {canPublish && (
              <Button
                size="sm"
                className="rounded-full"
                onClick={() => setBulk((v) => !v)}
                aria-pressed={bulk}
              >
                <SlidersHorizontal className="size-4" /> Adjust stock
              </Button>
            )}
            <Button variant="outline" size="sm" className="rounded-full" asChild>
              <a href={publicCatalogueUrl()} target="_blank" rel="noopener">
                <ExternalLink className="size-4" /> Public catalogue
              </a>
            </Button>
          </div>
        }
      />
      {bulk && canPublish && (
        <BulkAdjust products={products.data ?? []} onClose={() => setBulk(false)} />
      )}
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
            <option value="">Any status (not archived)</option>
            <option value="ATTN">Needs attention</option>
            {PRODUCT_STATUSES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1.5">
          <Pill>
            {groups.length} products · {rows.length} sizes
          </Pill>
          <Pill>stock value {inr(Math.round(stockValue))}</Pill>
          {low ? <Pill tone="warn">{low} at or below reorder</Pill> : null}
          {noPhoto ? <Pill>{noPhoto} without photos</Pill> : null}
          {archived && search.status !== "Archived" ? (
            <button onClick={() => set({ status: "Archived" })}>
              <Pill className="cursor-pointer underline-offset-2 hover:underline">
                {archived} archived
              </Pill>
            </button>
          ) : null}
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
              {groups.map((g) => {
                const url = urls[g.photo];
                const on = g.items.some((x) => x.p.id === sel?.id);
                return (
                  <button
                    key={g.key}
                    onClick={() => open(g)}
                    className={cn(
                      "card-lift grid min-w-0 overflow-hidden text-left",
                      on && "ring-2 ring-accent",
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
                        <span className="code-tag">{g.code}</span>no photo
                      </span>
                    )}
                    <span className="grid min-w-0 gap-1 p-3 text-[12.5px]">
                      <Code>{g.code}</Code>
                      <strong className="wrap-any">{g.name}</strong>
                      {g.sizes.length > 0 && (
                        <span className="wrap-any text-[11.5px] text-muted-foreground">
                          {g.sizes.join(" · ")}
                        </span>
                      )}
                      <span className="text-muted-foreground">
                        {priceRange(g.minP, g.maxP)} · stock {g.stock}
                      </span>
                      {g.attn.includes("name") && (
                        <Pill tone="warn" className="w-fit">
                          name needed
                        </Pill>
                      )}
                      {g.sample && <Pill className="w-fit">sample</Pill>}
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
                    <th className="hidden p-2.5 sm:table-cell">Sizes</th>
                    <th className="p-2.5 text-right">Stock</th>
                    <th className="p-2.5 text-right">Price</th>
                    <th className="hidden p-2.5 md:table-cell">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map((g) => {
                    const on = g.items.some((x) => x.p.id === sel?.id);
                    const statuses = [...new Set(g.items.map((x) => x.p.status))];
                    return (
                      <tr
                        key={g.key}
                        onClick={() => open(g)}
                        className={cn(
                          "cursor-pointer border-t hover:bg-muted/60",
                          on && "bg-accent/10",
                        )}
                      >
                        <td className="p-2">
                          <Thumb url={urls[g.photo]} label={g.code} />
                        </td>
                        <td className="p-2.5">
                          <Code>{g.code}</Code>
                        </td>
                        <td className="p-2.5">
                          {g.name} {g.attn.includes("name") && <Pill tone="warn">name needed</Pill>}
                        </td>
                        <td className="hidden p-2.5 text-xs sm:table-cell">
                          {g.sizes.join(" · ") || "—"}
                        </td>
                        <td className="p-2.5 text-right tabular-nums">
                          {g.stock}
                          {g.attn.includes("low stock") && (
                            <Pill tone="warn" className="ml-1">
                              low
                            </Pill>
                          )}
                        </td>
                        <td className="whitespace-nowrap p-2.5 text-right tabular-nums">
                          {priceRange(g.minP, g.maxP)}
                        </td>
                        <td className="hidden p-2.5 md:table-cell">
                          {statuses.map((st) => (
                            <StatusPill key={st} s={st} />
                          ))}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
        {sel && (
          <ProductPanel
            key={sel.id}
            p={sel}
            siblings={siblings}
            onPick={(id) => set({ sel: id })}
            ref_={ref.data}
            photos={photoMap.get(sel.id) ?? []}
            onClose={() => set({ sel: undefined })}
          />
        )}
      </div>
    </>
  );
}

type Row = { p: Product; attn: string[] };
const hasManyFinishes = (items: Row[]) => new Set(items.map((x) => x.p.finish)).size > 1;
function priceRange(min: number | null, max: number | null) {
  if (min == null) return "—";
  return max != null && max > min ? `${inr(min)} – ${inr(max)}` : inr(min);
}

export function StatusPill({ s }: { s: string }) {
  return (
    <Pill
      tone={
        s === "Active"
          ? "ok"
          : s === "Discontinued" || s === "Archived"
            ? "bad"
            : s === "Clearance"
              ? "warn"
              : "mute"
      }
    >
      {s}
    </Pill>
  );
}

function ProductPanel({
  p,
  siblings,
  onPick,
  ref_,
  photos,
  onClose,
}: {
  p: Product;
  siblings: Product[];
  onPick: (id: string) => void;
  ref_: RefData;
  photos: Photo[];
  onClose: () => void;
}) {
  const { canContribute, canEdit, canPublish } = useAuth();
  const families = useFamilies();
  const vendors = useVendors();
  const vcodes = useVendorCodes();
  const adj = useAdjustments(p.id);
  const inv = useInvalidate();
  const urls = usePhotoUrls(
    photos.map((x) => x.path ?? ""),
    false,
  );
  const [big, setBig] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const fam = families.data?.find((f) => f.id === p.family_id);
  const manyFinishes = new Set(siblings.map((x) => x.finish)).size > 1;
  const t = ref_.types.find((x) => x.div === p.div && x.code === p.type);
  const d = ref_.divisions.find((x) => x.code === p.div);
  const live = priceFor(p, ref_);
  const sources = (vcodes.data ?? []).filter((v) => v.product_id === p.id);
  const ro = !canContribute;
  const [sureDel, setSureDel] = useState(false);
  const [deleting, setDeleting] = useState(false);
  async function remove() {
    if (!sureDel) {
      setSureDel(true);
      return;
    }
    setDeleting(true);
    const { data, error } = await supabase.rpc("delete_product", { p_product: p.id });
    setDeleting(false);
    setSureDel(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    if (data?.length) await supabase.storage.from("media").remove(withThumbs(data));
    toast.success(`${p.code} deleted`);
    onClose();
    inv("products", "photos", "vendor_codes");
  }

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
          <Code big>{fam?.code ?? p.code}</Code>
          <h3 className="wrap-any mt-1 text-lg font-bold">{fam?.design_name || p.friendly_name}</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            This size: <span className="font-mono">{p.code}</span>
            {variantLabel(p, ref_, manyFinishes) ? ` · ${variantLabel(p, ref_, manyFinishes)}` : ""}
          </p>
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
      {siblings.length > 1 && (
        <div className="grid gap-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Sizes · {siblings.length}
          </span>
          <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Sizes">
            {siblings.map((x) => (
              <button
                key={x.id}
                role="tab"
                aria-selected={x.id === p.id}
                onClick={() => onPick(x.id)}
                className={cn(
                  "grid rounded-xl border px-3 py-1.5 text-left text-xs tabular-nums",
                  x.id === p.id
                    ? "border-primary bg-primary text-primary-foreground"
                    : "bg-card hover:border-primary",
                )}
              >
                <b className="text-[13px]">{variantLabel(x, ref_, manyFinishes) || x.code}</b>
                <span className={x.id === p.id ? "opacity-85" : "text-muted-foreground"}>
                  {inr(x.mrp)} · {x.stock} in stock
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
      {p.status === "Archived" && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-muted px-3 py-2.5 text-sm">
          <span>Archived — hidden from the product list and the public catalogue.</span>
          {canEdit && (
            <Button
              size="sm"
              variant="outline"
              className="rounded-full"
              onClick={() => save({ status: "Active" }, `${p.code} restored`)}
            >
              <ArchiveRestore className="size-4" /> Restore
            </Button>
          )}
        </div>
      )}
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
          <dt className="text-muted-foreground">Bill charges</dt>
          <dd>
            {p.extra_cost != null ? (
              `${inr(p.extra_cost)} / unit (last bill)`
            ) : (
              <span className="text-muted-foreground">estimated freight + packaging</span>
            )}
          </dd>
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
        {!t?.is_service &&
          (canPublish ? (
            <StockAdjustForm p={p} unit={t?.uom} />
          ) : canContribute ? (
            <p className="text-xs text-muted-foreground">
              Stock changes need publish rights — ask the owner.
            </p>
          ) : null)}
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
          Changes save when you leave a field. The code never changes and is never reused.
        </p>
      </section>

      {canEdit && (
        <section className="grid gap-2 rounded-xl border border-dashed p-3">
          <h4 className="text-xs font-extrabold uppercase tracking-[0.1em] text-muted-foreground">
            Remove from use
          </h4>
          <p className="text-xs text-muted-foreground">
            <b>Archive</b> hides it everywhere (list, catalogue, Zoho shows it inactive) but keeps
            its history — you can restore it. <b>Delete</b> erases it completely and only works for
            items never received on a bill and with zero stock, e.g. a mistake or sample.
          </p>
          <div className="flex flex-wrap gap-2">
            {p.status !== "Archived" && (
              <Button
                size="sm"
                variant="outline"
                className="rounded-full"
                onClick={() => save({ status: "Archived" }, `${p.code} archived`)}
              >
                <Archive className="size-4" /> Archive
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              className="rounded-full text-destructive"
              disabled={deleting}
              onClick={remove}
              onBlur={() => setSureDel(false)}
            >
              <Trash2 className="size-4" />{" "}
              {deleting ? "Deleting…" : sureDel ? `Tap again to delete ${p.code}` : "Delete"}
            </Button>
          </div>
        </section>
      )}

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
