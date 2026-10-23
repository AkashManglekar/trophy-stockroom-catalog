import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Minus, Plus, Trash2, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  ADJUST_REASONS,
  NOTE_HINT,
  modeOfReason,
  type AdjustMode,
  type Product,
} from "@/lib/domain";
import { useInvalidate } from "@/lib/data";
import { Card, CardTitle, Code, Field, Notice, Pill, Select, TextInput } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const MODE_LABEL: Record<AdjustMode, string> = { add: "Add", remove: "Remove", set: "Set count" };
const QTY_LABEL: Record<AdjustMode, string> = {
  add: "Quantity to add",
  remove: "Quantity to remove",
  set: "Counted quantity",
};

function after(mode: AdjustMode, stock: number, q: number) {
  return mode === "add" ? stock + q : mode === "remove" ? stock - q : q;
}
function wholeOrNull(v: string) {
  const n = Number(v);
  return v.trim() !== "" && Number.isInteger(n) && n >= 0 ? n : null;
}

type Line = { product_id: string; mode: AdjustMode; qty: number };
async function apply(lines: Line[], reason: string, note: string) {
  const { data, error } = await supabase.rpc("adjust_stock_bulk", {
    p_lines: lines,
    p_reason: reason,
    p_note: note.trim(),
  });
  if (error) throw new Error(error.message);
  return data ?? 0;
}

function ModeSwitch({ mode, onChange }: { mode: AdjustMode; onChange: (m: AdjustMode) => void }) {
  return (
    <div className="inline-flex w-fit gap-1 rounded-full border bg-muted p-1" role="group">
      {(Object.keys(MODE_LABEL) as AdjustMode[]).map((m) => (
        <button
          key={m}
          type="button"
          aria-pressed={mode === m}
          onClick={() => onChange(m)}
          className={cn(
            "rounded-full px-3.5 py-1.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground",
            mode === m && "bg-card text-primary shadow-sm",
          )}
        >
          {MODE_LABEL[m]}
        </button>
      ))}
    </div>
  );
}

