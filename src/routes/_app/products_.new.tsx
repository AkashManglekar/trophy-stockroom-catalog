import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { AWARD_CLASSES, inr, num, pct, today, type Product } from "@/lib/domain";
import {
  errMsg,
  priceFor,
  useFamilies,
  useInvalidate,
  usePhotoMap,
  useProducts,
  useRefData,
  useSources,
  useVendorCodes,
  useVendors,
  variantLabel,
} from "@/lib/data";
import { newDraft, newLine, type Draft } from "@/lib/draft";
import { planDraft, type LinePlan, type PlanCtx } from "@/lib/receive-plan";
import { normDesc } from "@/lib/naming";
import { pricePayload } from "@/lib/pricing";
import { GST_RATES } from "@/lib/gst";
import {
  Card,
  CardTitle,
  Code,
  Empty,
  Field,
  Notice,
  PageHead,
  Pill,
  Select,
  TextInput,
} from "@/components/kit";
import { PhotoButtons } from "@/components/photos";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/products_/new")({
  head: () => ({ meta: [{ title: "Add product · Sportagon Stockroom" }] }),
  validateSearch: (s: Record<string, unknown>): { family?: string | undefined } => ({
    family: typeof s["family"] === "string" ? s["family"] : undefined,
  }),
  component: AddProductPage,
});

type Row = {
  id: string;
  size: string;
  finish: string;
  qty: string;
  cost: string;
  mrp: string;
  vitem: string;
};
const uid = () => Math.random().toString(36).slice(2, 10);
const blankRow = (o: Partial<Row> = {}): Row => ({
  id: uid(),
  size: "",
  finish: "",
  qty: "",
  cost: "",
  mrp: "",
  vitem: "",
  ...o,
});
type Created = {
  product_id: string;
  code: string;
  friendly_name: string;
  qty: number;
  line_no: number;
};

