import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Archive, ArchiveRestore, ArrowLeft, Trash2, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { inr, type Vendor } from "@/lib/domain";
import {
  useBills,
  useInvalidate,
  usePayments,
  useProducts,
  useReceipts,
  useReviews,
  useVendorCodes,
  useVendors,
} from "@/lib/data";
import { PAY_LABEL, PAY_TONE, billMoney, vendorBusiness } from "@/lib/finance";
import { blankVendor } from "@/lib/draft";
import { isArchivedVendor, vendorIssues } from "@/lib/gst";
import { Card, CardTitle, Code, Empty, PageHead, Pill } from "@/components/kit";
import { VendorForm, vendorRow, vendorValues, type VendorValues } from "@/components/VendorForm";
import { Button } from "@/components/ui/button";
import { VendorNotes, vendorFilePaths } from "@/components/VendorNotes";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/vendors")({
  head: () => ({ meta: [{ title: "Vendors · Sportagon Stockroom" }] }),
  validateSearch: (
    s: Record<string, unknown>,
  ): { sel?: string | undefined; archived?: boolean | undefined } => ({
    sel: typeof s["sel"] === "string" ? s["sel"] : undefined,
    archived: s["archived"] === true || s["archived"] === "true" ? true : undefined,
  }),
  component: VendorsPage,
});

function VendorsPage() {
  const { canContribute } = useAuth();
  const vendors = useVendors();
  const vcodes = useVendorCodes();
  const receipts = useReceipts();
  const bills = useBills();
  const payments = usePayments();
  const reviews = useReviews();
  const biz = (id: string) =>
    vendorBusiness(id, bills.data ?? [], payments.data ?? [], reviews.data ?? []);
  const inv = useInvalidate();
  const { sel, archived: showArchived } = Route.useSearch();
  const nav = Route.useNavigate();
  const [form, setForm] = useState<VendorValues>(blankVendor());
  const [saving, setSaving] = useState(false);
  const all = vendors.data ?? [];
  const archivedCount = all.filter(isArchivedVendor).length;
  const list = all.filter((v) => (showArchived ? isArchivedVendor(v) : !isArchivedVendor(v)));
  const selected = sel ? all.find((v) => v.id === sel) : undefined;
  const ready = list.filter((v) => !vendorIssues(v as never).length).length;
  const lastBill = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of receipts.data ?? [])
      if (r.vendor_id && !m.has(r.vendor_id))
        m.set(r.vendor_id, String(r.bill_date ?? r.created_at).slice(0, 10));
    return m;
  }, [receipts.data]);

  async function add() {
    const iss = vendorIssues(form);
    if (iss.length) {
      toast.error("Still needs: " + iss.join(", "));
      return;
    }
    setSaving(true);
    const { data, error } = await supabase
      .from("vendors")
      .insert({ ...vendorRow(form), code: "" })
      .select("id,code")
      .single();
    setSaving(false);
    if (error) {
      toast.error(
        error.message.includes("duplicate")
          ? "A vendor with this name or GSTIN already exists"
          : error.message,
      );
      return;
    }
    toast.success(`Added ${data.code}`);
    setForm(blankVendor());
    await inv("vendors");
    nav({ search: { sel: data.id } });
  }

  return (
    <>
      <PageHead
        title="Vendors"
        lede="Vendor master with every field Zoho needs. Each vendor's own item codes are remembered against your product codes."
      />
      <div className="flex flex-wrap gap-1.5">
        <Pill>
          {list.length} {showArchived ? "archived" : "vendors"}
        </Pill>
        {!showArchived && <Pill tone="ok">{ready} Zoho-ready</Pill>}
        {!showArchived && list.length - ready ? (
          <Pill tone="warn">{list.length - ready} missing details</Pill>
        ) : null}
        {archivedCount > 0 && (
          <button
            onClick={() =>
              nav({ search: (s) => ({ ...s, archived: showArchived ? undefined : true }) })
            }
          >
            <Pill className="cursor-pointer underline-offset-2 hover:underline">
              {showArchived ? "← Back to active vendors" : `${archivedCount} archived`}
            </Pill>
          </button>
        )}
      </div>
      <div
        className={cn(
          "grid items-start gap-5",
          selected && "lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]",
        )}
      >
        <div className="grid min-w-0 gap-2">
          {!list.length && (
            <Empty>{showArchived ? "No archived vendors." : "No vendors yet."}</Empty>
          )}
          {list.map((v) => {
            const iss = vendorIssues(v as never);
            return (
              <button
                key={v.id}
                onClick={() => nav({ search: (s) => ({ ...s, sel: v.id }) })}
                className={cn(
                  "card-lift grid min-w-0 gap-1 p-3 text-left",
                  selected?.id === v.id && "ring-2 ring-accent",
                )}
              >
                <span className="flex flex-wrap items-center gap-2">
                  <Code>{v.code}</Code>
                  <strong className="wrap-any min-w-0 flex-1 text-sm">{v.display_name}</strong>
                  {iss.length ? (
                    <Pill tone="warn">{iss.length} missing</Pill>
                  ) : (
                    <Pill tone="ok">Ready</Pill>
                  )}
                </span>
                {(() => {
                  const b = biz(v.id);
                  return b.bills ? (
                    <span className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs tabular-nums">
                      <span>
                        {b.bills} bill{b.bills === 1 ? "" : "s"} · {inr(b.total)}
                      </span>
                      {b.owed > 0.5 && (
                        <span
                          className={
                            b.overdue > 0.5
                              ? "text-destructive"
                              : "text-warning-foreground dark:text-warning"
                          }
                        >
                          {inr(b.owed)} to pay
                          {b.overdue > 0.5 ? ` (${inr(b.overdue)} overdue)` : ""}
                        </span>
                      )}
                      {b.rating != null && <span className="text-warning">★ {b.rating}</span>}
                    </span>
                  ) : null;
                })()}
                <span className="wrap-any text-xs text-muted-foreground">
                  {v.gstin || "No GSTIN"} · {v.source_of_supply || "—"} ·{" "}
                  {(vcodes.data ?? []).filter((c) => c.vendor_id === v.id).length} codes mapped ·
                  last bill {lastBill.get(v.id) ?? "—"}
                  {v.is_sample ? " · sample" : ""}
                </span>
              </button>
            );
          })}
        </div>
        {selected && (
          <VendorPanel
            key={selected.id}
            v={selected}
            onClose={() => nav({ search: (s) => ({ ...s, sel: undefined }) })}
          />
        )}
      </div>
      {canContribute && (
        <Card>
          <CardTitle>Onboard a vendor</CardTitle>
          <VendorForm idPrefix="new" value={form} onChange={setForm} />
          <div className="flex flex-wrap gap-2">
            <Button className="rounded-full" disabled={saving} onClick={add}>
              {saving ? "Saving…" : "Add vendor"}
            </Button>
            <Button variant="ghost" className="rounded-full" onClick={() => setForm(blankVendor())}>
              Clear form
            </Button>
          </div>
        </Card>
      )}
    </>
  );
}

