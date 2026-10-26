import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, Pencil, Plus, Trash2, Undo2, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { RECEIPT_TYPES, inr, num, type Product, type ReceiptType } from "@/lib/domain";
import {
  errMsg,
  repriceProducts,
  useBills,
  usePayments,
  useReviews,
  useInvalidate,
  useProducts,
  useRefData,
  useVendors,
  type BillWithLines,
} from "@/lib/data";
import { CHARGE_LABELS, newDraft, newLine } from "@/lib/draft";
import { chargeAllocation } from "@/lib/receive-plan";
import { withThumbs } from "@/lib/photos";
import { PAY_LABEL, PAY_TONE, billMoney, today } from "@/lib/finance";
import { PAY_MODES } from "@/lib/domain";
import { GST_RATES, SUPPLY_LABEL, supplyTypeFor, type SupplyType } from "@/lib/gst";
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

type Search = { q?: string | undefined; sel?: string | undefined; kind?: string | undefined };

export const Route = createFileRoute("/_app/bills")({
  head: () => ({ meta: [{ title: "Bills · Sportagon Stockroom" }] }),
  validateSearch: (s: Record<string, unknown>): Search => ({
    q: typeof s["q"] === "string" ? s["q"] : undefined,
    sel: typeof s["sel"] === "string" ? s["sel"] : undefined,
    kind: typeof s["kind"] === "string" ? s["kind"] : undefined,
  }),
  component: BillsPage,
});

type Charge = { label: string; amount: number; gst: number };
const chargesOf = (b: BillWithLines): Charge[] =>
  Array.isArray(b.charges)
    ? (b.charges as unknown as Charge[]).map((c) => ({
        label: String(c.label ?? "Other"),
        amount: Number(c.amount) || 0,
        gst: Number(c.gst) || 0,
      }))
    : [];
const goodsOf = (b: BillWithLines) =>
  b.goods_value ??
  b.lines.reduce(
    (a, l) => a + (Number(l.unit_cost) || 0) * Number(l.billed_qty ?? l.received_qty),
    0,
  );

