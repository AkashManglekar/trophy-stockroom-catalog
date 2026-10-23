import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { FileUp, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { inr, type SaleLine } from "@/lib/domain";
import { errMsg, useInvalidate, useProducts, useSales } from "@/lib/data";
import { parseSalesRows } from "@/lib/sales";
import { syncZohoSales, zohoSyncStatus } from "@/lib/zoho-sync.functions";
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
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/sales")({
  head: () => ({ meta: [{ title: "Sales · Sportagon Stockroom" }] }),
  component: SalesPage,
});

const keyOf = (s: SaleLine) =>
  s.zoho_item_id ? `i:${s.zoho_item_id}` : `n:${(s.item_name ?? "").trim().toLowerCase()}`;
const month = (d: string | null) => String(d ?? "").slice(0, 7);

function SalesPage() {
  const { canPublish } = useAuth();
  const sales = useSales(400);
  const products = useProducts();
  const inv = useInvalidate();
  const status = useQuery({ queryKey: ["zoho-status"], queryFn: () => zohoSyncStatus() });
  const [busy, setBusy] = useState("");
  const [from, setFrom] = useState("");
  const [q, setQ] = useState("");
  const prodById = useMemo(
    () => new Map((products.data ?? []).map((p) => [p.id, p])),
    [products.data],
  );

  const lines = (sales.data ?? []).filter((s) => Number(s.qty) !== 0);
  const live = lines.filter((s) => !["draft", "void"].includes(s.doc_status ?? ""));
  const thisMonth = new Date().toISOString().slice(0, 7);
  const mSales = live.filter((s) => s.doc_kind === "invoice" && month(s.doc_date) === thisMonth);
  const mReturns = live.filter((s) => s.doc_kind === "credit" && month(s.doc_date) === thisMonth);
  const revenue =
    mSales.reduce((a, s) => a + Number(s.amount ?? 0), 0) -
    mReturns.reduce((a, s) => a + Number(s.amount ?? 0), 0);
  const unmatched = useMemo(() => {
    const m = new Map<string, { key: string; name: string; qty: number; docs: Set<string> }>();
    for (const s of lines.filter((x) => !x.product_id)) {
      const k = keyOf(s);
      const g = m.get(k) ?? { key: k, name: s.item_name ?? s.sku ?? "?", qty: 0, docs: new Set() };
      g.qty += Number(s.qty);
      g.docs.add(s.doc_no ?? s.doc_id);
      m.set(k, g);
    }
    return [...m.values()].sort((a, b) => b.qty - a.qty);
  }, [lines]);
  const shown = lines.filter((s) => {
    const t = q.trim().toLowerCase();
    if (!t) return true;
    const p = s.product_id ? prodById.get(s.product_id) : undefined;
    return `${s.doc_no} ${s.customer} ${s.item_name} ${p?.code ?? ""} ${p?.friendly_name ?? ""}`
      .toLowerCase()
      .includes(t);
  });

  async function sync() {
    setBusy("sync");
    try {
      const r = await syncZohoSales({
        data: { force: true, fromDate: from ? new Date(from).toISOString() : undefined },
      });
      if (r.error) throw new Error(r.error);
      if (!r.configured) {
        toast.error("Zoho isn't connected yet — see the steps below");
        return;
      }
      toast.success(
        `Synced ${r.docs} document${r.docs === 1 ? "" : "s"} · ${r.unitsApplied} unit${r.unitsApplied === 1 ? "" : "s"} moved` +
          (r.unmatched ? ` · ${r.unmatched} line(s) need a product` : ""),
      );
      await inv("sales", "products", "adjustments", "zoho-status");
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy("");
    }
  }
  async function importFile(f: File | undefined) {
    if (!f) return;
    setBusy("file");
    try {
      const XLSX = await import("xlsx");
      const wb = XLSX.read(await f.arrayBuffer(), { type: "array", cellDates: false });
      const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0] ?? ""]!, {
        header: 1,
        raw: false,
        defval: "",
      });
      const { docs, problems } = parseSalesRows(rows);
      if (problems.length) throw new Error(problems.join("; "));
      if (!docs.length) throw new Error("No invoice lines found in that file");
      let units = 0;
      let unm = 0;
      for (let i = 0; i < docs.length; i += 50) {
        const { data, error } = await supabase.rpc("apply_sales", {
          p_docs: docs.slice(i, i + 50),
          p_source: "zoho",
        });
        if (error) throw error;
        const r = data as { units_applied: number; unmatched: number };
        units += r.units_applied;
        unm = r.unmatched;
      }
      toast.success(
        `Imported ${docs.length} ${docs[0]!.kind === "credit" ? "credit note" : "invoice"}${docs.length === 1 ? "" : "s"} · ${units} units moved` +
          (unm ? ` · ${unm} line(s) need a product` : ""),
      );
      await inv("sales", "products", "adjustments");
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy("");
    }
  }
  async function map(key: string, productId: string) {
    if (!productId) return;
    const { data, error } = await supabase.rpc("map_sale_item", {
      p_key: key,
      p_product: productId,
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(`Mapped — ${data} line(s) applied; future sales of this item map automatically`);
    await inv("sales", "products", "adjustments");
  }

  const st = status.data;
  return (
    <>
      <PageHead
        title="Sales"
        lede="Sales come from Zoho Books: every invoice takes stock out, credit notes put it back, voided or edited invoices correct themselves."
        right={
          canPublish ? (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" className="rounded-full" disabled={!!busy} onClick={sync}>
                <RefreshCw className={cn("size-4", busy === "sync" && "animate-spin")} /> Sync now
              </Button>
              <label
                className={cn(
                  "inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-[12px] font-semibold hover:border-primary",
                  busy && "pointer-events-none opacity-60",
                )}
              >
                <FileUp className="size-4" /> Import Zoho export
                <input
                  type="file"
                  hidden
                  accept=".csv,.xlsx,.xls"
                  onChange={(e) => {
                    importFile(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
              </label>
            </div>
          ) : null
        }
      />

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Tile k="Sales this month" v={inr(Math.round(revenue))} sub="before GST, net of returns" />
        <Tile k="Units sold this month" v={String(mSales.reduce((a, s) => a + Number(s.qty), 0))} />
        <Tile
          k="Last sync"
          v={
            st?.at
              ? new Date(st.at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })
              : "Never"
          }
          sub={st?.configured ? "Zoho connected" : "Zoho not connected"}
        />
        <Tile
          k="Need a product"
          v={String(unmatched.length)}
          sub="Zoho items not matched yet"
          warn={unmatched.length > 0}
        />
      </div>

      {st && !st.configured && (
        <Card>
          <CardTitle>Connect Zoho Books (one time)</CardTitle>
          <ol className="grid list-decimal gap-1.5 pl-5 text-sm">
            <li>
              Open the Zoho API console (api-console.zoho.in) → <b>Self Client</b> → create it.
            </li>
            <li>
              Generate a code with scope{" "}
              <Code>ZohoBooks.invoices.READ,ZohoBooks.creditnotes.READ</Code>, then exchange it for
              a <b>refresh token</b>.
            </li>
            <li>
              In Lovable → Cloud → Secrets add <Code>ZOHO_CLIENT_ID</Code>,{" "}
              <Code>ZOHO_CLIENT_SECRET</Code>, <Code>ZOHO_REFRESH_TOKEN</Code> (organisation
              60089715531 is the default).
            </li>
            <li>
              In Zoho Books turn on <b>SKU</b> for items and use the stockroom SKUs (TC-1005-11…) —
              or map each Zoho item once below.
            </li>
          </ol>
          <Notice>
            Until then, export Invoices (and Credit Notes) from Zoho Books as CSV/XLSX and use{" "}
            <b>Import Zoho export</b>. Re-importing the same file never double-counts.
          </Notice>
        </Card>
      )}
      {canPublish && st?.configured && !st.at && (
        <Card>
          <CardTitle>First sync</CardTitle>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[220px_1fr] sm:items-end">
            <Field label="Bring in sales from" hint="Default: the last 30 days">
              <TextInput type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </Field>
            <p className="text-sm text-muted-foreground">
              Pick the date you started counting stock here, so older sales don't reduce stock
              twice. After this, syncing picks up only what changed and runs by itself every 15
              minutes while someone has the app open.
            </p>
          </div>
        </Card>
      )}

      {unmatched.length > 0 && (
        <Card className="border-warning">
          <CardTitle>Zoho items to match · {unmatched.length}</CardTitle>
          <p className="text-sm text-muted-foreground">
            These sold in Zoho but no stockroom product matched by SKU or name. Pick the product
            once — stock is corrected now and every future sale of that item maps automatically.
          </p>
          <div className="grid gap-2">
            {unmatched.map((u) => (
              <div
                key={u.key}
                className="grid gap-2 rounded-xl border p-2.5 sm:grid-cols-[1fr_320px] sm:items-center"
              >
                <div className="min-w-0">
                  <strong className="wrap-any text-sm">{u.name}</strong>
                  <p className="text-xs text-muted-foreground">
                    {u.qty} sold · {[...u.docs].slice(0, 4).join(", ")}
                    {u.docs.size > 4 ? "…" : ""}
                  </p>
                </div>
                <Select
                  disabled={!canPublish}
                  defaultValue=""
                  onChange={(e) => map(u.key, e.target.value)}
                >
                  <option value="">Choose stockroom product…</option>
                  {(products.data ?? [])
                    .filter((p) => p.status !== "Archived")
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.code} · {p.friendly_name}
                      </option>
                    ))}
                </Select>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card>
        <CardTitle
          right={
            <TextInput
              type="search"
              className="h-9 w-56"
              placeholder="Invoice, customer, code…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          }
        >
          Sales lines
        </CardTitle>
        {sales.isLoading ? (
          <Empty>Loading…</Empty>
        ) : !shown.length ? (
          <Empty>No sales yet. Sync with Zoho or import an export.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted text-left text-[10.5px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="p-2">Date</th>
                  <th className="p-2">Document</th>
                  <th className="hidden p-2 sm:table-cell">Customer</th>
                  <th className="p-2">Product</th>
                  <th className="p-2 text-right">Qty</th>
                  <th className="hidden p-2 text-right sm:table-cell">Amount</th>
                </tr>
              </thead>
              <tbody>
                {shown.slice(0, 300).map((s) => {
                  const p = s.product_id ? prodById.get(s.product_id) : undefined;
                  const off = ["draft", "void"].includes(s.doc_status ?? "");
                  return (
                    <tr key={s.id} className={cn("border-t", off && "opacity-50 line-through")}>
                      <td className="whitespace-nowrap p-2 text-xs">{s.doc_date ?? "—"}</td>
                      <td className="p-2">
                        <span className="font-mono text-xs">{s.doc_no}</span>{" "}
                        {s.doc_kind === "credit" && <Pill tone="info">return</Pill>}
                        {off && <Pill>{s.doc_status}</Pill>}
                      </td>
                      <td className="wrap-any hidden p-2 text-xs sm:table-cell">{s.customer}</td>
                      <td className="p-2">
                        {p ? (
                          <Link to="/products" search={{ sel: p.id }} className="hover:underline">
                            <Code>{p.code}</Code>
                          </Link>
                        ) : (
                          <Pill tone="warn">{s.item_name}</Pill>
                        )}
                      </td>
                      <td className="p-2 text-right tabular-nums">
                        {s.doc_kind === "credit" ? "+" : "−"}
                        {Number(s.qty)}
                      </td>
                      <td className="hidden p-2 text-right tabular-nums sm:table-cell">
                        {s.amount != null ? inr(Number(s.amount)) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

function Tile({ k, v, sub, warn }: { k: string; v: string; sub?: string; warn?: boolean }) {
  return (
    <div className={cn("panel grid gap-0.5 p-3", warn && "border-warning")}>
      <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {k}
      </span>
      <b className="wrap-any text-lg tabular-nums">{v}</b>
      {sub && <span className="text-[11px] text-muted-foreground">{sub}</span>}
    </div>
  );
}
