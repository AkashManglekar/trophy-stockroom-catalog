import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Family, Product, RefData } from "@/lib/domain";
import { errMsg, repriceProducts, useInvalidate } from "@/lib/data";
import { friendlyName, normaliseSize } from "@/lib/naming";
import { Field, Notice, Select, TextInput } from "@/components/kit";
import { Button } from "@/components/ui/button";

/**
 * Change what a product is after it exists. Category, type, material and sport belong to the
 * whole design (all its sizes); size and finish belong to this product. The product code never
 * changes — the internal spec code, name and price follow.
 */
export function EditDetails({
  p,
  fam,
  siblings,
  ref_,
  onClose,
}: {
  p: Product;
  fam: Family | undefined;
  siblings: Product[];
  ref_: RefData;
  onClose: () => void;
}) {
  const inv = useInvalidate();
  const [div, setDiv] = useState(p.div);
  const [type, setType] = useState(p.type);
  const [mat, setMat] = useState(p.mat);
  const [sport, setSport] = useState(p.sport);
  const oldT = ref_.types.find((x) => x.div === p.div && x.code === p.type);
  const newT = ref_.types.find((x) => x.div === div && x.code === type);
  const unit = newT?.size_unit ?? "none";
  const [size, setSize] = useState(
    p.size === "000"
      ? ""
      : (oldT?.size_unit ?? "none") === "size"
        ? p.size
        : String(Number(p.size) || p.size),
  );
  const [finish, setFinish] = useState(p.finish);
  const [busy, setBusy] = useState(false);

  const designChanged = div !== p.div || type !== p.type || mat !== p.mat || sport !== p.sport;
  const sizeNorm = unit === "none" ? "000" : normaliseSize(size, unit) || "000";
  const variantChanged = sizeNorm !== p.size || finish !== p.finish;
  const unitChanged = (oldT?.size_unit ?? "none") !== unit;
  const design = fam?.design_name || p.friendly_name.split(" · ")[0] || p.friendly_name;
  const newName = friendlyName(design, sizeNorm === "000" ? "" : sizeNorm, unit, finish, ref_);
  const clash = siblings.find((x) => x.id !== p.id && x.size === sizeNorm && x.finish === finish);

  async function save() {
    if (!fam) return;
    setBusy(true);
    try {
      if (designChanged) {
        const { error } = await supabase.rpc("reclassify_design", {
          p_family: fam.id,
          p_div: div,
          p_type: type,
          p_mat: mat,
          p_sport: sport,
        });
        if (error) throw new Error(error.message);
      }
      if (variantChanged) {
        const { error } = await supabase.rpc("edit_variant", {
          p_product: p.id,
          p_size: sizeNorm,
          p_finish: finish,
          p_name: newName,
        });
        if (error) throw new Error(error.message);
      }
      // A new type can mean other price bands; re-price every size of the design.
      const ids = designChanged ? siblings.map((x) => x.id) : [p.id];
      const fresh = await supabase.from("products").select("*").in("id", ids);
      if (fresh.data) await repriceProducts(fresh.data, ref_);
      toast.success(
        `${p.code} updated` +
          (designChanged && siblings.length > 1
            ? ` — all ${siblings.length} sizes of the design`
            : "") +
          " · code unchanged",
      );
      await inv("products", "families", "adjustments");
      onClose();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-3 rounded-xl border border-primary/50 bg-primary/5 p-3">
      <p className="text-xs text-muted-foreground">
        Product code <b className="font-mono text-foreground">{p.code}</b> stays the same. The
        internal spec code, name and price update to match.
      </p>
      <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
        The design{siblings.length > 1 ? ` — all ${siblings.length} sizes` : ""}
      </span>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Division">
          <Select
            value={div}
            onChange={(e) => {
              setDiv(e.target.value);
              const first = ref_.types.find((x) => x.div === e.target.value);
              setType(first?.code ?? "");
            }}
          >
            {ref_.divisions.map((x) => (
              <option key={x.code} value={x.code}>
                {x.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Type">
          <Select value={type} onChange={(e) => setType(e.target.value)}>
            {ref_.types
              .filter((x) => x.div === div)
              .map((x) => (
                <option key={x.id} value={x.code}>
                  {x.name}
                </option>
              ))}
          </Select>
        </Field>
        <Field label="Material">
          <Select value={mat} onChange={(e) => setMat(e.target.value)}>
            {ref_.materials.map((x) => (
              <option key={x.code} value={x.code}>
                {x.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Sport">
          <Select value={sport} onChange={(e) => setSport(e.target.value)}>
            {ref_.sports.map((x) => (
              <option key={x.code} value={x.code}>
                {x.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
        This size
      </span>
      <div className="grid grid-cols-2 gap-2">
        {unit === "none" ? (
          <p className="self-end text-xs text-muted-foreground">This type has no sizes.</p>
        ) : (
          <Field label={unit === "size" ? "Size" : `Size (${unit})`}>
            {unit === "size" ? (
              <Select value={size} onChange={(e) => setSize(e.target.value)}>
                <option value="">—</option>
                {ref_.sizes.map((s) => (
                  <option key={s.code} value={s.code}>
                    {s.name}
                  </option>
                ))}
              </Select>
            ) : (
              <TextInput
                inputMode="decimal"
                value={size}
                onChange={(e) => setSize(e.target.value)}
              />
            )}
          </Field>
        )}
        <Field label="Finish / colour">
          <Select value={finish} onChange={(e) => setFinish(e.target.value)}>
            <option value="NA">—</option>
            {ref_.finishes.map((f) => (
              <option key={f.code} value={f.code}>
                {f.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      {variantChanged && (
        <p className="text-xs text-muted-foreground">
          Name becomes <b className="text-foreground">{newName}</b>
        </p>
      )}
      {designChanged && unitChanged && (
        <Notice>
          {newT?.name} uses{" "}
          {unit === "none" ? "no sizes" : unit === "size" ? "S/M/L sizes" : `sizes in ${unit}`}.
          Check the size of each product in this design after saving.
        </Notice>
      )}
      {designChanged && newT?.gst != null && Number(newT.gst) !== Number(p.gst) && (
        <Notice>
          {newT.name} is usually {Number(newT.gst)}% GST; this product sells at {Number(p.gst ?? 0)}
          %. Change it under Selling GST if needed.
        </Notice>
      )}
      {clash && (
        <p className="text-xs font-semibold text-destructive">
          {clash.code} already is this size and finish.
        </p>
      )}
      <div className="flex gap-2">
        <Button variant="ghost" className="rounded-full" onClick={onClose}>
          Cancel
        </Button>
        <Button
          className="rounded-full"
          disabled={busy || !fam || !!clash || !type || (!designChanged && !variantChanged)}
          onClick={save}
        >
          {busy ? "Saving…" : "Save details"}
        </Button>
      </div>
    </div>
  );
}