function BillsPage() {
  const search = Route.useSearch();
  const nav = Route.useNavigate();
  const set = (patch: Partial<Search>) =>
    nav({ search: (s: Search) => ({ ...s, ...patch }), replace: true });
  const bills = useBills();
  const payments = usePayments();
  const money = (b: BillWithLines) => billMoney(b, payments.data ?? []);
  const vendors = useVendors();
  const products = useProducts();
  const [q, setQ] = useState(search.q ?? "");
  const prodById = useMemo(
    () => new Map((products.data ?? []).map((p) => [p.id, p])),
    [products.data],
  );
  const vName = (id: string | null) =>
    vendors.data?.find((v) => v.id === id)?.display_name ?? (id ? "Unknown vendor" : "No vendor");

  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (bills.data ?? []).filter((b) => {
      if (search.kind === "bill" && b.receipt_type !== "bill") return false;
      if (search.kind === "nobill" && b.receipt_type === "bill") return false;
      if (search.kind === "reversed" && !b.reversed_at) return false;
      if (search.kind === "unpaid" && !["unpaid", "partly", "overdue"].includes(money(b).status))
        return false;
      if (search.kind === "overdue" && money(b).status !== "overdue") return false;
      if (!t) return true;
      const hay = [
        vName(b.vendor_id),
        b.bill_no,
        b.bill_date,
        b.created_by_email,
        ...b.lines.map((l) => {
          const p = l.product_id ? prodById.get(l.product_id) : undefined;
          return `${p?.code ?? ""} ${p?.friendly_name ?? ""} ${l.description ?? ""} ${l.vendor_item_code ?? ""}`;
        }),
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(t);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bills.data, q, search.kind, prodById, vendors.data, payments.data]);

  const sel = search.sel ? (bills.data ?? []).find((b) => b.id === search.sel) : undefined;
  const active = (bills.data ?? []).filter((b) => !b.reversed_at && b.receipt_type === "bill");
  const spend = active.reduce((a, b) => a + Number(b.total_cost ?? goodsOf(b)), 0);
  const owed = active.reduce((a, b) => a + money(b).balance, 0);
  const overdue = active.filter((b) => money(b).status === "overdue");

  return (
    <>
      <PageHead
        title="Bills"
        lede="Every bill and stock receipt, with what it added. Open one to see its lines, cost to company and the products it created."
        right={
          <Button size="sm" className="rounded-full" asChild>
            <Link to="/receive">
              <Plus className="size-4" /> Receive a bill
            </Link>
          </Button>
        }
      />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-[1fr_200px]">
        <Field label="Search vendor, bill no., product" className="col-span-2 sm:col-span-1">
          <TextInput
            type="search"
            value={q}
            placeholder="Swastik, INV-204, TC-1005…"
            onChange={(e) => setQ(e.target.value)}
            onBlur={() => set({ q: q || undefined })}
          />
        </Field>
        <Field label="Show" className="col-span-2 sm:col-span-1">
          <Select
            value={search.kind ?? ""}
            onChange={(e) => set({ kind: e.target.value || undefined })}
          >
            <option value="">All receipts</option>
            <option value="bill">Vendor bills</option>
            <option value="nobill">Without a bill</option>
            <option value="unpaid">To pay</option>
            <option value="overdue">Overdue</option>
            <option value="reversed">Reversed</option>
          </Select>
        </Field>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Pill>{list.length} shown</Pill>
        <Pill>
          {active.length} active bills · {inr(Math.round(spend))} cost to company
        </Pill>
        {owed > 0.5 && <Pill tone="warn">{inr(Math.round(owed))} to pay</Pill>}
        {overdue.length > 0 && (
          <button onClick={() => set({ kind: "overdue" })}>
            <Pill tone="bad" className="cursor-pointer">
              {overdue.length} overdue
            </Pill>
          </button>
        )}
      </div>
      <div
        className={cn(
          "grid items-start gap-5",
          sel && "lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]",
        )}
      >
        <div className="grid min-w-0 gap-2">
          {bills.isLoading ? (
            <Empty>Loading…</Empty>
          ) : !list.length ? (
            <Empty>{bills.data?.length ? "No bills match." : "No bills yet."}</Empty>
          ) : (
            list.map((b) => {
              const units = b.lines.reduce((a, l) => a + l.received_qty, 0);
              const isOn = sel?.id === b.id;
              return (
                <button
                  key={b.id}
                  onClick={() => set({ sel: b.id })}
                  className={cn(
                    "panel grid gap-1 p-3 text-left hover:border-primary",
                    isOn && "ring-2 ring-accent",
                    b.reversed_at && "opacity-70",
                  )}
                >
                  <span className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span>
                      {String(b.bill_date ?? b.created_at).slice(0, 10)} ·{" "}
                      {RECEIPT_TYPES[b.receipt_type as ReceiptType]?.label ?? b.receipt_type}
                    </span>
                    <span className="flex gap-1">
                      {b.edited_at && <Pill tone="info">edited</Pill>}
                      {b.reversed_at && <Pill tone="bad">reversed</Pill>}
                    </span>
                  </span>
                  <span className="flex flex-wrap items-baseline justify-between gap-2">
                    <strong className="wrap-any text-sm">
                      {vName(b.vendor_id)}
                      {b.bill_no ? ` · ${b.bill_no}` : ""}
                    </strong>
                    <span className="whitespace-nowrap text-sm font-bold tabular-nums">
                      {inr(Number(b.total_cost ?? goodsOf(b)))}
                    </span>
                  </span>
                  <span className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span>
                      {b.lines.length} lines · {units} units ·{" "}
                      {b.lines.filter((l) => l.created_new).length} new
                    </span>
                    {(() => {
                      const m = money(b);
                      return m.status === "none" || m.status === "reversed" ? null : (
                        <Pill tone={PAY_TONE[m.status]}>
                          {PAY_LABEL[m.status]}
                          {m.balance > 0.5 ? ` · ${inr(m.balance)}` : ""}
                        </Pill>
                      );
                    })()}
                  </span>
                </button>
              );
            })
          )}
        </div>
        {sel && (
          <BillPanel
            key={sel.id + (sel.edited_at ?? "")}
            b={sel}
            vendorName={vName(sel.vendor_id)}
            prodById={prodById}
            onClose={() => set({ sel: undefined })}
          />
        )}
      </div>
    </>
  );
}

function BillPanel({
  b,
  vendorName,
  prodById,
  onClose,
}: {
  b: BillWithLines;
  vendorName: string;
  prodById: Map<string, Product>;
  onClose: () => void;
}) {
  const { isOwner, canPublish } = useAuth();
  const inv = useInvalidate();
  const [editing, setEditing] = useState(false);
  const [sure, setSure] = useState("");
  const [busy, setBusy] = useState("");
  const charges = chargesOf(b);
  const goods = Number(goodsOf(b));
  const chargesTotal = Number(b.charges_total ?? charges.reduce((a, c) => a + c.amount, 0));
  const isBill = b.receipt_type === "bill";

  async function act(key: string, fn: () => Promise<void>) {
    if (sure !== key) {
      setSure(key);
      return;
    }
    setSure("");
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy("");
    }
  }
  const reverse = () =>
    act("rev", async () => {
      const { error } = await supabase.rpc("reverse_receipt", { p_receipt: b.id });
      if (error) throw error;
      toast.success("Bill reversed — its stock was removed");
      await inv("receipts", "products", "adjustments");
    });
  const remove = () =>
    act("del", async () => {
      const { data, error } = await supabase.rpc("delete_bill", { p_receipt: b.id });
      if (error) throw error;
      if (data?.length) await supabase.storage.from("media").remove(withThumbs(data));
      toast.success("Bill deleted");
      onClose();
      await inv("receipts", "products", "families", "photos", "adjustments", "vendor_codes");
    });

  return (
    <aside
      className="panel fixed inset-0 z-40 grid content-start gap-4 overflow-y-auto p-4 lg:sticky lg:inset-auto lg:top-20 lg:z-0 lg:max-h-[calc(100dvh-6rem)] lg:p-5"
      style={{
        paddingTop: "max(1rem, env(safe-area-inset-top))",
        paddingBottom: "max(1.5rem, env(safe-area-inset-bottom))",
      }}
      aria-label="Bill detail"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">
            {RECEIPT_TYPES[b.receipt_type as ReceiptType]?.label ?? b.receipt_type} ·{" "}
            {String(b.bill_date ?? b.created_at).slice(0, 10)}
          </p>
          <h3 className="wrap-any text-lg font-bold">
            {vendorName}
            {b.bill_no ? ` · ${b.bill_no}` : ""}
          </h3>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {b.reversed_at && (
              <Pill tone="bad">
                reversed {String(b.reversed_at).slice(0, 10)} by {b.reversed_by_email ?? "—"}
              </Pill>
            )}
            {b.edited_at && (
              <Pill tone="info">
                edited {String(b.edited_at).slice(0, 10)} by {b.edited_by_email ?? "—"}
              </Pill>
            )}
          </div>
        </div>
        <Button size="icon" variant="ghost" className="shrink-0 rounded-full" onClick={onClose}>
          <ArrowLeft className="size-4 lg:hidden" />
          <X className="hidden size-4 lg:block" />
        </Button>
      </div>

      {editing ? (
        <BillEditor b={b} prodById={prodById} onDone={() => setEditing(false)} />
      ) : (
        <>
          {isBill && (
            <section className="grid gap-1.5 rounded-xl border p-3 text-sm">
              <h4 className="text-xs font-extrabold uppercase tracking-[0.1em] text-muted-foreground">
                Cost to company
              </h4>
              <Row k="Goods (before GST)" v={goods} />
              {charges.map((c, i) => (
                <Row key={i} k={`${c.label}${c.gst ? ` · GST ${c.gst}%` : ""}`} v={c.amount} />
              ))}
              {!charges.length && <Row k="Other charges" v={chargesTotal} />}
              {breakupOf(b).length ? (
                <GstRows breakup={breakupOf(b)} type={b.gst_type === "igst" ? "igst" : "intra"} />
              ) : (
                <Row k="GST" v={Number(b.gst_total ?? 0)} />
              )}
              {breakupOf(b).length > 0 &&
                Math.abs(Number(b.gst_total ?? 0) - slabTotal(breakupOf(b))) > 0.5 && (
                  <Row k="GST as printed on the bill" v={Number(b.gst_total ?? 0)} />
                )}
              <div className="flex justify-between gap-3 border-t pt-1.5 font-extrabold tabular-nums">
                <span>Total</span>
                <span>
                  {inr(Number(b.total_cost ?? goods + chargesTotal + Number(b.gst_total ?? 0)))}
                </span>
              </div>
              {b.bill_total != null && (
                <p className="text-xs text-muted-foreground">
                  Bill total before GST as printed: {inr(Number(b.bill_total))}
                </p>
              )}
            </section>
          )}

          <section className="grid gap-2">
            <h4 className="text-xs font-extrabold uppercase tracking-[0.1em] text-muted-foreground">
              Lines · {b.lines.length}
            </h4>
            <div className="grid gap-1.5">
              {b.lines.map((l) => {
                const p = l.product_id ? prodById.get(l.product_id) : undefined;
                const short = l.billed_qty != null && l.received_qty < Number(l.billed_qty);
                return (
                  <div key={l.id} className="grid gap-1 rounded-lg border p-2.5 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      {p ? (
                        <Link
                          to="/products"
                          search={{ sel: p.id }}
                          className="underline-offset-2 hover:underline"
                        >
                          <Code>{p.code}</Code>
                        </Link>
                      ) : (
                        <Code>—</Code>
                      )}
                      <span className="wrap-any min-w-0 flex-1">
                        {p?.friendly_name ?? l.description}
                      </span>
                      {l.created_new && <Pill tone="info">created here</Pill>}
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground tabular-nums">
                      <span className={cn(short && "text-destructive")}>
                        {l.received_qty} received
                        {l.billed_qty != null ? ` of ${Number(l.billed_qty)} billed` : ""}
                      </span>
                      {l.unit_cost != null && <span>{inr(Number(l.unit_cost))} each</span>}
                      {l.gst_rate != null && <span>GST {Number(l.gst_rate)}%</span>}
                      {l.extra_cost != null && Number(l.extra_cost) > 0 && (
                        <span>+ {inr(Number(l.extra_cost))} charges</span>
                      )}
                      {l.vendor_item_code && <span>vendor code {l.vendor_item_code}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {isBill && !b.reversed_at && <BillPayments b={b} />}
          {isBill && b.vendor_id && <BillFeedback b={b} />}

          <section className="grid gap-1 text-xs text-muted-foreground">
            <span>
              Recorded {String(b.created_at).slice(0, 16).replace("T", " ")} by{" "}
              {b.created_by_email ?? "—"}
              {b.approved_by_email ? ` · approved by ${b.approved_by_email}` : ""}
            </span>
            {b.notes && <span>Note: {b.notes}</span>}
          </section>

          {(isOwner || canPublish) && (
            <div className="flex flex-wrap gap-2 border-t pt-3">
              {isOwner && !b.reversed_at && (
                <Button size="sm" className="rounded-full" onClick={() => setEditing(true)}>
                  <Pencil className="size-4" /> Edit bill
                </Button>
              )}
              {!b.reversed_at && (
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-full"
                  disabled={!!busy}
                  onClick={reverse}
                >
                  <Undo2 className="size-4" />{" "}
                  {sure === "rev" ? "Tap again — removes this bill's stock" : "Reverse"}
                </Button>
              )}
              {isOwner && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="rounded-full text-destructive"
                  disabled={!!busy}
                  onClick={remove}
                >
                  <Trash2 className="size-4" />{" "}
                  {sure === "del" ? "Tap again — delete for good" : "Delete"}
                </Button>
              )}
            </div>
          )}
          {isOwner && (
            <p className="text-xs text-muted-foreground">
              <b>Reverse</b> takes the bill's stock back out and keeps it in history. <b>Delete</b>{" "}
              also removes it from history, plus any product it created that has no other bill and
              no stock.
            </p>
          )}
        </>
      )}
    </aside>
  );
}

type Slab = { rate: number; taxable: number; tax: number };
const r2 = (x: number) => Math.round(x * 100) / 100;
function makeBreakup(items: { rate: number; taxable: number }[]): Slab[] {
  const m = new Map<number, Slab>();
  for (const it of items) {
    if (!(it.taxable > 0)) continue;
    const s = m.get(it.rate) ?? { rate: it.rate, taxable: 0, tax: 0 };
    s.taxable += it.taxable;
    s.tax += (it.taxable * it.rate) / 100;
    m.set(it.rate, s);
  }
  return [...m.values()]
    .map((x) => ({ rate: x.rate, taxable: r2(x.taxable), tax: r2(x.tax) }))
    .sort((a, b) => a.rate - b.rate);
}
const breakupOf = (b: BillWithLines): Slab[] =>
  Array.isArray(b.gst_breakup) ? (b.gst_breakup as unknown as Slab[]) : [];
const slabTotal = (xs: Slab[]) => r2(xs.reduce((a, x) => a + Number(x.tax), 0));

/** GST by rate: IGST for another state, or CGST + SGST (half each) for the same state. */
function GstRows({ breakup, type }: { breakup: Slab[]; type: SupplyType }) {
  return (
    <>
      <div className="text-xs text-muted-foreground">{SUPPLY_LABEL[type]}</div>
      {breakup.map((x) =>
        type === "intra" ? (
          <div key={x.rate} className="grid gap-0.5">
            <Row k={`CGST ${x.rate / 2}% on ${inr(x.taxable)}`} v={x.tax / 2} />
            <Row k={`SGST ${x.rate / 2}% on ${inr(x.taxable)}`} v={x.tax / 2} />
          </div>
        ) : (
          <Row key={x.rate} k={`IGST ${x.rate}% on ${inr(x.taxable)}`} v={x.tax} />
        ),
      )}
    </>
  );
}

function Row({ k, v }: { k: string; v: number }) {
  return (
    <div className="flex justify-between gap-3 tabular-nums">
      <span>{k}</span>
      <span>{inr(v)}</span>
    </div>
  );
}

type EditLine = {
  id: string;
  productId: string | null;
  cost: string;
  billed: string;
  received: string;
  gst: string;
};
type EditCharge = { id: string; label: string; amount: string; gst: string };

/** Owner correction of a bill: header, charges, GST and each line's cost and quantities. */
function BillEditor({
  b,
  prodById,
  onDone,
}: {
  b: BillWithLines;
  prodById: Map<string, Product>;
  onDone: () => void;
}) {
  const vendors = useVendors();
  const products = useProducts();
  const ref = useRefData();
  const inv = useInvalidate();
  const isBill = b.receipt_type === "bill";
  const [h, setH] = useState({
    vendor_id: b.vendor_id ?? "",
    bill_no: b.bill_no ?? "",
    bill_date: String(b.bill_date ?? "").slice(0, 10),
    bill_total: b.bill_total != null ? String(b.bill_total) : "",
    notes: b.notes ?? "",
    // keep the typed GST only if it differed from what the lines added up to
    gst:
      b.gst_total != null && Math.abs(Number(b.gst_total) - slabTotal(breakupOf(b))) > 0.5
        ? String(b.gst_total)
        : "",
    gstType: (b.gst_type === "igst" || b.gst_type === "intra"
      ? b.gst_type
      : (supplyTypeFor(
          vendors.data?.find((v) => v.id === b.vendor_id) as never,
          ref.data?.settings.company_state ?? "MH",
        ) ?? "intra")) as SupplyType,
  });
  const [charges, setCharges] = useState<EditCharge[]>(
    chargesOf(b).map((c, i) => ({
      id: String(i),
      label: c.label,
      amount: String(c.amount),
      gst: String(c.gst),
    })),
  );
  const [lines, setLines] = useState<EditLine[]>(
    b.lines.map((l) => ({
      id: l.id,
      productId: l.product_id,
      cost: l.unit_cost != null ? String(l.unit_cost) : "",
      billed: l.billed_qty != null ? String(l.billed_qty) : String(l.received_qty),
      received: String(l.received_qty),
      gst: String(l.gst_rate ?? (l.product_id ? (prodById.get(l.product_id)?.gst ?? 18) : 18)),
    })),
  );
  const [busy, setBusy] = useState(false);

  // Same rules as receiving: charges are spread by line value per billed unit.
  const alloc = chargeAllocation({
    ...newDraft(),
    type: isBill ? "bill" : "opening",
    charges,
    lines: lines.map((l) => newLine({ id: l.id, cost: l.cost, billed: l.billed })),
  });
  const goods =
    Math.round(lines.reduce((a, l) => a + (num(l.cost) ?? 0) * (num(l.billed) ?? 0), 0) * 100) /
    100;
  const breakup = makeBreakup([
    ...lines.map((l) => ({
      rate: num(l.gst) ?? 0,
      taxable: (num(l.cost) ?? 0) * (num(l.billed) ?? 0),
    })),
    ...charges.map((c) => ({ rate: num(c.gst) ?? 0, taxable: num(c.amount) ?? 0 })),
  ]);
  const gstEstimate = slabTotal(breakup);
  const gst = num(h.gst) ?? gstEstimate;
  const total = Math.round((goods + alloc.net + gst) * 100) / 100;
  const badLine = lines.some(
    (l) =>
      num(l.received) == null ||
      !Number.isInteger(num(l.received)) ||
      (num(l.received) ?? 0) < 0 ||
      (isBill && num(l.cost) == null),
  );

  async function save() {
    if (badLine) {
      toast.error("Check each line's quantity and cost");
      return;
    }
    setBusy(true);
    try {
      const header = isBill
        ? {
            vendor_id: h.vendor_id,
            bill_no: h.bill_no,
            bill_date: h.bill_date,
            bill_total: h.bill_total,
            notes: h.notes,
            charges: charges
              .filter((c) => (num(c.amount) ?? 0) > 0)
              .map((c) => ({ label: c.label, amount: num(c.amount), gst: num(c.gst) ?? 0 })),
            goods_value: goods,
            charges_total: alloc.net,
            gst_total: gst,
            gst_type: h.gstType,
            gst_breakup: breakup,
            total_cost: total,
          }
        : { vendor_id: h.vendor_id, bill_no: h.bill_no, bill_date: h.bill_date, notes: h.notes };
      const payload = lines.map((l) => ({
        id: l.id,
        unit_cost: num(l.cost),
        billed_qty: num(l.billed),
        received_qty: num(l.received),
        extra_cost: alloc.perUnit ? (alloc.perUnit[l.id] ?? 0) : null,
        gst_rate: isBill ? num(l.gst) : null,
      }));
      const { data, error } = await supabase.rpc("update_bill", {
        p_receipt: b.id,
        p_header: header,
        p_lines: payload,
      });
      if (error) throw error;
      // Re-price products whose latest bill this is, from their new cost and charges.
      const ids = new Set(data ?? []);
      if (ids.size && ref.data) {
        const fresh = await supabase
          .from("products")
          .select("*")
          .in("id", [...ids]);
        if (fresh.data) await repriceProducts(fresh.data, ref.data);
      }
      toast.success(ids.size ? `Bill updated · ${ids.size} product(s) re-priced` : "Bill updated");
      await inv("receipts", "products", "adjustments");
      onDone();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4">
      <Notice tone="warn">
        Changing a received quantity moves stock and is logged as a bill correction. Cost and
        charges flow to products whose latest bill this is, and their prices are recalculated.
      </Notice>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={isBill ? "Vendor" : "Vendor (optional)"}>
          <Select value={h.vendor_id} onChange={(e) => setH({ ...h, vendor_id: e.target.value })}>
            {!isBill && <option value="">No vendor</option>}
            {(vendors.data ?? []).map((v) => (
              <option key={v.id} value={v.id}>
                {v.code} · {v.display_name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={isBill ? "Bill no." : "Reference"}>
          <TextInput value={h.bill_no} onChange={(e) => setH({ ...h, bill_no: e.target.value })} />
        </Field>
        <Field label="Date">
          <TextInput
            type="date"
            value={h.bill_date}
            onChange={(e) => setH({ ...h, bill_date: e.target.value })}
          />
        </Field>
        {isBill && (
          <Field label="Bill total before GST ₹">
            <TextInput
              inputMode="decimal"
              value={h.bill_total}
              onChange={(e) => setH({ ...h, bill_total: e.target.value })}
            />
          </Field>
        )}
        <Field label="Note" className="sm:col-span-2">
          <TextInput value={h.notes} onChange={(e) => setH({ ...h, notes: e.target.value })} />
        </Field>
      </div>

      {isBill && (
        <section className="grid gap-2 rounded-xl border bg-muted/30 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-bold">Other charges</span>
            <Button
              size="sm"
              variant="outline"
              className="rounded-full"
              onClick={() =>
                setCharges((cs) => [
                  ...cs,
                  {
                    id: Math.random().toString(36).slice(2),
                    label: CHARGE_LABELS[0]!,
                    amount: "",
                    gst: "18",
                  },
                ])
              }
            >
              <Plus className="size-4" /> Add charge
            </Button>
          </div>
          {charges.map((c) => (
            <div key={c.id} className="grid grid-cols-[1fr_100px_70px_auto] items-end gap-2">
              <Field label="Charge">
                <Select
                  value={c.label}
                  onChange={(e) =>
                    setCharges((cs) =>
                      cs.map((x) => (x.id === c.id ? { ...x, label: e.target.value } : x)),
                    )
                  }
                >
                  {[...new Set([...CHARGE_LABELS, c.label])].map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </Select>
              </Field>
              <Field label="₹ before GST">
                <TextInput
                  inputMode="decimal"
                  value={c.amount}
                  onChange={(e) =>
                    setCharges((cs) =>
                      cs.map((x) => (x.id === c.id ? { ...x, amount: e.target.value } : x)),
                    )
                  }
                />
              </Field>
              <Field label="GST %">
                <TextInput
                  inputMode="decimal"
                  value={c.gst}
                  onChange={(e) =>
                    setCharges((cs) =>
                      cs.map((x) => (x.id === c.id ? { ...x, gst: e.target.value } : x)),
                    )
                  }
                />
              </Field>
              <Button
                size="icon"
                variant="ghost"
                className="mb-0.5 rounded-full"
                title="Remove charge"
                onClick={() => setCharges((cs) => cs.filter((x) => x.id !== c.id))}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
          <Field label="Tax type">
            <Select
              value={h.gstType}
              onChange={(e) => setH({ ...h, gstType: e.target.value as SupplyType })}
            >
              <option value="igst">{SUPPLY_LABEL.igst}</option>
              <option value="intra">{SUPPLY_LABEL.intra}</option>
            </Select>
          </Field>
          <Field
            label="GST on this bill ₹"
            hint={`Blank = from each line's GST % (${inr(gstEstimate)})`}
          >
            <TextInput
              inputMode="decimal"
              value={h.gst}
              placeholder={`≈ ${inr(gstEstimate)}`}
              onChange={(e) => setH({ ...h, gst: e.target.value })}
            />
          </Field>
        </section>
      )}

      <section className="grid gap-2">
        <h4 className="text-xs font-extrabold uppercase tracking-[0.1em] text-muted-foreground">
          Lines
        </h4>
        {lines.map((l, i) => {
          const p = l.productId
            ? (products.data ?? []).find((x) => x.id === l.productId)
            : undefined;
          const orig = b.lines[i]!;
          const delta = (num(l.received) ?? 0) - orig.received_qty;
          const extra = alloc.perUnit?.[l.id];
          const upd = (patch: Partial<EditLine>) =>
            setLines((ls) => ls.map((x) => (x.id === l.id ? { ...x, ...patch } : x)));
          return (
            <div key={l.id} className="grid gap-2 rounded-lg border p-2.5">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Code>{p?.code ?? "—"}</Code>
                <span className="wrap-any min-w-0 flex-1">
                  {p?.friendly_name ?? orig.description}
                </span>
              </div>
              <div className={cn("grid gap-2", isBill ? "grid-cols-4" : "grid-cols-2")}>
                {isBill && (
                  <Field label="Unit cost ₹">
                    <TextInput
                      inputMode="decimal"
                      value={l.cost}
                      onChange={(e) => upd({ cost: e.target.value })}
                    />
                  </Field>
                )}
                <Field label="Billed">
                  <TextInput
                    inputMode="decimal"
                    value={l.billed}
                    onChange={(e) => upd({ billed: e.target.value })}
                  />
                </Field>
                <Field label="Received">
                  <TextInput
                    inputMode="numeric"
                    value={l.received}
                    onChange={(e) => upd({ received: e.target.value.replace(/[^\d]/g, "") })}
                  />
                </Field>
                {isBill && (
                  <Field label="GST %">
                    <TextInput
                      inputMode="decimal"
                      list="gst-rates-edit"
                      value={l.gst}
                      onChange={(e) => upd({ gst: e.target.value })}
                    />
                  </Field>
                )}
              </div>
              <div className="flex flex-wrap gap-x-3 text-xs text-muted-foreground tabular-nums">
                {extra != null && <span>charges {inr(extra)} / unit</span>}
                {delta !== 0 && (
                  <span className={delta < 0 ? "text-destructive" : "text-success"}>
                    stock {delta > 0 ? "+" : ""}
                    {delta}
                    {p ? ` (${p.stock} → ${p.stock + delta})` : ""}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </section>

      {isBill && (
        <section className="grid gap-1 rounded-xl border border-primary/30 p-3 text-sm">
          <Row k="Goods (before GST)" v={goods} />
          <Row k="Other charges" v={alloc.net} />
          <GstRows breakup={breakup} type={h.gstType} />
          {num(h.gst) != null && <Row k="GST as printed on the bill" v={gst} />}
          <datalist id="gst-rates-edit">
            {GST_RATES.map((r) => (
              <option key={r} value={r} />
            ))}
          </datalist>
          <div className="flex justify-between border-t pt-1.5 font-extrabold tabular-nums">
            <span>Cost to company</span>
            <span>{inr(total)}</span>
          </div>
        </section>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" className="rounded-full" onClick={onDone} disabled={busy}>
          Cancel
        </Button>
        <Button
          className="rounded-full font-bold uppercase"
          onClick={save}
          disabled={busy || badLine}
        >
          {busy ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </div>
  );
}

/** Due date, what's paid and what's left, with payment entries. */
function BillPayments({ b }: { b: BillWithLines }) {
  const { canEdit, email } = useAuth();
  const payments = usePayments();
  const inv = useInvalidate();
  const mine = (payments.data ?? []).filter((p) => p.receipt_id === b.id);
  const m = billMoney(b, payments.data ?? []);
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({
    amount: "",
    paid_on: today(),
    mode: "UPI",
    reference: "",
    note: "",
  });
  const [busy, setBusy] = useState(false);

  async function add() {
    const amount = num(f.amount);
    if (!amount || amount <= 0) {
      toast.error("Enter the amount paid");
      return;
    }
    setBusy(true);
    const { error } = await supabase.from("bill_payments").insert({
      receipt_id: b.id,
      amount,
      paid_on: f.paid_on,
      mode: f.mode,
      reference: f.reference.trim() || null,
      note: f.note.trim() || null,
      created_by_email: email,
    });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(`Payment of ${inr(amount)} recorded`);
    setAdding(false);
    setF({ amount: "", paid_on: today(), mode: "UPI", reference: "", note: "" });
    await inv("payments");
  }
  async function remove(id: string) {
    if (!confirm("Remove this payment?")) return;
    const { error } = await supabase.from("bill_payments").delete().eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    await inv("payments");
  }
  async function setDue(v: string) {
    // p_due defaults to null in the database, so omitting it clears the due date.
    const { error } = await supabase.rpc("set_bill_due", { p_receipt: b.id, p_due: v || undefined });
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Due date saved");
    await inv("receipts");
  }

  return (
    <section className="grid gap-2 rounded-xl border p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-xs font-extrabold uppercase tracking-[0.1em] text-muted-foreground">
          Payment
        </h4>
        <Pill tone={PAY_TONE[m.status]}>
          {PAY_LABEL[m.status]}
          {m.status === "overdue" ? ` · ${m.overdueDays} day${m.overdueDays === 1 ? "" : "s"}` : ""}
        </Pill>
      </div>
      <div className="grid grid-cols-3 gap-2 text-center tabular-nums">
        <div className="rounded-lg bg-muted p-2">
          <div className="text-[11px] text-muted-foreground">Payable</div>
          <b>{inr(m.total)}</b>
        </div>
        <div className="rounded-lg bg-muted p-2">
          <div className="text-[11px] text-muted-foreground">Paid</div>
          <b>{inr(m.paid)}</b>
        </div>
        <div className={cn("rounded-lg p-2", m.balance > 0.5 ? "bg-warning/20" : "bg-success/15")}>
          <div className="text-[11px] text-muted-foreground">Balance</div>
          <b>{inr(m.balance)}</b>
        </div>
      </div>
      <Field
        label="Due date"
        hint="From the vendor's payment terms; change it if the bill says otherwise."
      >
        <TextInput
          type="date"
          disabled={!canEdit}
          defaultValue={String(b.due_date ?? "").slice(0, 10)}
          onBlur={(e) => {
            if (e.target.value !== String(b.due_date ?? "").slice(0, 10)) setDue(e.target.value);
          }}
        />
      </Field>
      {mine.length > 0 && (
        <ul className="grid gap-1">
          {mine.map((p) => (
            <li
              key={p.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-0.5 rounded-lg bg-muted/50 px-2.5 py-1.5 text-xs"
            >
              <b className="tabular-nums">{inr(Number(p.amount))}</b>
              <span>{String(p.paid_on).slice(0, 10)}</span>
              <span>{p.mode}</span>
              {p.reference && <span className="font-mono">{p.reference}</span>}
              {p.note && <span className="text-muted-foreground">{p.note}</span>}
              {canEdit && (
                <button
                  className="ml-auto text-destructive"
                  onClick={() => remove(p.id)}
                  title="Remove payment"
                >
                  <Trash2 className="size-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canEdit &&
        m.balance > 0.5 &&
        (adding ? (
          <div className="grid gap-2 rounded-lg border bg-muted/30 p-2.5">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <Field label="Amount ₹">
                <TextInput
                  inputMode="decimal"
                  value={f.amount}
                  placeholder={String(m.balance)}
                  onChange={(e) => setF({ ...f, amount: e.target.value })}
                />
              </Field>
              <Field label="Paid on">
                <TextInput
                  type="date"
                  value={f.paid_on}
                  onChange={(e) => setF({ ...f, paid_on: e.target.value })}
                />
              </Field>
              <Field label="Mode">
                <Select value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value })}>
                  {PAY_MODES.map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Reference / UTR">
                <TextInput
                  value={f.reference}
                  onChange={(e) => setF({ ...f, reference: e.target.value })}
                />
              </Field>
              <Field label="Note" className="sm:col-span-2">
                <TextInput value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
              </Field>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" className="rounded-full" disabled={busy} onClick={add}>
                Save payment
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="rounded-full"
                onClick={() => setF({ ...f, amount: String(m.balance) })}
              >
                Pay full balance
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="rounded-full"
                onClick={() => setAdding(false)}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button
            size="sm"
            variant="outline"
            className="w-fit rounded-full"
            onClick={() => setAdding(true)}
          >
            <Plus className="size-4" /> Record payment
          </Button>
        ))}
    </section>
  );
}

function Stars({
  value,
  onChange,
  label,
}: {
  value: number;
  onChange: (n: number) => void;
  label: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs">{label}</span>
      <span className="flex gap-0.5" role="radiogroup" aria-label={label}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={value === n}
            onClick={() => onChange(n)}
            className={cn(
              "text-lg leading-none",
              n <= value ? "text-warning" : "text-muted-foreground/40",
            )}
          >
            ★
          </button>
        ))}
      </span>
    </div>
  );
}

/** Quick rating of this delivery — feeds the vendor's scorecard. */
function BillFeedback({ b }: { b: BillWithLines }) {
  const { canContribute, email } = useAuth();
  const reviews = useReviews();
  const inv = useInvalidate();
  const existing = (reviews.data ?? []).filter((r) => r.receipt_id === b.id);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ quality: 0, delivery: 0, pricing: 0, comment: "" });
  async function save() {
    if (!f.quality && !f.delivery && !f.pricing && !f.comment.trim()) {
      toast.error("Add a rating or a comment");
      return;
    }
    const { error } = await supabase.from("vendor_reviews").insert({
      vendor_id: b.vendor_id!,
      receipt_id: b.id,
      quality: f.quality || null,
      delivery: f.delivery || null,
      pricing: f.pricing || null,
      comment: f.comment.trim() || null,
      created_by_email: email,
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Feedback saved");
    setOpen(false);
    await inv("reviews");
  }
  return (
    <section className="grid gap-2 rounded-xl border p-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-xs font-extrabold uppercase tracking-[0.1em] text-muted-foreground">
          Vendor feedback
        </h4>
        {canContribute && !open && (
          <Button
            size="sm"
            variant="outline"
            className="rounded-full"
            onClick={() => setOpen(true)}
          >
            Rate this delivery
          </Button>
        )}
      </div>
      {existing.map((r) => (
        <p key={r.id} className="text-xs">
          <span className="text-warning">
            {"★".repeat(
              Math.round(
                ((r.quality ?? 0) + (r.delivery ?? 0) + (r.pricing ?? 0)) /
                  ([r.quality, r.delivery, r.pricing].filter(Boolean).length || 1),
              ),
            )}
          </span>{" "}
          {r.quality ? `quality ${r.quality} · ` : ""}
          {r.delivery ? `delivery ${r.delivery} · ` : ""}
          {r.pricing ? `pricing ${r.pricing}` : ""}
          {r.comment ? ` — ${r.comment}` : ""}
          <span className="text-muted-foreground"> · {r.created_by_email}</span>
        </p>
      ))}
      {!existing.length && !open && (
        <p className="text-xs text-muted-foreground">No feedback yet.</p>
      )}
      {open && (
        <div className="grid gap-1.5">
          <Stars
            label="Quality of goods"
            value={f.quality}
            onChange={(n) => setF({ ...f, quality: n })}
          />
          <Stars
            label="Delivery (on time, complete)"
            value={f.delivery}
            onChange={(n) => setF({ ...f, delivery: n })}
          />
          <Stars label="Pricing" value={f.pricing} onChange={(n) => setF({ ...f, pricing: n })} />
          <TextInput
            placeholder="What went well or wrong? (optional)"
            value={f.comment}
            onChange={(e) => setF({ ...f, comment: e.target.value })}
          />
          <div className="flex gap-2">
            <Button size="sm" className="rounded-full" onClick={save}>
              Save feedback
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="rounded-full"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