function AddProductPage() {
  const { canPublish, canContribute } = useAuth();
  const search = Route.useSearch();
  const nav = useNavigate();
  const ref = useRefData();
  const products = useProducts();
  const families = useFamilies();
  const vendors = useVendors();
  const vcodes = useVendorCodes();
  const sources = useSources();
  const photoMap = usePhotoMap();
  const inv = useInvalidate();
  const counters = useQuery({
    queryKey: ["counters"],
    queryFn: async () => {
      const { data } = await supabase.from("code_counters").select("*");
      return Object.fromEntries((data ?? []).map((c) => [c.prefix, c.next_no])) as Record<
        string,
        number
      >;
    },
  });

  // ---- what it is ----
  const [famId, setFamId] = useState(search.family ?? "");
  const [famQ, setFamQ] = useState("");
  const [div, setDiv] = useState("");
  const [type, setType] = useState("");
  const [mat, setMat] = useState("");
  const [sport, setSport] = useState("GEN");
  const [designName, setDesignName] = useState("");
  const [description, setDescription] = useState("");
  const [internal, setInternal] = useState(false);
  // ---- variants ----
  const [rows, setRows] = useState<Row[]>([blankRow()]);
  const [defCost, setDefCost] = useState("");
  // ---- source & details ----
  const [vendorId, setVendorId] = useState("");
  const [refNo, setRefNo] = useState("");
  const [date, setDate] = useState(today());
  const [gst, setGst] = useState("");
  const [location, setLocation] = useState("");
  const [reorder, setReorder] = useState("");
  const [award, setAward] = useState("");
  const [custom, setCustom] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Created[] | null>(null);

  const fams = useMemo(() => families.data ?? [], [families.data]);
  const fam = famId ? fams.find((f) => f.id === famId) : undefined;
  const d = fam?.div ?? div;
  const t = fam?.type ?? type;
  const r = ref.data;
  const typ = r?.types.find((x) => x.div === d && x.code === t);
  const unit = typ?.size_unit ?? "none";
  const existingSizes = fam ? (products.data ?? []).filter((p) => p.family_id === fam.id) : [];

  const ctx: PlanCtx | null = useMemo(
    () =>
      r
        ? {
            ref: r,
            products: products.data ?? [],
            families: fams,
            vendorCodes: vcodes.data ?? [],
            counters: counters.data ?? {},
            sources: sources.data ?? [],
            vendors: vendors.data ?? [],
          }
        : null,
    [r, products.data, fams, vcodes.data, counters.data, sources.data, vendors.data],
  );

  // The form is turned into a "new items" receipt, planned and saved exactly like Receive does —
  // same codes, names, duplicate checks and prices.
  const draft: Draft = useMemo(() => {
    const first = rows[0]?.id;
    return {
      ...newDraft(),
      type: "opening",
      vendorId,
      billNo: refNo,
      billDate: date,
      lines: rows.map((row, i) =>
        newLine({
          id: row.id,
          vitem: row.vitem,
          desc: "",
          billed: row.qty.trim() === "" ? "0" : row.qty,
          received: "",
          cost: row.cost.trim() || defCost,
          location,
          gst,
          mode: "new",
          cls: {
            div: d,
            type: t,
            mat: fam?.mat ?? mat,
            sport: fam?.sport ?? sport,
            size: unit === "none" ? "" : row.size,
            finish: typ?.is_service ? "NA" : row.finish,
            family: fam ? `f:${fam.id}` : i === 0 || !first ? "new" : `l:${first}`,
            designName: fam ? (fam.design_name ?? designName) : designName,
            description,
            internal: internal ? "1" : "",
          },
        }),
      ),
    };
  }, [
    rows,
    vendorId,
    refNo,
    date,
    defCost,
    location,
    gst,
    d,
    t,
    mat,
    sport,
    fam,
    designName,
    description,
    internal,
    unit,
    typ,
  ]);
  const plans = useMemo(() => (ctx ? planDraft(draft, ctx) : {}), [draft, ctx]);

  if (!r || products.isLoading) return <Empty>Loading…</Empty>;
  if (!canPublish)
    return (
      <>
        <PageHead title="Add product" lede="" />
        <Notice>
          Adding products directly needs publish rights.{" "}
          {canContribute ? (
            <>
              Use{" "}
              <Link to="/receive" className="font-semibold text-primary">
                Receive → New items
              </Link>{" "}
              — it goes for approval.
            </>
          ) : null}
        </Notice>
      </>
    );

  const upd = (id: string, patch: Partial<Row>) =>
    setRows((rs) => rs.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  const errorsOf = (id: string) => (plans[id] as LinePlan | undefined)?.errors ?? [];
  const allErr = rows.flatMap((x) => errorsOf(x.id));
  const headErr = !d || !t ? "Pick the division and type" : !fam && !mat ? "Pick the material" : "";
  const units = rows.reduce((a, x) => a + (num(x.qty) ?? 0), 0);
  const value = rows.reduce(
    (a, x) => a + (num(x.qty) ?? 0) * (num(x.cost.trim() || defCost) ?? 0),
    0,
  );

  function addAllSizes() {
    const finish = rows[0]?.finish ?? "";
    const have = new Set(rows.map((x) => x.size.toUpperCase()));
    const add = (r?.sizes ?? [])
      .filter((s) => !have.has(s.code))
      .map((s) => blankRow({ size: s.code, finish }));
    setRows((rs) => [...rs.filter((x) => x.size || x.qty || x.cost), ...add]);
  }
  function addMedalColours() {
    const want = ["GD", "SV", "BZ"].filter((c) => r?.finishes.some((f) => f.code === c));
    const sizes = [...new Set(rows.map((x) => x.size).filter(Boolean))];
    if (!sizes.length) {
      toast.error("Enter a size first");
      return;
    }
    const have = new Set(rows.map((x) => `${x.size}|${x.finish}`));
    const add = sizes.flatMap((s) =>
      want.filter((c) => !have.has(`${s}|${c}`)).map((c) => blankRow({ size: s, finish: c })),
    );
    setRows((rs) => [...rs.filter((x) => x.finish), ...add]);
  }

  async function save() {
    if (!ctx) return;
    setBusy(true);
    try {
      const p2 = planDraft(draft, ctx);
      for (const l of draft.lines) {
        const pv = p2[l.id]?.preview;
        if (pv?.renameFamily && pv.familyId && l.cls.designName.trim()) {
          const { error } = await supabase.rpc("rename_family", {
            p_family: pv.familyId,
            p_name: l.cls.designName.trim(),
          });
          if (error) throw new Error(error.message);
          break;
        }
      }
      const lines = draft.lines.map((l, i) => {
        const P = p2[l.id]!;
        const pv = P.preview!;
        return {
          line_no: i + 1,
          received_qty: P.received ?? 0,
          billed_qty: num(l.billed),
          unit_cost: num(l.cost),
          extra_cost: null,
          gst_rate: null,
          vendor_item_code: l.vitem.trim() || null,
          description: description.trim() || pv.friendly,
          norm_desc: l.vitem.trim() ? normDesc(pv.friendly) : null,
          location: location.trim() || null,
          new: {
            div: l.cls.div,
            type: l.cls.type,
            mat: l.cls.mat,
            sport: l.cls.sport,
            size: pv.size,
            finish: l.cls.finish,
            design_mode: pv.familyMode,
            family_id: pv.familyMode === "existing" ? pv.familyId : null,
            same_as_line: pv.familyMode === "same" && pv.sameAs != null ? String(pv.sameAs) : null,
            design_name: pv.designName,
            internal: pv.familyMode === "new" && internal,
            friendly_name: pv.friendly,
            description: description.trim() || null,
          },
          prices: pricePayload(pv.price),
        };
      });
      const { data, error } = await supabase.rpc("receive_stock", {
        payload: {
          receipt_type: "opening",
          vendor_id: vendorId || null,
          bill_no: refNo.trim() || null,
          bill_date: date,
          notes: "Added from Products",
          lines,
        },
      });
      if (error) throw new Error(error.message);
      const res = data as { created: Created[] };
      // Details the receipt doesn't carry: low-stock level, award class, customisable, MRP held.
      const fresh = await supabase
        .from("products")
        .select("*")
        .in(
          "id",
          res.created.map((c) => c.product_id),
        );
      for (const c of res.created) {
        const row = rows[c.line_no - 1];
        const p = fresh.data?.find((x) => x.id === c.product_id);
        if (!row || !p) continue;
        const mrp = num(row.mrp);
        const patch: Partial<Product> = {
          ...(reorder.trim() !== "" ? { reorder_point: num(reorder) } : {}),
          ...(award ? { award_class: award } : {}),
          ...(custom ? { customisable: true } : {}),
          ...(gst !== "" ? { gst_manual: true } : {}),
        };
        if (mrp != null && mrp > 0) {
          const pr = priceFor({ ...p, price_mode: "mrp", price_value: mrp }, r!);
          const pl = pr ? pricePayload(pr) : null;
          Object.assign(patch, {
            price_mode: "mrp",
            price_value: mrp,
            ...(pl
              ? {
                  landed: pl.landed,
                  selling: pl.selling,
                  mrp: pl.mrp,
                  floor_price: pl.floor,
                  bulk_price: pl.bulk,
                  gst: pl.gst,
                  price_rule: pl.rule,
                }
              : {}),
          });
        }
        if (Object.keys(patch).length) await supabase.from("products").update(patch).eq("id", p.id);
      }
      await inv("products", "families", "vendor_codes", "receipts", "counters");
      toast.success(`${res.created.length} product${res.created.length === 1 ? "" : "s"} added`);
      setDone(res.created);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    const firstFam = (products.data ?? []).find((p) => p.id === done[0]?.product_id)?.family_id;
    return (
      <>
        <PageHead
          title="Product added"
          lede="Add photos now so staff and customers can recognise it."
        />
        <Card className="border-success">
          <CardTitle>
            {done.length} new code{done.length === 1 ? "" : "s"}
          </CardTitle>
          <ul className="grid gap-2">
            {done.map((c) => {
              const p = (products.data ?? []).find((x) => x.id === c.product_id);
              return (
                <li
                  key={c.product_id}
                  className="flex flex-wrap items-center gap-3 rounded-xl border p-2.5"
                >
                  <Code>{c.code}</Code>
                  <span className="wrap-any min-w-0 flex-1 text-sm">{c.friendly_name}</span>
                  <span className="text-xs text-muted-foreground">
                    {c.qty} in stock{p?.mrp != null ? ` · ${inr(p.mrp)}` : ""}
                  </span>
                  <PhotoButtons
                    productId={c.product_id}
                    count={photoMap.get(c.product_id)?.length ?? 0}
                    compact
                  />
                  <Link
                    to="/products"
                    search={{ sel: c.product_id }}
                    className="text-xs font-semibold text-primary hover:underline"
                  >
                    Open
                  </Link>
                </li>
              );
            })}
          </ul>
          <div className="flex flex-wrap gap-2">
            <Button
              className="rounded-full"
              onClick={() => {
                setDone(null);
                setRows([blankRow()]);
                setFamId("");
                setDesignName("");
                setDescription("");
              }}
            >
              <Plus className="size-4" /> Add another product
            </Button>
            {firstFam && (
              <Button
                variant="outline"
                className="rounded-full"
                onClick={() => {
                  setDone(null);
                  setRows([blankRow()]);
                  setFamId(firstFam);
                }}
              >
                Add more sizes / colours to this design
              </Button>
            )}
            <Button
              variant="ghost"
              className="rounded-full"
              onClick={() => nav({ to: "/products" })}
            >
              Back to products
            </Button>
          </div>
        </Card>
      </>
    );
  }

  const famOptions = fams
    .filter((f) => f.code)
    .sort((a, b) => (a.code ?? "").localeCompare(b.code ?? ""));
  return (
    <>
      <PageHead
        title="Add product"
        lede="Create a product directly — without a vendor bill. Everything a product needs is here; codes, names and prices are worked out the same way as on Receive."
        right={
          <Link
            to="/products"
            className="inline-flex items-center gap-1.5 text-xs font-bold uppercase text-primary hover:underline"
          >
            <ArrowLeft className="size-4" /> Products
          </Link>
        }
      />

      <Card>
        <CardTitle>1 · What is it?</CardTitle>
        <div
          className="inline-flex w-fit gap-1 rounded-full border bg-muted p-1"
          role="group"
          aria-label="Design"
        >
          {[
            { k: "new", label: "New design" },
            { k: "existing", label: "New size / colour of an existing design" },
          ].map((o) => {
            const on = (o.k === "existing") === (!!famId || famQ !== "");
            return (
              <button
                key={o.k}
                type="button"
                aria-pressed={on}
                onClick={() => {
                  if (o.k === "new") {
                    setFamId("");
                    setFamQ("");
                  } else setFamQ(" ");
                }}
                className={cn(
                  "rounded-full px-4 py-2 text-[11.5px] font-bold uppercase tracking-wide text-muted-foreground",
                  on && "bg-card text-primary shadow-sm",
                )}
              >
                {o.label}
              </button>
            );
          })}
        </div>

        {famId || famQ ? (
          <div className="grid gap-3">
            <Field label="Existing design — type its code or name">
              <TextInput
                list="add-fams"
                value={fam ? `${fam.code} · ${fam.design_name ?? ""}` : famQ.trim()}
                placeholder="e.g. TC-1005 or Symbol"
                onChange={(e) => {
                  const code = (e.target.value.split(" ")[0] ?? "").trim().toUpperCase();
                  const f = famOptions.find((x) => x.code === code);
                  setFamId(f?.id ?? "");
                  setFamQ(f ? "" : e.target.value || " ");
                }}
              />
              <datalist id="add-fams">
                {famOptions.map((f) => (
                  <option key={f.id} value={`${f.code} · ${f.design_name ?? ""}`} />
                ))}
              </datalist>
            </Field>
            {fam && (
              <div className="flex flex-wrap items-center gap-2 rounded-xl bg-muted p-3 text-sm">
                <Code>{fam.code}</Code>
                <b>{fam.design_name}</b>
                <span className="text-xs text-muted-foreground">
                  {r.divisions.find((x) => x.code === fam.div)?.name} · {typ?.name} ·{" "}
                  {r.materials.find((m) => m.code === fam.mat)?.name}
                  {fam.internal ? " · internal stock" : ""}
                </span>
                <span className="w-full text-xs text-muted-foreground">
                  Already has:{" "}
                  {existingSizes.map((p) => variantLabel(p, r, true) || p.code).join(", ") || "—"}
                </span>
              </div>
            )}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Field label="Division">
                <Select
                  value={div}
                  onChange={(e) => {
                    setDiv(e.target.value);
                    setType("");
                  }}
                >
                  <option value="">—</option>
                  {r.divisions.map((x) => (
                    <option key={x.code} value={x.code}>
                      {x.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Type">
                <Select
                  value={type}
                  onChange={(e) => {
                    setType(e.target.value);
                    setRows((rs) => rs.map((x) => ({ ...x, size: "" })));
                  }}
                >
                  <option value="">—</option>
                  {r.types
                    .filter((x) => !div || x.div === div)
                    .map((x) => (
                      <option key={x.id} value={x.code}>
                        {x.name}
                      </option>
                    ))}
                </Select>
              </Field>
              <Field label="Material">
                <Select value={mat} onChange={(e) => setMat(e.target.value)}>
                  <option value="">—</option>
                  {r.materials.map((x) => (
                    <option key={x.code} value={x.code}>
                      {x.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Sport">
                <Select value={sport} onChange={(e) => setSport(e.target.value)}>
                  {r.sports.map((x) => (
                    <option key={x.code} value={x.code}>
                      {x.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-[1fr_2fr]">
              <Field
                label="Design name"
                hint="Distinctive — customers see it (e.g. Aurora, Titan Cup)"
              >
                <TextInput value={designName} onChange={(e) => setDesignName(e.target.value)} />
              </Field>
              <Field label="Customer description (optional)" hint="Shown on the catalogue">
                <TextInput value={description} onChange={(e) => setDescription(e.target.value)} />
              </Field>
            </div>
            <label className="flex w-fit items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={internal}
                onChange={(e) => setInternal(e.target.checked)}
              />
              Internal stock only — never on the public catalogue (staff kit, marketing caps…)
            </label>
          </>
        )}
      </Card>

      <Card>
        <CardTitle>2 · Sizes, colours, stock and cost</CardTitle>
        {!d || !t ? (
          <p className="text-sm text-muted-foreground">Pick the design first.</p>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-[180px_1fr] sm:items-end">
              <Field label="Unit cost ₹ (all rows)" hint="Each row can override it">
                <TextInput
                  inputMode="decimal"
                  value={defCost}
                  onChange={(e) => setDefCost(e.target.value)}
                />
              </Field>
              <p className="text-sm text-muted-foreground">
                One row per size / colour. Stock can be 0 to list a product before it arrives.
                {unit !== "none" && unit !== "size" ? ` Sizes in ${unit}.` : ""}
              </p>
            </div>
            <div className="grid gap-2">
              {rows.map((row, i) => {
                const P = plans[row.id] as LinePlan | undefined;
                const pv = P?.preview;
                const errs = P?.errors ?? [];
                return (
                  <div
                    key={row.id}
                    className={cn(
                      "grid gap-2 rounded-xl border border-l-4 p-2.5",
                      errs.length ? "border-l-warning" : "border-l-success",
                    )}
                  >
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-[110px_130px_80px_100px_110px_1fr_36px] sm:items-end">
                      {unit === "none" ? (
                        <span className="hidden sm:block" />
                      ) : (
                        <Field label={unit === "size" ? "Size" : `Size (${unit})`}>
                          {unit === "size" ? (
                            <Select
                              value={row.size}
                              onChange={(e) => upd(row.id, { size: e.target.value })}
                            >
                              <option value="">—</option>
                              {r.sizes.map((s) => (
                                <option key={s.code} value={s.code}>
                                  {s.name}
                                </option>
                              ))}
                            </Select>
                          ) : (
                            <TextInput
                              inputMode="decimal"
                              value={row.size}
                              onChange={(e) => upd(row.id, { size: e.target.value })}
                            />
                          )}
                        </Field>
                      )}
                      {typ?.is_service ? (
                        <span className="hidden sm:block" />
                      ) : (
                        <Field label="Finish / colour">
                          <Select
                            value={row.finish}
                            onChange={(e) => upd(row.id, { finish: e.target.value })}
                          >
                            <option value="">—</option>
                            {r.finishes.map((f) => (
                              <option key={f.code} value={f.code}>
                                {f.name}
                              </option>
                            ))}
                          </Select>
                        </Field>
                      )}
                      <Field label="Stock">
                        <TextInput
                          inputMode="numeric"
                          placeholder="0"
                          value={row.qty}
                          onChange={(e) =>
                            upd(row.id, { qty: e.target.value.replace(/[^\d]/g, "") })
                          }
                        />
                      </Field>
                      <Field label="Cost ₹">
                        <TextInput
                          inputMode="decimal"
                          placeholder={defCost || ""}
                          value={row.cost}
                          onChange={(e) => upd(row.id, { cost: e.target.value })}
                        />
                      </Field>
                      <Field label="MRP ₹ (optional)">
                        <TextInput
                          inputMode="decimal"
                          placeholder={pv?.price.mrp != null ? String(pv.price.mrp) : "auto"}
                          value={row.mrp}
                          onChange={(e) => upd(row.id, { mrp: e.target.value })}
                        />
                      </Field>
                      <Field label="Vendor's code (optional)">
                        <TextInput
                          value={row.vitem}
                          onChange={(e) => upd(row.id, { vitem: e.target.value })}
                        />
                      </Field>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="rounded-full"
                        aria-label={`Remove row ${i + 1}`}
                        disabled={rows.length === 1}
                        onClick={() => setRows((rs) => rs.filter((x) => x.id !== row.id))}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      {pv ? (
                        <>
                          <Code>{pv.code}</Code>
                          <span className="wrap-any">{pv.friendly}</span>
                          <Pill tone="ok">
                            MRP {inr(num(row.mrp) ?? pv.price.mrp)}
                            {num(row.mrp) != null ? " (held)" : ""}
                          </Pill>
                          {num(row.mrp) == null && (
                            <span>
                              landed {inr(pv.price.landed)} · {pv.price.rule} ·{" "}
                              {pct(pv.price.margin)} margin · GST {pv.price.gst}%
                            </span>
                          )}
                        </>
                      ) : (
                        errs.map((e) => (
                          <Pill key={e} tone="warn">
                            {e}
                          </Pill>
                        ))
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                className="rounded-full"
                onClick={() =>
                  setRows((rs) => [...rs, blankRow({ finish: rs[rs.length - 1]?.finish ?? "" })])
                }
              >
                <Plus className="size-4" /> Another size / colour
              </Button>
              {unit === "size" && (
                <Button size="sm" variant="ghost" className="rounded-full" onClick={addAllSizes}>
                  Add every size ({r.sizes.map((s) => s.code).join(", ")})
                </Button>
              )}
              {typ?.colour_variants && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="rounded-full"
                  onClick={addMedalColours}
                >
                  Gold, Silver &amp; Bronze for each size
                </Button>
              )}
            </div>
          </>
        )}
      </Card>

      <Card>
        <CardTitle>3 · Where it came from &amp; details</CardTitle>
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="Vendor (optional)" hint="Becomes its preferred vendor">
            <Select value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
              <option value="">No vendor</option>
              {(vendors.data ?? [])
                .filter((v) => v.status !== "Archived")
                .map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.display_name}
                  </option>
                ))}
            </Select>
          </Field>
          <Field label="Reference (optional)" hint="Count sheet, challan no.…">
            <TextInput value={refNo} onChange={(e) => setRefNo(e.target.value)} />
          </Field>
          <Field label="Date">
            <TextInput type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field
            label="Selling GST %"
            hint={gst === "" ? `Type's usual (${typ?.gst ?? "—"}%)` : "Set by hand"}
          >
            <Select value={gst} onChange={(e) => setGst(e.target.value)}>
              <option value="">Usual for the type</option>
              {GST_RATES.map((g) => (
                <option key={g} value={String(g)}>
                  {g}%
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Shelf location">
            <TextInput
              value={location}
              placeholder="e.g. Rack B2"
              onChange={(e) => setLocation(e.target.value)}
            />
          </Field>
          <Field
            label="Low-stock alert at"
            hint={
              reorder === ""
                ? r.settings.reorder?.[`${d}:${t}`]?.low
                  ? `Category level (${r.settings.reorder[`${d}:${t}`]!.low})`
                  : "Category level"
                : reorder === "0"
                  ? "Never reminds"
                  : "This product's own level"
            }
          >
            <TextInput
              inputMode="numeric"
              value={reorder}
              placeholder="blank = category"
              onChange={(e) => setReorder(e.target.value.replace(/[^\d]/g, ""))}
            />
          </Field>
          <Field label="Award class (optional)">
            <Select value={award} onChange={(e) => setAward(e.target.value)}>
              <option value="">—</option>
              {AWARD_CLASSES.map((a) => (
                <option key={a}>{a}</option>
              ))}
            </Select>
          </Field>
          <Field label="Customisable">
            <Select value={custom ? "Y" : "N"} onChange={(e) => setCustom(e.target.value === "Y")}>
              <option value="N">No</option>
              <option value="Y">Yes — engraving / printing</option>
            </Select>
          </Field>
        </div>
        <p className="text-xs text-muted-foreground">
          Bought on a vendor bill? Use{" "}
          <Link to="/receive" className="font-semibold text-primary">
            Receive
          </Link>{" "}
          instead — it records the bill, its GST and what you owe.
        </p>
      </Card>

      <div className="panel sticky bottom-20 z-10 flex flex-wrap items-center justify-between gap-3 p-3 lg:bottom-3">
        <span className="text-xs text-muted-foreground">
          <b className="block text-base tabular-nums text-foreground">
            {rows.length} product{rows.length === 1 ? "" : "s"} · {units} in stock · {inr(value)} at
            cost
          </b>
          {headErr ||
            (allErr.length
              ? `${allErr.length} thing${allErr.length === 1 ? "" : "s"} to fix above`
              : "Ready to add")}
        </span>
        <Button
          className="rounded-full font-bold uppercase"
          disabled={busy || !!headErr || allErr.length > 0}
          onClick={save}
        >
          {busy ? "Adding…" : `Add ${rows.length === 1 ? "product" : `${rows.length} products`}`}
        </Button>
      </div>
    </>
  );
}
