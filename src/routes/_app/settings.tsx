import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { Download, ExternalLink, Plus, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { inr, num, type AppSettings, type Division, type RefData } from "@/lib/domain";
import {
  errMsg,
  repriceProducts,
  saveSettings,
  useInvalidate,
  useProducts,
  useRefData,
} from "@/lib/data";
import { sortedBands } from "@/lib/pricing";
import { publicPrefix } from "@/lib/naming";
import {
  Card,
  CardTitle,
  Code,
  Empty,
  Field,
  Notice,
  PageHead,
  Select,
  TextInput,
} from "@/components/kit";
import { Button } from "@/components/ui/button";
import { MyAccount, TeamManager } from "@/components/TeamManager";
import { cn } from "@/lib/utils";
import { publicCatalogueUrl } from "@/lib/hosts";

export const Route = createFileRoute("/_app/settings")({
  head: () => ({ meta: [{ title: "Settings · Sportagon Stockroom" }] }),
  component: SettingsPage,
});

function useReprice() {
  const products = useProducts();
  const inv = useInvalidate();
  return async (ref: RefData) => {
    const n = await repriceProducts(products.data ?? [], ref);
    await inv("products");
    return n;
  };
}

function SettingsPage() {
  const ref = useRefData();
  const { canEdit, isOwner } = useAuth();
  if (!ref.data) return <Empty>Loading…</Empty>;
  return (
    <>
      <PageHead
        title="Settings"
        lede="Pricing rules, catalogue, team and the code lists every product is built from. Price changes re-price products immediately; product codes never change."
      />
      {!canEdit && (
        <Notice>Only the owner and editors can change settings. You can view them.</Notice>
      )}
      {isOwner && <TeamManager />}
      <PriceRule ref_={ref.data} ro={!canEdit} />
      <DivisionTable ref_={ref.data} ro={!canEdit} />
      <CatalogueSettings ref_={ref.data} ro={!canEdit} />
      <TypesCard ref_={ref.data} ro={!canEdit} />
      <CodeLists ref_={ref.data} ro={!canEdit} />
      <DataCard ro={!canEdit} />
      <MyAccount />
    </>
  );
}

function PriceRule({ ref_, ro }: { ref_: RefData; ro: boolean }) {
  const s = ref_.settings;
  const inv = useInvalidate();
  const reprice = useReprice();
  const bands = sortedBands(s.bands);
  async function save(next: AppSettings, msg: string) {
    try {
      await saveSettings(next);
      const n = await reprice({ ...ref_, settings: next });
      await inv("ref");
      toast.success(`${msg}${n ? ` — ${n} product${n === 1 ? "" : "s"} re-priced` : ""}`);
    } catch (e) {
      toast.error(errMsg(e));
    }
  }
  function setBand(i: number, k: "from" | "mult", raw: string) {
    const v = num(raw);
    if (v == null || v < 0) {
      toast.error("Enter a number");
      return;
    }
    if (k === "mult" && v <= 1) {
      toast.error("Multiplier must be more than 1");
      return;
    }
    const next = bands.map((b) => ({ ...b }));
    const prev = next[i - 1],
      after = next[i + 1],
      cur = next[i];
    if (!cur) return;
    if (k === "from" && ((prev && v <= prev.from) || (after && v >= after.from))) {
      toast.error("Each band must start above the previous one and below the next");
      return;
    }
    cur[k] = v;
    save({ ...s, bands: next }, "Pricing updated");
  }
  return (
    <Card>
      <CardTitle>Selling price rule</CardTitle>
      <p className="text-sm text-muted-foreground">
        Selling price = landed cost × the multiplier for its cost band, rounded up to the division's
        rounding. Landed cost = unit cost + freight % + packaging.
      </p>
      <div className="grid gap-3">
        {bands.map((b, i) => {
          const nx = bands[i + 1];
          const eg = nx ? Math.max(b.from, Math.min(nx.from - 1, b.from + 250)) : b.from + 500;
          return (
            <div key={i} className="grid gap-2 rounded-xl border p-3">
              <div className="flex items-center justify-between gap-2">
                <strong className="text-sm">
                  {nx ? `${inr(b.from)} – ${inr(nx.from - 0.01)}` : `${inr(b.from)} and above`}
                </strong>
                {i > 0 && !ro && (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="rounded-full"
                    aria-label="Remove band"
                    onClick={() =>
                      save({ ...s, bands: bands.filter((_, j) => j !== i) }, "Band removed")
                    }
                  >
                    <Trash2 className="size-4" />
                  </Button>
                )}
              </div>
              <div className="grid grid-cols-2 items-end gap-3 sm:grid-cols-[140px_140px_1fr]">
                <Field label="Starts at ₹">
                  <TextInput
                    inputMode="decimal"
                    defaultValue={b.from}
                    disabled={ro || i === 0}
                    onBlur={(e) =>
                      Number(e.target.value) !== b.from && setBand(i, "from", e.target.value)
                    }
                  />
                </Field>
                <Field label="Multiplier ×">
                  <TextInput
                    inputMode="decimal"
                    defaultValue={b.mult}
                    disabled={ro}
                    onBlur={(e) =>
                      Number(e.target.value) !== b.mult && setBand(i, "mult", e.target.value)
                    }
                  />
                </Field>
                <span className="col-span-2 pb-2 text-xs text-muted-foreground sm:col-span-1">
                  e.g. landed {inr(eg)} → {s.basis === "mrp" ? "price" : "sell"}{" "}
                  {inr(Math.ceil((eg * b.mult) / 10) * 10)}
                </span>
              </div>
            </div>
          );
        })}
      </div>
      {!ro && (
        <Button
          size="sm"
          variant="outline"
          className="w-fit rounded-full"
          onClick={() => {
            const last = bands[bands.length - 1] ?? { from: 1000, mult: 2 };
            save(
              {
                ...s,
                bands: [
                  ...bands,
                  {
                    from: Math.round(last.from * 2) || 1000,
                    mult: Math.max(1.1, Math.round((last.mult - 0.25) * 100) / 100),
                  },
                ],
              },
              "Band added",
            );
          }}
        >
          <Plus className="size-4" /> Add cost band
        </Button>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm font-semibold">Multiplier gives</span>
        <div className="inline-flex gap-1 rounded-full border bg-muted p-1">
          {(["pre_gst", "mrp"] as const).map((k) => (
            <button
              key={k}
              disabled={ro}
              aria-pressed={s.basis === k}
              onClick={() => save({ ...s, basis: k }, "Basis updated")}
              className={cn(
                "rounded-full px-3 py-1.5 text-[11px] font-bold uppercase text-muted-foreground",
                s.basis === k && "bg-card text-primary shadow-sm",
              )}
            >
              {k === "pre_gst" ? "Price before GST" : "MRP incl. GST"}
            </button>
          ))}
        </div>
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-1 size-4"
          disabled={ro}
          checked={s.edge_protection}
          onChange={(e) =>
            save(
              { ...s, edge_protection: e.target.checked },
              e.target.checked ? "Band edges protected" : "Band edges unprotected",
            )
          }
        />
        <span>
          Never price an item lower than the most expensive item in the band below it (stops a
          ₹1,070 item selling for less than a ₹999 one).
        </span>
      </label>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Apparel GST threshold ₹ / piece">
          <TextInput
            inputMode="decimal"
            disabled={ro}
            defaultValue={s.apparel_gst.threshold}
            onBlur={(e) => {
              const v = num(e.target.value);
              if (v != null && v !== s.apparel_gst.threshold)
                save(
                  { ...s, apparel_gst: { ...s.apparel_gst, threshold: v } },
                  "Apparel GST updated",
                );
            }}
          />
        </Field>
        <Field label="GST at or below (%)">
          <TextInput
            inputMode="decimal"
            disabled={ro}
            defaultValue={s.apparel_gst.low}
            onBlur={(e) => {
              const v = num(e.target.value);
              if (v != null && v !== s.apparel_gst.low)
                save({ ...s, apparel_gst: { ...s.apparel_gst, low: v } }, "Apparel GST updated");
            }}
          />
        </Field>
        <Field label="GST above (%)">
          <TextInput
            inputMode="decimal"
            disabled={ro}
            defaultValue={s.apparel_gst.high}
            onBlur={(e) => {
              const v = num(e.target.value);
              if (v != null && v !== s.apparel_gst.high)
                save({ ...s, apparel_gst: { ...s.apparel_gst, high: v } }, "Apparel GST updated");
            }}
          />
        </Field>
      </div>
    </Card>
  );
}

const DIV_COLS: { k: keyof Division; label: string }[] = [
  { k: "freight_pct", label: "Freight %" },
  { k: "packaging", label: "Packaging ₹" },
  { k: "rounding", label: "Round to ₹" },
  { k: "target_margin", label: "Target margin %" },
  { k: "floor_margin", label: "Floor margin %" },
  { k: "bulk_pct", label: "Bulk discount %" },
  { k: "bulk_min_qty", label: "Bulk min qty" },
];
function DivisionTable({ ref_, ro }: { ref_: RefData; ro: boolean }) {
  const inv = useInvalidate();
  const reprice = useReprice();
  async function save(d: Division, patch: Partial<Division>) {
    const { error } = await supabase.from("divisions").update(patch).eq("code", d.code);
    if (error) {
      toast.error(error.message);
      return;
    }
    const next = {
      ...ref_,
      divisions: ref_.divisions.map((x) => (x.code === d.code ? { ...x, ...patch } : x)),
    };
    const n = await reprice(next);
    await inv("ref");
    toast.success(`${d.name} updated${n ? ` — ${n} re-priced` : ""}`);
  }
  return (
    <Card>
      <CardTitle>Pricing by division</CardTitle>
      <div className="grid gap-3">
        {ref_.divisions.map((d) => (
          <div key={d.code} className="grid gap-2 rounded-xl border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <strong className="text-sm">{d.name}</strong>
              <Select
                className="h-9 w-auto"
                disabled={ro}
                value={d.pricing_mode}
                onChange={(e) => save(d, { pricing_mode: e.target.value })}
              >
                <option value="bands">Multiplier bands</option>
                <option value="margin">Target margin</option>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
              {DIV_COLS.map((c) => (
                <Field key={c.k} label={c.label}>
                  <TextInput
                    inputMode="decimal"
                    disabled={ro}
                    defaultValue={String(d[c.k])}
                    onBlur={(e) => {
                      const v = num(e.target.value);
                      if (v == null) {
                        toast.error("Enter a number");
                        return;
                      }
                      if (v !== Number(d[c.k])) save(d, { [c.k]: v } as Partial<Division>);
                    }}
                  />
                </Field>
              ))}
            </div>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        Margins and freight are starting assumptions. Confirm GST and HSN rates with your CA.
      </p>
    </Card>
  );
}

function CatalogueSettings({ ref_, ro }: { ref_: RefData; ro: boolean }) {
  const s = ref_.settings;
  const inv = useInvalidate();
  async function save(next: AppSettings, msg: string) {
    try {
      await saveSettings(next);
      await inv("ref");
      toast.success(msg);
    } catch (e) {
      toast.error(errMsg(e));
    }
  }
  const url = publicCatalogueUrl();
  return (
    <Card>
      <CardTitle
        right={
          <Button size="sm" variant="outline" className="rounded-full" asChild>
            <a href={publicCatalogueUrl()} target="_blank" rel="noopener">
              <ExternalLink className="size-4" />
              Open
            </a>
          </Button>
        }
      >
        Public catalogue
      </CardTitle>
      <p className="text-sm text-muted-foreground">
        A public page anyone can open without signing in. It shows active products from the
        divisions ticked below — code, name, price, description and photos only. Tax codes are
        stripped and nothing internal is exposed. It updates live.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Code>{url}</Code>
        <Button
          size="sm"
          variant="ghost"
          className="rounded-full"
          onClick={() =>
            navigator.clipboard?.writeText(url).then(
              () => toast.success("Link copied"),
              () => toast(url),
            )
          }
        >
          Copy link
        </Button>
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-2">
        {ref_.divisions.map((d) => (
          <label key={d.code} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4"
              disabled={ro}
              checked={s.catalogue_divisions.includes(d.code)}
              onChange={(e) => {
                const set = new Set(s.catalogue_divisions);
                if (e.target.checked) set.add(d.code);
                else set.delete(d.code);
                save(
                  {
                    ...s,
                    catalogue_divisions: ref_.divisions
                      .map((x) => x.code)
                      .filter((c) => set.has(c)),
                  },
                  "Catalogue divisions updated",
                );
              }}
            />
            {d.name}
          </label>
        ))}
      </div>
    </Card>
  );
}

function TypesCard({ ref_, ro }: { ref_: RefData; ro: boolean }) {
  const inv = useInvalidate();
  const [f, setF] = useState({
    div: "",
    code: "",
    name: "",
    letter: "",
    size_unit: "in",
    uom: "pcs",
    hsn: "",
    gst: "18",
  });
  async function add() {
    const code = f.code.trim().toUpperCase(),
      letter = f.letter.trim().toUpperCase();
    if (!f.div || !/^[A-Z]{3}$/.test(code) || !f.name.trim() || !/^[A-Z]$/.test(letter)) {
      toast.error("Fill division, a 3-letter code, name and a 1-letter public letter");
      return;
    }
    if (ref_.types.some((t) => t.div === f.div && t.letter === letter)) {
      toast.error(`Letter ${letter} is already used in this division`);
      return;
    }
    const { error } = await supabase.from("types").insert({
      div: f.div,
      code,
      name: f.name.trim(),
      letter,
      size_unit: f.size_unit,
      uom: f.uom || "pcs",
      hsn: f.hsn || null,
      gst: f.div === "AP" ? null : num(f.gst),
      is_service: f.div === "SV",
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(
      `Added ${f.name} (${ref_.divisions.find((d) => d.code === f.div)?.letter}${letter})`,
    );
    setF({ ...f, code: "", name: "", letter: "" });
    inv("ref");
  }
  return (
    <Card>
      <CardTitle>Product types & public letters</CardTitle>
      <div className="panel max-h-96 overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-muted text-left text-[10.5px] uppercase text-muted-foreground">
            <tr>
              <th className="p-2">Prefix</th>
              <th className="p-2">Type</th>
              <th className="hidden p-2 sm:table-cell">Size</th>
              <th className="hidden p-2 sm:table-cell">HSN</th>
              <th className="p-2 text-right">GST</th>
            </tr>
          </thead>
          <tbody>
            {ref_.types.map((t) => (
              <tr key={t.id} className="border-t">
                <td className="p-2">
                  <Code>
                    {publicPrefix(
                      ref_.divisions.find((d) => d.code === t.div),
                      t,
                    )}
                  </Code>
                </td>
                <td className="p-2">
                  {t.name}{" "}
                  <span className="text-xs text-muted-foreground">
                    {t.div}·{t.code}
                  </span>
                </td>
                <td className="hidden p-2 sm:table-cell">{t.size_unit}</td>
                <td className="hidden p-2 code-tag text-xs sm:table-cell">{t.hsn}</td>
                <td className="p-2 text-right">{t.gst == null ? "5/18 rule" : `${t.gst}%`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!ro && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label="Division">
            <Select value={f.div} onChange={(e) => setF({ ...f, div: e.target.value })}>
              <option value="">—</option>
              {ref_.divisions.map((d) => (
                <option key={d.code} value={d.code}>
                  {d.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Code (3 letters)">
            <TextInput
              maxLength={3}
              value={f.code}
              onChange={(e) => setF({ ...f, code: e.target.value })}
            />
          </Field>
          <Field label="Name">
            <TextInput value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          </Field>
          <Field label="Public letter">
            <TextInput
              maxLength={1}
              value={f.letter}
              onChange={(e) => setF({ ...f, letter: e.target.value })}
            />
          </Field>
          <Field label="Size unit">
            <Select value={f.size_unit} onChange={(e) => setF({ ...f, size_unit: e.target.value })}>
              {["in", "mm", "ft", "W", "size", "none"].map((u) => (
                <option key={u}>{u}</option>
              ))}
            </Select>
          </Field>
          <Field label="UoM">
            <TextInput value={f.uom} onChange={(e) => setF({ ...f, uom: e.target.value })} />
          </Field>
          <Field label="HSN/SAC">
            <TextInput value={f.hsn} onChange={(e) => setF({ ...f, hsn: e.target.value })} />
          </Field>
          <Field label="GST %">
            <TextInput
              inputMode="decimal"
              value={f.gst}
              onChange={(e) => setF({ ...f, gst: e.target.value })}
            />
          </Field>
          <Button className="col-span-2 w-fit rounded-full" onClick={add}>
            <Plus className="size-4" />
            Add type
          </Button>
        </div>
      )}
    </Card>
  );
}

function CodeLists({ ref_, ro }: { ref_: RefData; ro: boolean }) {
  const inv = useInvalidate();
  const lists = [
    { kind: "material", label: "Materials", items: ref_.materials },
    { kind: "sport", label: "Sports", items: ref_.sports },
    { kind: "finish", label: "Finishes & colours", items: ref_.finishes },
    { kind: "apparel_size", label: "Apparel sizes", items: ref_.sizes },
  ];
  const [vals, setVals] = useState<Record<string, { code: string; name: string }>>({});
  async function add(kind: string, items: { code: string }[]) {
    const v = vals[kind] ?? { code: "", name: "" };
    const code = v.code.trim().toUpperCase();
    if (!code || !v.name.trim()) {
      toast.error("Enter a code and a name");
      return;
    }
    if (items.some((x) => x.code === code)) {
      toast.error(`${code} already exists`);
      return;
    }
    const { error } = await supabase
      .from("code_lists")
      .insert({ kind, code, name: v.name.trim(), sort: items.length + 1 });
    if (error) {
      toast.error(error.message);
      return;
    }
    setVals({ ...vals, [kind]: { code: "", name: "" } });
    toast.success(`Added ${v.name}`);
    inv("ref");
  }
  return (
    <Card>
      <CardTitle>Other code lists</CardTitle>
      {lists.map((l) => (
        <div key={l.kind} className="grid gap-2">
          <h3 className="text-sm font-bold">{l.label}</h3>
          <p className="text-sm leading-relaxed">
            {l.items.map((x) => (
              <span key={x.code} className="mr-3 inline-block">
                <Code>{x.code}</Code> {x.name}
              </span>
            ))}
          </p>
          {!ro && (
            <div className="flex flex-wrap items-end gap-2">
              <Field label="Code" className="w-24">
                <TextInput
                  maxLength={3}
                  value={vals[l.kind]?.code ?? ""}
                  onChange={(e) =>
                    setVals({
                      ...vals,
                      [l.kind]: { ...(vals[l.kind] ?? { name: "" }), code: e.target.value },
                    })
                  }
                />
              </Field>
              <Field label="Name" className="w-56">
                <TextInput
                  value={vals[l.kind]?.name ?? ""}
                  onChange={(e) =>
                    setVals({
                      ...vals,
                      [l.kind]: { ...(vals[l.kind] ?? { code: "" }), name: e.target.value },
                    })
                  }
                />
              </Field>
              <Button
                size="sm"
                variant="outline"
                className="rounded-full"
                onClick={() => add(l.kind, l.items)}
              >
                Add
              </Button>
            </div>
          )}
        </div>
      ))}
    </Card>
  );
}

function DataCard({ ro }: { ro: boolean }) {
  const inv = useInvalidate();
  const products = useProducts();
  const [confirm, setConfirm] = useState(false);
  const samples = (products.data ?? []).filter((p) => p.is_sample).length;
  async function backup() {
    try {
      const tables = [
        "products",
        "design_families",
        "vendors",
        "vendor_codes",
        "receipts",
        "receipt_lines",
        "adjustments",
        "product_photos",
      ] as const;
      const wb = XLSX.utils.book_new();
      for (const t of tables) {
        const { data, error } = await supabase.from(t).select("*");
        if (error) throw error;
        const rows = (data ?? []).map((r) =>
          Object.fromEntries(
            Object.entries(r).map(([k, v]) => [k, Array.isArray(v) ? v.join(", ") : v]),
          ),
        );
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), t.slice(0, 31));
      }
      XLSX.writeFile(wb, `Stockroom_Backup_${new Date().toISOString().slice(0, 10)}.xlsx`);
    } catch (e) {
      toast.error(errMsg(e));
    }
  }
  async function clearSamples() {
    if (!confirm) {
      setConfirm(true);
      return;
    }
    setConfirm(false);
    try {
      const { data: paths, error } = await supabase.rpc("clear_samples");
      if (error) throw error;
      if (paths?.length) await supabase.storage.from("media").remove(paths);
      toast.success("Sample data cleared");
      inv("products", "families", "vendors", "vendor_codes", "photos", "receipts");
    } catch (e) {
      toast.error(errMsg(e));
    }
  }
  return (
    <Card>
      <CardTitle>Data</CardTitle>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-sm">
          Everything in one Excel file: products, families, vendors, vendor codes, receipts,
          adjustments. Download one weekly.
        </span>
        <Button variant="outline" className="rounded-full" onClick={backup}>
          <Download className="size-4" />
          Download backup
        </Button>
      </div>
      {samples > 0 && !ro && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-sm">
            {samples} sample products (and sample vendors) are loaded for practice. Clear them
            before receiving real stock.
          </span>
          <Button variant="outline" className="rounded-full" onClick={clearSamples}>
            {confirm ? "Click again to delete sample data" : "Clear sample data"}
          </Button>
        </div>
      )}
    </Card>
  );
}