/** Adjust one product's stock from its panel: add, remove or set to a counted quantity. */
export function StockAdjustForm({ p, unit }: { p: Product; unit?: string | undefined }) {
  const inv = useInvalidate();
  const [mode, setMode] = useState<AdjustMode>("add");
  const [reason, setReason] = useState<string>(ADJUST_REASONS.add[0]!);
  const [qty, setQty] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const q = wholeOrNull(qty);
  const next = q == null ? null : after(mode, p.stock, q);
  const bad = next != null && next < 0;

  function pickMode(m: AdjustMode) {
    setMode(m);
    setReason(ADJUST_REASONS[m][0]!);
    if (m === "set") setQty(String(p.stock));
    else setQty("");
  }
  async function save() {
    if (q == null) {
      toast.error("Enter a whole number");
      return;
    }
    if (bad) {
      toast.error(`Only ${p.stock} in stock`);
      return;
    }
    if (next === p.stock) {
      toast("No change to save");
      return;
    }
    setBusy(true);
    try {
      await apply([{ product_id: p.id, mode, qty: q }], reason, note);
      toast.success(`${p.code}: stock ${p.stock} → ${next}`);
      setQty("");
      setNote("");
      await inv("products", "adjustments");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-3 rounded-xl border bg-muted/40 p-3">
      <ModeSwitch mode={mode} onChange={pickMode} />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-[110px_1fr]">
        <Field label={QTY_LABEL[mode]}>
          <TextInput
            inputMode="numeric"
            value={qty}
            placeholder="0"
            onChange={(e) => setQty(e.target.value.replace(/[^\d]/g, ""))}
          />
        </Field>
        <Field label="Reason">
          <Select value={reason} onChange={(e) => setReason(e.target.value)}>
            {ADJUST_REASONS[mode].map((r) => (
              <option key={r}>{r}</option>
            ))}
          </Select>
        </Field>
        <Field label="Note" className="col-span-2">
          <TextInput
            value={note}
            placeholder={NOTE_HINT[reason] ?? "optional"}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className={cn("text-sm tabular-nums", bad && "text-destructive")}>
          Stock {p.stock}
          {next != null ? ` → ${next}` : ""} {unit ?? ""}
        </span>
        <Button
          className="rounded-full"
          disabled={busy || q == null || bad || next === p.stock}
          onClick={save}
        >
          {busy ? "Saving…" : "Save adjustment"}
        </Button>
      </div>
    </div>
  );
}

type Row = { id: string; text: string; productId: string; qty: string };
const newRow = (): Row => ({
  id: Math.random().toString(36).slice(2),
  text: "",
  productId: "",
  qty: "",
});

/** Adjust many products at once — e.g. an opening-stock count or a batch of customer returns. */
export function BulkAdjust({ products, onClose }: { products: Product[]; onClose: () => void }) {
  const inv = useInvalidate();
  const [reason, setReason] = useState<string>("Opening stock");
  const [note, setNote] = useState("");
  const [rows, setRows] = useState<Row[]>([newRow()]);
  const [busy, setBusy] = useState(false);
  const mode = modeOfReason(reason);
  const live = useMemo(() => products.filter((p) => p.status !== "Archived"), [products]);
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const byCode = useMemo(() => new Map(products.map((p) => [p.code.toLowerCase(), p])), [products]);

  const resolve = (text: string) => {
    const t = text.trim().toLowerCase();
    if (!t) return undefined;
    const code = t.split(" · ")[0]!.trim();
    return (
      byCode.get(code) ??
      live.find((p) => `${p.code} · ${p.friendly_name}`.toLowerCase() === t) ??
      (live.filter((p) => p.friendly_name.toLowerCase() === t).length === 1
        ? live.find((p) => p.friendly_name.toLowerCase() === t)
        : undefined)
    );
  };
  const upd = (id: string, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const checked = rows.map((r) => {
    const p = r.productId ? byId.get(r.productId) : undefined;
    const q = wholeOrNull(r.qty);
    const next = p && q != null ? after(mode, p.stock, q) : null;
    const dup = !!p && rows.filter((x) => x.productId === p.id).length > 1;
    const err = !r.text.trim()
      ? ""
      : !p
        ? "No product with that code"
        : dup
          ? "Listed twice"
          : q == null
            ? "Enter a quantity"
            : next! < 0
              ? `Only ${p.stock} in stock`
              : "";
    return { r, p, q, next, err };
  });
  const ready = checked.filter((c) => c.p && c.q != null && !c.err);
  const blocked = checked.some((c) => c.err);
  const units = ready.reduce((a, c) => a + Math.abs(c.next! - c.p!.stock), 0);

  async function save() {
    if (!ready.length || blocked) return;
    setBusy(true);
    try {
      const n = await apply(
        ready.map((c) => ({ product_id: c.p!.id, mode, qty: c.q! })),
        reason,
        note,
      );
      toast.success(`${reason}: ${n} product${n === 1 ? "" : "s"} updated`);
      setRows([newRow()]);
      setNote("");
      await inv("products", "adjustments");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="border-accent">
      <CardTitle
        right={
          <Button
            size="icon"
            variant="ghost"
            className="rounded-full"
            onClick={onClose}
            title="Close"
          >
            <X className="size-4" />
          </Button>
        }
      >
        Inventory adjustment
      </CardTitle>
      <p className="text-sm text-muted-foreground">
        Opening stock, customer returns, recounts or write-offs for products that already have a
        code. Type or scan the product code on each line. Everything is saved together and logged on
        each product.
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_2fr]">
        <Field
          label="Reason"
          hint={
            mode === "set"
              ? "Enter what you counted — stock is set to that number."
              : mode === "add"
                ? "Quantities are added to stock."
                : "Quantities are taken off stock."
          }
        >
          <Select value={reason} onChange={(e) => setReason(e.target.value)}>
            {(Object.keys(ADJUST_REASONS) as AdjustMode[]).map((m) => (
              <optgroup key={m} label={MODE_LABEL[m]}>
                {ADJUST_REASONS[m].map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </optgroup>
            ))}
          </Select>
        </Field>
        <Field label="Note (applies to all lines)">
          <TextInput
            value={note}
            placeholder={NOTE_HINT[reason] ?? "optional"}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>
      </div>

      <datalist id="adjust-products">
        {live.map((p) => (
          <option key={p.id} value={`${p.code} · ${p.friendly_name}`} />
        ))}
      </datalist>
      <div className="grid gap-2">
        {checked.map(({ r, p, next, err }, i) => (
          <div key={r.id} className="grid gap-1.5 rounded-xl border p-2.5">
            <div className="grid grid-cols-[1fr_88px_auto] items-end gap-2">
              <Field label={i === 0 ? "Product code or name" : ""}>
                <TextInput
                  list="adjust-products"
                  value={r.text}
                  placeholder="TC-1001"
                  autoFocus={i === rows.length - 1 && i > 0}
                  onChange={(e) => {
                    const hit = resolve(e.target.value);
                    upd(r.id, { text: e.target.value, productId: hit?.id ?? "" });
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      if (i === rows.length - 1) setRows((rs) => [...rs, newRow()]);
                    }
                  }}
                />
              </Field>
              <Field label={i === 0 ? (mode === "set" ? "Counted" : "Qty") : ""}>
                <TextInput
                  inputMode="numeric"
                  value={r.qty}
                  placeholder="0"
                  onChange={(e) => upd(r.id, { qty: e.target.value.replace(/[^\d]/g, "") })}
                />
              </Field>
              <Button
                size="icon"
                variant="ghost"
                className="mb-0.5 rounded-full"
                title="Remove line"
                onClick={() =>
                  setRows((rs) => (rs.length > 1 ? rs.filter((x) => x.id !== r.id) : [newRow()]))
                }
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
            {(p || err) && (
              <div className="flex flex-wrap items-center gap-2 text-xs">
                {p && <Code>{p.code}</Code>}
                {p && <span className="wrap-any min-w-0 flex-1">{p.friendly_name}</span>}
                {p && (
                  <span className="tabular-nums">
                    stock {p.stock}
                    {next != null ? ` → ${next}` : ""}
                  </span>
                )}
                {err && <Pill tone="bad">{err}</Pill>}
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button
          variant="outline"
          size="sm"
          className="rounded-full"
          onClick={() => setRows((rs) => [...rs, newRow()])}
        >
          <Plus className="size-4" /> Add line
        </Button>
        <div className="flex flex-wrap items-center gap-3">
          {ready.length > 0 && (
            <span className="text-sm">
              {ready.length} product{ready.length === 1 ? "" : "s"} ·{" "}
              {mode === "remove" ? <Minus className="inline size-3" /> : null}
              {units} unit{units === 1 ? "" : "s"}
            </span>
          )}
          <Button
            className="rounded-full font-bold uppercase"
            disabled={busy || !ready.length || blocked}
            onClick={save}
          >
            {busy ? "Saving…" : "Save adjustment"}
          </Button>
        </div>
      </div>
      <Notice>
        Item not in the system yet? Create its code in Receive stock → “New items (no bill)”.
      </Notice>
    </Card>
  );
}
