import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { inr, type Vendor } from "@/lib/domain";
import { useInvalidate, useProducts, useReceipts, useVendorCodes, useVendors } from "@/lib/data";
import { blankVendor } from "@/lib/draft";
import { vendorIssues } from "@/lib/gst";
import { Card, CardTitle, Code, Empty, PageHead, Pill } from "@/components/kit";
import { VendorForm, vendorRow, vendorValues, type VendorValues } from "@/components/VendorForm";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/vendors")({
  head: () => ({ meta: [{ title: "Vendors · Sportagon Stockroom" }] }),
  validateSearch: (s: Record<string, unknown>): { sel?: string | undefined } => ({
    sel: typeof s["sel"] === "string" ? s["sel"] : undefined,
  }),
  component: VendorsPage,
});

function VendorsPage() {
  const { canContribute } = useAuth();
  const vendors = useVendors();
  const vcodes = useVendorCodes();
  const receipts = useReceipts();
  const inv = useInvalidate();
  const { sel } = Route.useSearch();
  const nav = Route.useNavigate();
  const [form, setForm] = useState<VendorValues>(blankVendor());
  const [saving, setSaving] = useState(false);
  const list = vendors.data ?? [];
  const selected = sel ? list.find((v) => v.id === sel) : undefined;
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
        <Pill>{list.length} vendors</Pill>
        <Pill tone="ok">{ready} Zoho-ready</Pill>
        {list.length - ready ? (
          <Pill tone="warn">{list.length - ready} missing details</Pill>
        ) : null}
      </div>
      <div
        className={cn(
          "grid items-start gap-5",
          selected && "lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]",
        )}
      >
        <div className="grid min-w-0 gap-2">
          {!list.length && <Empty>No vendors yet.</Empty>}
          {list.map((v) => {
            const iss = vendorIssues(v as never);
            return (
              <button
                key={v.id}
                onClick={() => nav({ search: { sel: v.id } })}
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
            onClose={() => nav({ search: { sel: undefined } })}
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
  const { canContribute } = useAuth();
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
    </aside>
  );
}