function VendorPanel({ v, onClose }: { v: Vendor; onClose: () => void }) {
  const { canContribute, canEdit, isOwner } = useAuth();
  const bills = useBills();
  const [sureDel, setSureDel] = useState(false);
  const billCount = (bills.data ?? []).filter((b) => b.vendor_id === v.id).length;
  const archived = isArchivedVendor(v);
  async function setArchived(on: boolean) {
    const { error } = await supabase
      .from("vendors")
      .update({ status: on ? "Archived" : "Active", updated_at: new Date().toISOString() })
      .eq("id", v.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(on ? `${v.code} archived` : `${v.code} restored`);
    inv("vendors");
  }
  async function remove() {
    if (!sureDel) {
      setSureDel(true);
      return;
    }
    setSureDel(false);
    const files = await vendorFilePaths(v.id);
    const { error } = await supabase.rpc("delete_vendor", { p_vendor: v.id });
    if (error) {
      toast.error(error.message);
      return;
    }
    if (files.length) await supabase.storage.from("media").remove(files);
    toast.success(`${v.code} deleted`);
    onClose();
    inv("vendors", "vendor_codes", "products", "reviews");
  }
  const vcodes = useVendorCodes();
  const products = useProducts();
  const inv = useInvalidate();
  const [val, setVal] = useState<VendorValues>(() => ({
    ...blankVendor(),
    ...vendorValues(v as unknown as Record<string, unknown>),
  }));
  const [confirm, setConfirm] = useState<string | null>(null);
  const maps = (vcodes.data ?? []).filter((c) => c.vendor_id === v.id);

  async function persist(next: VendorValues) {
    if (!next["display_name"]?.trim()) {
      toast.error("Display name can't be empty");
      return;
    }
    const row = vendorRow(next);
    const { error } = await supabase
      .from("vendors")
      .update({ ...row, updated_at: new Date().toISOString() })
      .eq("id", v.id);
    if (error) {
      toast.error(
        error.message.includes("duplicate")
          ? "Another vendor already has this name or GSTIN"
          : error.message,
      );
      return;
    }
    inv("vendors");
  }
  async function unlink(id: string) {
    if (confirm !== id) {
      setConfirm(id);
      return;
    }
    setConfirm(null);
    const { error } = await supabase.from("vendor_codes").delete().eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Unlinked — the next bill with this code will ask again");
    inv("vendor_codes");
  }
  return (
    <aside
      className="panel fixed inset-0 z-40 grid content-start gap-4 overflow-y-auto p-4 lg:sticky lg:inset-auto lg:top-20 lg:z-0 lg:max-h-[calc(100dvh-6rem)] lg:p-5"
      style={{
        paddingTop: "max(1rem, env(safe-area-inset-top))",
        paddingBottom: "max(1.5rem, env(safe-area-inset-bottom))",
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Code big>{v.code}</Code>
          <h3 className="wrap-any mt-1 text-lg font-bold">{v.display_name}</h3>
        </div>
        <Button
          size="icon"
          variant="ghost"
          className="rounded-full"
          onClick={onClose}
          title="Close"
        >
          <ArrowLeft className="size-4 lg:hidden" />
          <X className="hidden size-4 lg:block" />
        </Button>
      </div>
      {archived && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-muted px-3 py-2.5 text-sm">
          <span>Archived — hidden from the vendor list and new bills. History is kept.</span>
          {canEdit && (
            <Button
              size="sm"
              variant="outline"
              className="rounded-full"
              onClick={() => setArchived(false)}
            >
              <ArchiveRestore className="size-4" /> Restore
            </Button>
          )}
        </div>
      )}
      <VendorBusiness v={v} />
      <VendorNotes vendorId={v.id} vendorCode={v.code} />
      <details className="rounded-xl border p-3">
        <summary className="cursor-pointer text-xs font-extrabold uppercase tracking-[0.1em] text-muted-foreground">
          Vendor details (Zoho fields)
        </summary>
        <div className="mt-3 grid gap-3">
          <VendorForm
            idPrefix={`v-${v.id}`}
            value={val}
            disabled={!canContribute}
            onChange={setVal}
            onBlurField={(_k, n) => persist(n)}
          />
          {canContribute && (
            <p className="text-xs text-muted-foreground">Changes save when you leave a field.</p>
          )}
        </div>
      </details>
      <section className="grid gap-2">
        <h4 className="text-xs font-extrabold uppercase tracking-[0.1em] text-muted-foreground">
          Code map · {maps.length}
        </h4>
        {!maps.length && (
          <p className="text-xs text-muted-foreground">
            Nothing mapped yet — receive a bill from this vendor.
          </p>
        )}
        {maps.map((m) => {
          const p = (products.data ?? []).find((x) => x.id === m.product_id);
          return (
            <div
              key={m.id}
              className="flex flex-wrap items-center gap-2 rounded-lg bg-muted p-2.5 text-sm"
            >
              <Code>{m.vendor_item_code ?? "—"}</Code>
              <span className="text-muted-foreground">→</span>
              <Code>{p?.code ?? "?"}</Code>
              <span className="wrap-any min-w-0 flex-1">{p?.friendly_name ?? m.description}</span>
              <span className="text-xs text-muted-foreground">{inr(m.last_cost)}</span>
              {canContribute && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="rounded-full"
                  onClick={() => unlink(m.id)}
                >
                  {confirm === m.id ? "Confirm" : "Unlink"}
                </Button>
              )}
            </div>
          );
        })}
      </section>
      {(canEdit || isOwner) && (
        <section className="grid gap-2 rounded-xl border border-dashed p-3">
          <h4 className="text-xs font-extrabold uppercase tracking-[0.1em] text-muted-foreground">
            Archive or delete
          </h4>
          <p className="text-xs text-muted-foreground">
            <b>Archive</b> hides the vendor from the list and new bills but keeps its bills,
            payments, ratings, notes, documents and code map. <b>Delete</b> removes it for good —
            only for vendors with no bills (e.g. added by mistake); its code map, notes and
            documents go with it.
          </p>
          <div className="flex flex-wrap gap-2">
            {canEdit && !archived && (
              <Button
                size="sm"
                variant="outline"
                className="rounded-full"
                onClick={() => setArchived(true)}
              >
                <Archive className="size-4" /> Archive
              </Button>
            )}
            {isOwner && (
              <Button
                size="sm"
                variant={sureDel ? "destructive" : "ghost"}
                className="rounded-full"
                disabled={billCount > 0}
                title={billCount ? `Has ${billCount} bill(s) — archive instead` : undefined}
                onClick={remove}
              >
                <Trash2 className="size-4" />
                {billCount
                  ? `Delete — not possible, ${billCount} bill${billCount === 1 ? "" : "s"}`
                  : sureDel
                    ? `Yes, delete ${v.code}`
                    : "Delete vendor"}
              </Button>
            )}
          </div>
        </section>
      )}
    </aside>
  );
}

/** Business with this vendor: billed, paid, owed, overdue, products, shortages, rating and feedback. */
function VendorBusiness({ v }: { v: Vendor }) {
  const bills = useBills();
  const payments = usePayments();
  const reviews = useReviews();
  const b = vendorBusiness(v.id, bills.data ?? [], payments.data ?? [], reviews.data ?? []);
  const vb = (bills.data ?? []).filter((x) => x.vendor_id === v.id && x.receipt_type === "bill");
  const vr = (reviews.data ?? []).filter((r) => r.vendor_id === v.id);
  const avg = (k: "quality" | "delivery" | "pricing") => {
    const xs = vr.map((r) => r[k]).filter((x): x is number => x != null);
    return xs.length ? Math.round((xs.reduce((a, c) => a + c, 0) / xs.length) * 10) / 10 : null;
  };
  const tiles: [string, string, (string | undefined)?][] = [
    ["Total business", inr(b.total), `${b.bills} bill${b.bills === 1 ? "" : "s"}`],
    ["Paid", inr(b.paid)],
    ["To pay", inr(b.owed), b.overdue > 0.5 ? `${inr(b.overdue)} overdue` : undefined],
    [
      "Rating",
      b.rating != null ? `★ ${b.rating}` : "—",
      `${b.reviews} review${b.reviews === 1 ? "" : "s"}`,
    ],
  ];
  return (
    <section className="grid gap-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {tiles.map(([k, val, sub]) => (
          <div
            key={k}
            className={cn(
              "rounded-xl border p-2.5",
              k === "To pay" && b.overdue > 0.5 && "border-destructive",
            )}
          >
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {k}
            </div>
            <div className="text-lg font-extrabold tabular-nums">{val}</div>
            {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        {b.products} products · {b.units} units received
        {b.shortUnits ? ` · ${b.shortUnits} short-supplied` : ""}
        {b.first ? ` · first bill ${b.first}` : ""}
        {b.last ? ` · last bill ${b.last}` : ""} · terms {v.payment_terms ?? "—"}
      </p>
      {vb.length > 0 && (
        <div className="grid gap-1">
          <h4 className="text-xs font-extrabold uppercase tracking-[0.1em] text-muted-foreground">
            Bills
          </h4>
          {vb.slice(0, 12).map((x) => {
            const m = billMoney(x, payments.data ?? []);
            return (
              <Link
                key={x.id}
                to="/bills"
                search={{ sel: x.id }}
                className="flex flex-wrap items-center gap-x-3 gap-y-0.5 rounded-lg px-2 py-1.5 text-sm hover:bg-muted"
              >
                <span className="text-xs text-muted-foreground">
                  {String(x.bill_date ?? x.created_at).slice(0, 10)}
                </span>
                <span className="wrap-any min-w-[4.5rem] flex-1 font-medium">
                  {x.bill_no ?? "—"}
                </span>
                <span className="tabular-nums">{inr(m.total)}</span>
                <Pill tone={PAY_TONE[m.status]}>
                  {PAY_LABEL[m.status]}
                  {m.balance > 0.5 && m.status !== "reversed" ? ` · ${inr(m.balance)}` : ""}
                </Pill>
              </Link>
            );
          })}
        </div>
      )}
      <div className="grid gap-1">
        <h4 className="text-xs font-extrabold uppercase tracking-[0.1em] text-muted-foreground">
          Feedback
          {vr.length
            ? ` · quality ${avg("quality") ?? "—"} · delivery ${avg("delivery") ?? "—"} · pricing ${avg("pricing") ?? "—"}`
            : ""}
        </h4>
        {vr.length ? (
          vr.slice(0, 8).map((r) => (
            <p key={r.id} className="text-xs">
              <span className="text-muted-foreground">{String(r.created_at).slice(0, 10)}</span>{" "}
              {[
                r.quality && `quality ${r.quality}`,
                r.delivery && `delivery ${r.delivery}`,
                r.pricing && `pricing ${r.pricing}`,
              ]
                .filter(Boolean)
                .join(" · ")}
              {r.comment ? ` — ${r.comment}` : ""}
            </p>
          ))
        ) : (
          <p className="text-xs text-muted-foreground">
            No feedback yet — rate a delivery from its bill.
          </p>
        )}
      </div>
    </section>
  );
}
