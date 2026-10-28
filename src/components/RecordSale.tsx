import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { inr, num, today, type Product } from "@/lib/domain";
import { errMsg, useInvalidate } from "@/lib/data";
import { recordSale } from "@/lib/zoho-sync.functions";
import { Card, CardTitle, Code, Field, Notice, Pill, TextInput } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Line = { id: string; q: string; productId: string; qty: string; price: string };
const uid = () => Math.random().toString(36).slice(2, 9);
const blank = (): Line => ({ id: uid(), q: "", productId: "", qty: "1", price: "" });

/**
 * Sell from the stockroom: products, quantity, price and customer. Stock comes off at once; with
 * Zoho connected it is also created as a Zoho invoice (so it's on your books and the next sync
 * recognises it instead of counting it again).
 */
export function RecordSale({
  products,
  customers,
  zohoOn,
  preset,
  onClose,
}: {
  products: Product[];
  customers: string[];
  zohoOn: boolean;
  preset?: string | undefined;
  onClose: () => void;
}) {
  const inv = useInvalidate();
  const sellable = useMemo(
    () => products.filter((p) => p.status !== "Archived" && p.status !== "Discontinued"),
    [products],
  );
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const first = preset ? byId.get(preset) : undefined;
  const [lines, setLines] = useState<Line[]>(() => [
    first
      ? {
          ...blank(),
          q: `${first.code} · ${first.friendly_name}`,
          productId: first.id,
          price: first.mrp != null ? String(first.mrp) : "",
        }
      : blank(),
  ]);
  const [customer, setCustomer] = useState("");
  const [phone, setPhone] = useState("");
  const [gstin, setGstin] = useState("");
  const [business, setBusiness] = useState(false);
  const [date, setDate] = useState(today());
  const [note, setNote] = useState("");
  const [toZoho, setToZoho] = useState(zohoOn);
  const [busy, setBusy] = useState(false);

  const upd = (id: string, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const pick = (id: string, text: string) => {
    const code = (text.split(" ")[0] ?? "").trim().toUpperCase();
    const p =
      sellable.find((x) => x.code === code) ??
      sellable.find((x) => (x.alias_codes ?? []).includes(code));
    upd(id, {
      q: text,
      productId: p?.id ?? "",
      ...(p ? { price: p.mrp != null ? String(p.mrp) : "" } : {}),
    });
  };

  const rows = lines.map((l) => {
    const p = l.productId ? byId.get(l.productId) : undefined;
    const qty = num(l.qty);
    const price = num(l.price);
    const gst = Number(p?.gst ?? 0);
    const total = qty != null && price != null ? qty * price : 0;
    const problem = !p
      ? "pick a product"
      : qty == null || qty <= 0 || !Number.isInteger(qty)
        ? "whole quantity"
        : price == null || price < 0
          ? "price"
          : "";
    const short = p && qty != null && qty > p.stock;
    const belowFloor =
      p &&
      price != null &&
      p.floor_price != null &&
      price / (1 + gst / 100) < Number(p.floor_price);
    return { l, p, qty, price, gst, total, problem, short, belowFloor };
  });
  const filled = rows.filter((r) => r.l.productId || r.l.q.trim());
  const total = filled.reduce((a, r) => a + r.total, 0);
  const beforeGst = filled.reduce((a, r) => a + r.total / (1 + r.gst / 100), 0);
  const units = filled.reduce((a, r) => a + (r.qty ?? 0), 0);
  const bad = !filled.length || filled.some((r) => r.problem);
  const gstinBad = business && gstin.trim() !== "" && gstin.trim().length !== 15;

  async function submit() {
    setBusy(true);
    try {
      const r = await recordSale({
        data: {
          date,
          customer: customer.trim() || "Walk-in customer",
          phone: phone.trim() || undefined,
          gstin: business ? gstin.trim().toUpperCase() || undefined : undefined,
          note: note.trim() || undefined,
          zoho: toZoho,
          lines: filled.map((x) => ({
            productId: x.l.productId,
            qty: x.qty ?? 0,
            price: x.price ?? 0,
          })),
        },
      });
      if (r.inZoho) toast.success(`Sold — Zoho invoice ${r.docNo} · ${r.units} units out of stock`);
      else if (r.zohoError && toZoho)
        toast.warning(
          `Saved as ${r.docNo} and stock updated, but not in Zoho: ${r.zohoError}. Use "Send to Zoho" on the sale later.`,
          { duration: 12000 },
        );
      else toast.success(`Sold — ${r.docNo} · ${r.units} units out of stock`);
      await inv("sales", "products", "adjustments", "reorder_flags");
      onClose();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="border-primary">
      <CardTitle
        right={
          <Button size="sm" variant="ghost" className="rounded-full" onClick={onClose}>
            Close
          </Button>
        }
      >
        Record a sale
      </CardTitle>

      <div className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr]">
        <Field label="Customer" hint="Blank = Walk-in customer">
          <TextInput
            list="sale-customers"
            value={customer}
            placeholder="Name or organisation"
            onChange={(e) => setCustomer(e.target.value)}
          />
          <datalist id="sale-customers">
            {customers.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </Field>
        <Field label="Phone (optional)">
          <TextInput inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </Field>
        <Field label="Date">
          <TextInput type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
      </div>
      <label className="flex w-fit items-center gap-2 text-sm">
        <input type="checkbox" checked={business} onChange={(e) => setBusiness(e.target.checked)} />
        Business customer — GST invoice with their GSTIN
      </label>
      {business && (
        <Field
          label="Customer GSTIN"
          hint={gstinBad ? "GSTIN has 15 characters" : "Their state sets CGST+SGST or IGST in Zoho"}
          className="max-w-sm"
        >
          <TextInput
            value={gstin}
            maxLength={15}
            className="uppercase"
            onChange={(e) => setGstin(e.target.value)}
          />
        </Field>
      )}

      <div className="grid gap-2">
        {rows.map(({ l, p, total: t, problem, short, belowFloor }, i) => (
          <div
            key={l.id}
            className="grid gap-2 rounded-xl border p-2.5 sm:grid-cols-[minmax(0,1fr)_80px_120px_110px_36px] sm:items-end"
          >
            <Field label={`Product ${i + 1}`}>
              <TextInput
                list="sale-products"
                value={l.q}
                autoFocus={i === lines.length - 1 && !preset}
                placeholder="type a code or name"
                onChange={(e) => pick(l.id, e.target.value)}
              />
            </Field>
            <Field label="Qty">
              <TextInput
                inputMode="numeric"
                value={l.qty}
                onChange={(e) => upd(l.id, { qty: e.target.value })}
              />
            </Field>
            <Field label="Price each (incl. GST)">
              <TextInput
                inputMode="decimal"
                value={l.price}
                onChange={(e) => upd(l.id, { price: e.target.value })}
              />
            </Field>
            <div className="grid gap-0.5 pb-1 text-right text-sm tabular-nums">
              <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                Line total
              </span>
              <b>{inr(t)}</b>
            </div>
            <Button
              size="icon"
              variant="ghost"
              className="rounded-full"
              aria-label={`Remove product ${i + 1}`}
              disabled={lines.length === 1}
              onClick={() => setLines((ls) => ls.filter((x) => x.id !== l.id))}
            >
              <Trash2 className="size-4" />
            </Button>
            {(p || problem) && (
              <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground sm:col-span-5">
                {p && (
                  <>
                    <Code>{p.code}</Code>
                    <span>
                      {p.stock} in stock · MRP {inr(p.mrp)} · GST {Number(p.gst ?? 0)}%
                    </span>
                  </>
                )}
                {short && <Pill tone="warn">more than in stock</Pill>}
                {belowFloor && <Pill tone="warn">below floor price {inr(p?.floor_price)}</Pill>}
                {problem && (l.q.trim() || lines.length > 1) && <Pill tone="bad">{problem}</Pill>}
              </div>
            )}
          </div>
        ))}
        <datalist id="sale-products">
          {sellable.map((p) => (
            <option key={p.id} value={`${p.code} · ${p.friendly_name}`}>
              {p.stock} in stock · {inr(p.mrp)}
            </option>
          ))}
        </datalist>
        <Button
          size="sm"
          variant="outline"
          className="w-fit rounded-full"
          onClick={() => setLines((ls) => [...ls, blank()])}
        >
          <Plus className="size-4" /> Another product
        </Button>
      </div>

      <Field label="Note (optional)">
        <TextInput
          value={note}
          placeholder="e.g. engraving, event name, paid by UPI"
          onChange={(e) => setNote(e.target.value)}
        />
      </Field>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-muted p-3">
        <div className="flex flex-wrap gap-5 text-xs text-muted-foreground">
          <span>
            <b className="block text-base tabular-nums text-foreground">{inr(r2(total))}</b>
            total incl. GST
          </span>
          <span>
            <b className="block text-base tabular-nums text-foreground">{inr(r2(beforeGst))}</b>
            before GST
          </span>
          <span>
            <b className="block text-base tabular-nums text-foreground">{units}</b>
            units out of stock
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label
            className={cn("flex items-center gap-2 text-sm", !zohoOn && "opacity-60")}
            title={zohoOn ? "" : "Connect Zoho Books on this page first"}
          >
            <input
              type="checkbox"
              checked={toZoho && zohoOn}
              disabled={!zohoOn}
              onChange={(e) => setToZoho(e.target.checked)}
            />
            Create the invoice in Zoho
          </label>
          <Button
            className="rounded-full font-bold uppercase"
            disabled={busy || bad || gstinBad}
            onClick={submit}
          >
            {busy ? "Saving…" : "Record sale"}
          </Button>
        </div>
      </div>
      {!zohoOn && (
        <Notice>
          Zoho Books isn't connected, so this sale is kept here and stock updates now. Once Zoho is
          connected, use <b>Send to Zoho</b> on the sale to create its invoice.
        </Notice>
      )}
    </Card>
  );
}

const r2 = (x: number) => Math.round(x * 100) / 100;
