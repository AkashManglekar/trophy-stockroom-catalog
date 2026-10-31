import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { inr, num, today, type Product, type RefData } from "@/lib/domain";
import {
  errMsg,
  priceFor,
  repriceProducts,
  useInvalidate,
  useSources,
  useVendors,
} from "@/lib/data";
import { pricePayload } from "@/lib/pricing";
import { pricingBasis } from "@/lib/sourcing";
import { normDesc } from "@/lib/naming";
import { GST_RATES, SUPPLY_LABEL, supplyTypeFor } from "@/lib/gst";
import { Field, Notice, Pill, Select, TextInput } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const r2 = (x: number) => Math.round(x * 100) / 100;

/**
 * Add stock to an existing product with what the business needs: quantity, cost, GST and vendor.
 * With a bill number it is saved as that vendor's bill (GST input, what you owe, vendor price →
 * lowest-price rule, Zoho bill export). Without one it is stock with no bill.
 */
export function AddStockForm({ p, ref_ }: { p: Product; ref_: RefData }) {
  const inv = useInvalidate();
  const vendors = useVendors();
  const sources = useSources();
  const [qty, setQty] = useState("");
  const [cost, setCost] = useState(p.unit_cost != null ? String(p.unit_cost) : "");
  const [gst, setGst] = useState(p.gst != null ? String(Number(p.gst)) : "");
  const [vendorId, setVendorId] = useState(p.preferred_vendor_id ?? "");
  const [billNo, setBillNo] = useState("");
  const [date, setDate] = useState(today());
  const [vcode, setVcode] = useState("");
  const [busy, setBusy] = useState(false);

  const q = num(qty);
  const c = num(cost);
  const g = num(gst);
  const isBill = !!vendorId && !!billNo.trim();
  const vend = (vendors.data ?? []).find((v) => v.id === vendorId);
  const supply = vend ? supplyTypeFor(vend, ref_.settings.company_state) : null;
  const goods = q != null && c != null ? r2(q * c) : 0;
  const tax = r2((goods * (g ?? 0)) / 100);
  const problem =
    q == null || q <= 0 || !Number.isInteger(q)
      ? "Enter a whole quantity"
      : c == null || c < 0
        ? "Enter the unit cost"
        : g == null
          ? "Pick the GST %"
          : billNo.trim() && !vendorId
            ? "Pick the vendor for this bill"
            : "";

  // The price this stock leads to: the lowest current vendor price (this bill's or another's).
  const basis = pricingBasis(p.id, vendorId, c, null, sources.data ?? [], vendors.data ?? []);
  const sellGst = p.gst_manual ? p.gst : g;
  const holdMrp =
    sellGst != null && p.gst != null && Number(sellGst) !== Number(p.gst) && p.mrp != null
      ? p.price_mode === "mrp" && p.price_value
        ? p.price_value
        : p.mrp
      : null;
  const next = priceFor(
    {
      ...p,
      unit_cost: isBill ? basis.cost : c,
      extra_cost: isBill ? basis.extra : p.extra_cost,
      gst: sellGst,
      ...(holdMrp != null ? { price_mode: "mrp", price_value: holdMrp } : {}),
    },
    ref_,
  );

  async function save() {
    if (problem || q == null || c == null) return;
    setBusy(true);
    try {
      const line = {
        line_no: 1,
        product_id: p.id,
        received_qty: q,
        billed_qty: q,
        unit_cost: c,
        extra_cost: null,
        gst_rate: g,
        vendor_item_code: vcode.trim() || null,
        description: p.friendly_name,
        norm_desc: vcode.trim() ? null : normDesc(p.friendly_name),
        location: null,
        prices:
          isBill && next
            ? { ...pricePayload(next), ...(holdMrp != null ? { lock_mrp: holdMrp } : {}) }
            : null,
      };
      const { error } = await supabase.rpc("receive_stock", {
        payload: isBill
          ? {
              receipt_type: "bill",
              vendor_id: vendorId,
              bill_no: billNo.trim(),
              bill_date: date,
              bill_total: goods,
              charges: [],
              goods_value: goods,
              charges_total: 0,
              gst_total: tax,
              gst_type: supply ?? "intra",
              gst_breakup: [{ rate: g, taxable: goods, tax }],
              total_cost: r2(goods + tax),
              notes: "Added from the product page",
              lines: [line],
            }
          : {
              receipt_type: "opening",
              vendor_id: vendorId || null,
              bill_no: billNo.trim() || null,
              bill_date: date,
              notes: "Added from the product page (no bill)",
              lines: [line],
            },
      });
      if (error) throw new Error(error.message);
      // Without a bill the receipt doesn't touch cost or GST — apply them to the product here.
      if (!isBill && (c !== p.unit_cost || (!p.gst_manual && g !== p.gst))) {
        await supabase
          .from("products")
          .update({
            unit_cost: c,
            ...(!p.gst_manual && g != null && g !== p.gst
              ? {
                  gst: g,
                  ...(holdMrp != null ? { price_mode: "mrp", price_value: holdMrp } : {}),
                }
              : {}),
            ...(vendorId ? { preferred_vendor_id: vendorId } : {}),
          })
          .eq("id", p.id);
        const fresh = await supabase.from("products").select("*").eq("id", p.id);
        if (fresh.data) await repriceProducts(fresh.data, ref_);
      }
      toast.success(
        `${p.code}: +${q} in stock` +
          (isBill
            ? ` · bill ${billNo.trim()} from ${vend?.display_name ?? "vendor"} recorded`
            : ""),
      );
      setQty("");
      setBillNo("");
      setVcode("");
      await inv("products", "adjustments", "receipts", "vendor_codes", "payments");
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-3 rounded-xl border border-accent/60 bg-accent/5 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <b className="text-sm">Add stock</b>
        <Pill tone={isBill ? "ok" : "mute"}>{isBill ? "vendor bill" : "no bill"}</Pill>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Quantity">
          <TextInput
            inputMode="numeric"
            value={qty}
            placeholder="0"
            onChange={(e) => setQty(e.target.value.replace(/[^\d]/g, ""))}
          />
        </Field>
        <Field label="Unit cost ₹ (before GST)">
          <TextInput inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} />
        </Field>
        <Field label="GST %">
          <Select value={gst} onChange={(e) => setGst(e.target.value)}>
            <option value="">—</option>
            {GST_RATES.map((x) => (
              <option key={x} value={String(x)}>
                {x}%
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Date">
          <TextInput type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field
          label="Vendor"
          hint={supply ? SUPPLY_LABEL[supply] : "Optional without a bill"}
          className="col-span-2"
        >
          <Select value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
            <option value="">No vendor</option>
            {(vendors.data ?? [])
              .filter((v) => v.status !== "Archived" || v.id === vendorId)
              .map((v) => (
                <option key={v.id} value={v.id}>
                  {v.display_name}
                </option>
              ))}
          </Select>
        </Field>
        <Field label="Bill / invoice no." hint="Given → saved as the vendor's bill">
          <TextInput value={billNo} onChange={(e) => setBillNo(e.target.value)} />
        </Field>
        <Field label="Vendor's item code">
          <TextInput
            value={vcode}
            placeholder="optional"
            onChange={(e) => setVcode(e.target.value)}
          />
        </Field>
      </div>
      {goods > 0 && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>
            Goods <b className="tabular-nums text-foreground">{inr(goods)}</b>
          </span>
          <span>
            GST <b className="tabular-nums text-foreground">{inr(tax)}</b>
            {supply ? ` (${supply === "igst" ? "IGST" : "CGST + SGST"})` : ""}
          </span>
          <span>
            Total <b className="tabular-nums text-foreground">{inr(r2(goods + tax))}</b>
          </span>
          {next?.mrp != null && (
            <span>
              Price {inr(p.mrp)} →{" "}
              <b className={cn("tabular-nums", next.mrp !== p.mrp && "text-foreground")}>
                {inr(next.mrp)}
              </b>
              {isBill && basis.other
                ? ` (stays on ${(vendors.data ?? []).find((v) => v.id === basis.vendorId)?.display_name}'s lower price)`
                : holdMrp != null
                  ? " (MRP held, GST changed)"
                  : ""}
            </span>
          )}
        </div>
      )}
      {!isBill && vendorId && (
        <Notice>
          Add the bill number to record it as {vend?.display_name}'s bill — then GST input, what you
          owe and the vendor's price are kept too.
        </Notice>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button className="rounded-full" disabled={busy || !!problem} onClick={save}>
          {busy ? "Saving…" : isBill ? "Add stock & record bill" : "Add stock"}
        </Button>
        {problem && qty && <span className="text-xs text-muted-foreground">{problem}</span>}
      </div>
    </div>
  );
}
