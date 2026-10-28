import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Ban, FileUp, RefreshCw, Send, ShoppingCart } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { inr, type SaleLine } from "@/lib/domain";
import { errMsg, useInvalidate, useProducts, useSales } from "@/lib/data";
import { parseSalesRows } from "@/lib/sales";
import {
  cancelSale,
  connectZoho,
  disconnectZoho,
  pushSaleToZoho,
  syncZohoSales,
  zohoSyncStatus,
  type SyncResult,
} from "@/lib/zoho-sync.functions";
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
import { RecordSale } from "@/components/RecordSale";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/sales")({
  head: () => ({ meta: [{ title: "Sales · Sportagon Stockroom" }] }),
  validateSearch: (s: Record<string, unknown>): { sell?: string | undefined } => ({
    sell: typeof s["sell"] === "string" ? s["sell"] : undefined,
  }),
  component: SalesPage,
});

const keyOf = (s: SaleLine) =>
  s.zoho_item_id ? `i:${s.zoho_item_id}` : `n:${(s.item_name ?? "").trim().toLowerCase()}`;
const month = (d: string | null) => String(d ?? "").slice(0, 7);

function SalesPage() {
  const { canPublish } = useAuth();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const [selling, setSelling] = useState(!!search.sell);
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

  // One row per document (invoice / credit note / sale made here).
  const docs = useMemo(() => {
    const m = new Map<string, SaleLine[]>();
    for (const s of shown) {
      const k = `${s.source}|${s.doc_kind}|${s.doc_id}`;
      m.set(k, [...(m.get(k) ?? []), s]);
    }
    return [...m.values()].sort(
      (a, b) =>
        String(b[0]!.doc_date ?? "").localeCompare(String(a[0]!.doc_date ?? "")) ||
        String(b[0]!.updated_at).localeCompare(String(a[0]!.updated_at)),
    );
  }, [shown]);
  const customers = useMemo(
    () =>
      [...new Set((sales.data ?? []).map((s) => (s.customer ?? "").trim()).filter(Boolean))].sort(),
    [sales.data],
  );
  async function act(key: string, fn: () => Promise<string>) {
    setBusy(key);
    try {
      toast.success(await fn());
      await inv("sales", "products", "adjustments");
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy("");
    }
  }
  const closeSell = () => {
    setSelling(false);
    if (search.sell) navigate({ search: {}, replace: true });
  };

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
        lede="Record a sale here or invoice in Zoho Books — either way stock comes off once. Sales made here become Zoho invoices; Zoho invoices and credit notes flow back in, and voided or edited invoices correct themselves."
        right={
          canPublish ? (
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                className="rounded-full bg-accent text-accent-foreground hover:bg-accent/90"
                onClick={() => setSelling(true)}
              >
                <ShoppingCart className="size-4" /> Record a sale
              </Button>
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

      {selling && canPublish && products.data && (
        <RecordSale
          products={products.data}
          customers={customers}
          zohoOn={!!st?.configured}
          preset={search.sell}
          onClose={closeSell}
        />
      )}

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
          sub={st?.source === "app" ? "Zoho connected" : "Zoho not connected"}
        />
        <Tile
          k="Need a product"
          v={String(unmatched.length)}
          sub="Zoho items not matched yet"
          warn={unmatched.length > 0}
        />
      </div>

      {st && <ZohoConnect status={st} onChange={() => inv("zoho-status")} />}
      {canPublish && st?.source === "app" && !st.at && (
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
          What's sold
        </CardTitle>
        {sales.isLoading ? (
          <Empty>Loading…</Empty>
        ) : !docs.length ? (
          <Empty>No sales yet. Record a sale, sync with Zoho or import an export.</Empty>
        ) : (
          <ul className="grid gap-2">
            {docs.slice(0, 200).map((ls) => {
              const d = ls[0]!;
              const off = ["draft", "void"].includes(d.doc_status ?? "");
              const amount = ls.reduce((a, s) => a + Number(s.amount ?? 0), 0);
              const units = ls.reduce((a, s) => a + Number(s.qty), 0);
              const here = d.source === "app";
              const key = `${d.source}|${d.doc_id}`;
              return (
                <li
                  key={key}
                  className={cn(
                    "grid gap-2 rounded-xl border p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start",
                    off && "opacity-60",
                  )}
                >
                  <div className="grid min-w-0 gap-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                      <span className="text-xs text-muted-foreground">{d.doc_date ?? "—"}</span>
                      <span
                        className={cn("font-mono text-xs font-semibold", off && "line-through")}
                      >
                        {d.doc_no}
                      </span>
                      {d.doc_kind === "credit" ? (
                        <Pill tone="info">return</Pill>
                      ) : here ? (
                        <Pill tone="warn">here only — not in Zoho</Pill>
                      ) : (
                        <Pill tone="ok">Zoho</Pill>
                      )}
                      {off && <Pill>{d.doc_status}</Pill>}
                      <b className="wrap-any">{d.customer || "—"}</b>
                      {d.customer_phone && (
                        <span className="text-xs text-muted-foreground">{d.customer_phone}</span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {ls.map((s) => {
                        const p = s.product_id ? prodById.get(s.product_id) : undefined;
                        return p ? (
                          <Link
                            key={s.id}
                            to="/products"
                            search={{ sel: p.id }}
                            className="inline-flex items-center gap-1 rounded-lg bg-muted px-2 py-0.5 text-xs hover:underline"
                          >
                            <Code>{p.code}</Code>
                            <span className="wrap-any">{p.friendly_name}</span>
                            <b className="tabular-nums">
                              {s.doc_kind === "credit" ? "+" : "×"}
                              {Number(s.qty)}
                            </b>
                          </Link>
                        ) : (
                          <Pill key={s.id} tone="warn">
                            {s.item_name} ×{Number(s.qty)}
                          </Pill>
                        );
                      })}
                    </div>
                    {(d.note || d.recorded_by) && (
                      <span className="wrap-any text-xs text-muted-foreground">
                        {d.note}
                        {d.note && d.recorded_by ? " · " : ""}
                        {d.recorded_by ? `recorded by ${d.recorded_by.split("@")[0]}` : ""}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                    <span className="text-right text-sm tabular-nums">
                      <b>{inr(amount)}</b>
                      <span className="block text-[11px] text-muted-foreground">
                        {units} unit{units === 1 ? "" : "s"} · before GST
                      </span>
                    </span>
                    {canPublish && here && !off && (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          className="rounded-full"
                          disabled={!!busy || !st?.configured}
                          title={st?.configured ? "" : "Connect Zoho Books first"}
                          onClick={() =>
                            act(`push:${key}`, async () => {
                              const r = await pushSaleToZoho({ data: { docId: d.doc_id } });
                              return `In Zoho as ${r.docNo}`;
                            })
                          }
                        >
                          <Send className="size-4" /> Send to Zoho
                        </Button>
                        <CancelButton
                          busy={!!busy}
                          onConfirm={() =>
                            act(`cancel:${key}`, async () => {
                              const r = await cancelSale({
                                data: { source: "app", docId: d.doc_id },
                              });
                              return `${d.doc_no} cancelled — ${r.units} back in stock`;
                            })
                          }
                        />
                      </>
                    )}
                    {canPublish && !here && !off && d.doc_kind === "invoice" && d.zoho_doc_id && (
                      <CancelButton
                        label="Void in Zoho"
                        busy={!!busy}
                        onConfirm={() =>
                          act(`cancel:${key}`, async () => {
                            const r = await cancelSale({
                              data: { source: "zoho", docId: d.doc_id },
                            });
                            return `${d.doc_no} voided in Zoho — ${r.units} back in stock`;
                          })
                        }
                      />
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
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

/** One-time Zoho Books connection, done by the owner from here — no server secrets to edit. */
function ZohoConnect({ status, onChange }: { status: SyncResult; onChange: () => void }) {
  const { isOwner } = useAuth();
  const [clientId, setClientId] = useState("");
  const [secret, setSecret] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [sure, setSure] = useState(false);
  const SCOPE =
    "ZohoBooks.invoices.ALL,ZohoBooks.creditnotes.READ,ZohoBooks.contacts.ALL,ZohoBooks.settings.ALL";

  if (status.source === "app")
    return (
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>Zoho Books connected</CardTitle>
          <Pill tone="ok">{status.orgName ?? "Organisation 60089715531"}</Pill>
        </div>
        <p className="text-sm text-muted-foreground">
          Connected
          {status.connectedAt
            ? ` on ${new Date(status.connectedAt).toLocaleDateString("en-IN", { dateStyle: "medium" })}`
            : ""}
          {status.connectedBy ? ` by ${status.connectedBy}` : ""}. Invoices take stock out and
          credit notes put it back, automatically.
        </p>
        {isOwner && (
          <Button
            size="sm"
            variant={sure ? "destructive" : "ghost"}
            className="w-fit rounded-full"
            disabled={busy}
            onClick={async () => {
              if (!sure) {
                setSure(true);
                return;
              }
              setBusy(true);
              try {
                await disconnectZoho();
                toast.success("Zoho Books disconnected");
                onChange();
              } catch (e) {
                toast.error(errMsg(e));
              } finally {
                setBusy(false);
                setSure(false);
              }
            }}
          >
            {sure ? "Yes, disconnect" : "Disconnect"}
          </Button>
        )}
      </Card>
    );

  return (
    <Card>
      <CardTitle>Connect Zoho Books (one time, about 3 minutes)</CardTitle>
      {!isOwner ? (
        <p className="text-sm text-muted-foreground">
          The owner connects Zoho Books from this page. Until then, use Import Zoho export.
        </p>
      ) : (
        <>
          {status.source === "secrets" && (
            <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
              Zoho keys saved earlier in Lovable aren't working. Connect here instead — this
              replaces them.
            </p>
          )}
          <ol className="grid list-decimal gap-2 pl-5 text-sm">
            <li>
              Open{" "}
              <a
                href="https://api-console.zoho.in/"
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold text-primary underline-offset-2 hover:underline"
              >
                api-console.zoho.in
              </a>{" "}
              (signed in to the Zoho account that owns Sportagon Books) → <b>Add Client</b> →{" "}
              <b>Self Client</b> → <b>Create</b>. Open the <b>Client Secret</b> tab and copy the
              Client ID and Client Secret below.
            </li>
            <li>
              Open the <b>Generate Code</b> tab. In <b>Scope</b> paste{" "}
              <button
                type="button"
                className="inline"
                onClick={() =>
                  navigator.clipboard?.writeText(SCOPE).then(() => toast.success("Scope copied"))
                }
              >
                <Code>{SCOPE}</Code>
              </button>
              , time duration <b>10 minutes</b>, description “Stockroom” → <b>Create</b>, choose the
              Sportagon organisation, and copy the code.
            </li>
            <li>
              Paste it below and press <b>Connect</b> within 10 minutes.
            </li>
          </ol>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Client ID">
              <TextInput
                value={clientId}
                autoComplete="off"
                spellCheck={false}
                placeholder="1000.XXXX…"
                onChange={(e) => setClientId(e.target.value)}
              />
            </Field>
            <Field label="Client Secret">
              <TextInput
                type="password"
                value={secret}
                autoComplete="off"
                onChange={(e) => setSecret(e.target.value)}
              />
            </Field>
            <Field label="Generated code">
              <TextInput
                value={code}
                autoComplete="off"
                spellCheck={false}
                placeholder="1000.xxxx…"
                onChange={(e) => setCode(e.target.value)}
              />
            </Field>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              className="rounded-full"
              disabled={busy || !clientId.trim() || !secret.trim() || !code.trim()}
              onClick={async () => {
                setBusy(true);
                try {
                  const r = await connectZoho({
                    data: { clientId, clientSecret: secret, code },
                  });
                  toast.success(`Zoho Books connected${r.orgName ? ` — ${r.orgName}` : ""}`);
                  setClientId("");
                  setSecret("");
                  setCode("");
                  onChange();
                } catch (e) {
                  toast.error(errMsg(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? "Connecting…" : "Connect"}
            </Button>
            <span className="text-xs text-muted-foreground">
              Reads invoices and credit notes, and creates invoices (with their customer and item)
              for sales recorded here. Keys are stored on the server only — never shown again or
              sent to the browser.
            </span>
          </div>
        </>
      )}
      <Notice>
        No connection yet? Export Invoices (and Credit Notes) from Zoho Books as CSV/XLSX and use{" "}
        <b>Import Zoho export</b>. Re-importing the same file never double-counts.
      </Notice>
    </Card>
  );
}

function CancelButton({
  label = "Cancel sale",
  busy,
  onConfirm,
}: {
  label?: string;
  busy: boolean;
  onConfirm: () => void;
}) {
  const [sure, setSure] = useState(false);
  return (
    <Button
      size="sm"
      variant={sure ? "destructive" : "ghost"}
      className="rounded-full"
      disabled={busy}
      onBlur={() => setSure(false)}
      onClick={() => {
        if (!sure) {
          setSure(true);
          return;
        }
        setSure(false);
        onConfirm();
      }}
    >
      <Ban className="size-4" /> {sure ? "Tap again — stock goes back" : label}
    </Button>
  );
}
