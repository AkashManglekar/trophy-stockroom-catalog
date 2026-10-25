import { useState } from "react";
import { Grid3x3, Trash2 } from "lucide-react";
import type { DraftLine } from "@/lib/draft";
import type { LinePlan, PlanCtx } from "@/lib/receive-plan";
import { inr, num } from "@/lib/domain";
import { sizeLabel } from "@/lib/naming";
import { swatchOf } from "@/lib/variants";
import {
  cellKey,
  groupColours,
  groupSizes,
  variantCost,
  type VariantCell,
  type VariantGroup,
} from "@/lib/variant-grid";
import { Code, Field, Pill, Select, TextInput } from "@/components/kit";
import { cn } from "@/lib/utils";

const COMMON_COLOURS = ["GD", "SV", "BZ"];

/**
 * One bill entry for a design bought in several sizes and colours. Shared details are typed once;
 * the grid takes a quantity (and optionally a cost) per size × colour.
 */
export function VariantGroupCard({
  g,
  members,
  plans,
  ctx,
  isBill,
  firstNo,
  onChange,
  onRemove,
}: {
  g: VariantGroup;
  members: DraftLine[];
  plans: Record<string, LinePlan>;
  ctx: PlanCtx;
  isBill: boolean;
  firstNo: number;
  onChange: (g: VariantGroup) => void;
  onRemove: () => void;
}) {
  const { ref } = ctx;
  const c = g.cls;
  const t = ref.types.find((x) => x.div === c.div && x.code === c.type);
  const unit = t?.size_unit ?? "in";
  const types = ref.types.filter((x) => !c.div || x.div === c.div);
  const famKey = [c.div, c.type, c.mat, c.sport].join("-");
  const fams =
    c.div && c.type && c.mat && c.sport
      ? ctx.families.filter((f) => [f.div, f.type, f.mat, f.sport].join("-") === famKey)
      : [];
  const famPicked = c.family.startsWith("f:") ? fams.find((f) => "f:" + f.id === c.family) : null;
  const sizes = groupSizes(g, unit);
  const colours = groupColours(g);
  const [moreColour, setMoreColour] = useState("");

  const set = (patch: Partial<VariantGroup>) => onChange({ ...g, ...patch });
  const setCls = (k: keyof DraftLine["cls"], v: string) => {
    const cls = { ...c, [k]: v };
    if (k === "div" && !ref.types.some((x) => x.div === v && x.code === cls.type)) cls.type = "";
    if (["div", "type", "mat", "sport"].includes(k)) cls.family = "new";
    onChange({ ...g, cls, ...(k === "type" ? { sizesText: "" } : {}) });
  };
  const setCell = (size: string, finish: string, patch: Partial<VariantCell>) => {
    const k = cellKey(size, finish);
    set({ cells: { ...g.cells, [k]: { qty: "", ...g.cells[k], ...patch } } });
  };
  const toggleColour = (code: string) =>
    set({
      colours: g.colours.includes(code)
        ? g.colours.filter((x) => x !== code)
        : [...g.colours, code],
    });
  const toggleApparel = (code: string) => {
    const cur = g.sizesText
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
    set({
      sizesText: (cur.includes(code) ? cur.filter((x) => x !== code) : [...cur, code]).join(", "),
    });
  };

  const planOf = (size: string, finish: string) => {
    const m = members.find((x) => x.cls.size === size && x.cls.finish === finish);
    return m ? plans[m.id] : undefined;
  };
  const units = members.reduce((a, m) => a + (num(m.billed) ?? 0), 0);
  const value = members.reduce((a, m) => a + (num(m.billed) ?? 0) * (num(m.cost) ?? 0), 0);
  const errors = [...new Set(members.flatMap((m) => plans[m.id]?.errors ?? []))];
  const warns = [...new Set(members.flatMap((m) => plans[m.id]?.warns ?? []))];
  const colourName = (code: string) => ref.finishes.find((f) => f.code === code)?.name ?? code;
  const lastNo = firstNo + Math.max(members.length, 1) - 1;
  const showColours = [...new Set([...COMMON_COLOURS, ...g.colours])].filter((x) =>
    ref.finishes.some((f) => f.code === x),
  );

  return (
    <div
      className={cn(
        "grid gap-3 rounded-xl border border-l-4 bg-card p-3",
        errors.length || !members.length ? "border-l-warning" : "border-l-accent",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="code-tag text-xs text-muted-foreground">
          #{firstNo}
          {lastNo > firstNo ? `–${lastNo}` : ""}
        </span>
        <Pill tone="brand">
          <Grid3x3 className="size-3" /> Sizes & colours
        </Pill>
        <span className="text-xs text-muted-foreground">
          {members.length} variant{members.length === 1 ? "" : "s"} · {units} pcs
          {isBill && value ? ` · ${inr(value)}` : ""}
        </span>
        <button
          className="ml-auto rounded-full p-2 text-muted-foreground hover:bg-muted"
          aria-label="Remove this entry"
          title="Remove this entry"
          onClick={onRemove}
        >
          <Trash2 className="size-4" />
        </button>
      </div>

      <div
        className={cn(
          "grid grid-cols-2 gap-3",
          isBill ? "sm:grid-cols-[1fr_2fr_110px_76px]" : "sm:grid-cols-[1fr_2fr_110px]",
        )}
      >
        <Field label={isBill ? "Vendor code" : "Code"} className="col-span-2 sm:col-span-1">
          <TextInput
            value={g.vitem}
            placeholder="their item code"
            onChange={(e) => set({ vitem: e.target.value })}
          />
        </Field>
        <Field label="Description" className="col-span-2 sm:col-span-1">
          <TextInput value={g.desc} onChange={(e) => set({ desc: e.target.value })} />
        </Field>
        <Field label="Default cost ₹">
          <TextInput
            inputMode="decimal"
            value={g.cost}
            onChange={(e) => set({ cost: e.target.value })}
          />
        </Field>
        {isBill && (
          <Field label="GST %">
            <TextInput
              inputMode="decimal"
              list="gst-rates"
              value={g.gst ?? ""}
              placeholder={t?.gst != null ? String(t.gst) : ""}
              onChange={(e) => set({ gst: e.target.value })}
            />
          </Field>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Field label="Division">
          <Select value={c.div} onChange={(e) => setCls("div", e.target.value)}>
            <option value="">—</option>
            {ref.divisions.map((d) => (
              <option key={d.code} value={d.code}>
                {d.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Type">
          <Select value={c.type} onChange={(e) => setCls("type", e.target.value)}>
            <option value="">—</option>
            {types.map((x) => (
              <option key={x.id} value={x.code}>
                {x.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Material">
          <Select value={c.mat} onChange={(e) => setCls("mat", e.target.value)}>
            <option value="">—</option>
            {ref.materials.map((m) => (
              <option key={m.code} value={m.code}>
                {m.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Sport">
          <Select value={c.sport} onChange={(e) => setCls("sport", e.target.value)}>
            {ref.sports.map((m) => (
              <option key={m.code} value={m.code}>
                {m.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Design family">
          <Select value={c.family} onChange={(e) => setCls("family", e.target.value)}>
            <option value="new">New design</option>
            {fams.map((f) => (
              <option key={f.id} value={`f:${f.id}`}>
                {f.code ?? `Design ${String(f.design_no).padStart(3, "0")}`} ·{" "}
                {f.design_name || "unnamed"}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Design name">
          <TextInput
            value={famPicked?.design_name ?? c.designName}
            disabled={!!famPicked?.design_name}
            placeholder={c.family === "new" ? "e.g. Laurel" : "inherits family name"}
            onChange={(e) => setCls("designName", e.target.value)}
          />
        </Field>
        {c.family === "new" ? (
          <Field label="Catalogue">
            <Select
              value={c.internal === "1" ? "1" : ""}
              onChange={(e) => setCls("internal", e.target.value)}
            >
              <option value="">Show on catalogue</option>
              <option value="1">Internal only</option>
            </Select>
          </Field>
        ) : null}
        <Field label="Shelf location">
          <TextInput
            value={g.location}
            placeholder="e.g. A1-03"
            onChange={(e) => set({ location: e.target.value })}
          />
        </Field>
        <Field label="Customer description" className="col-span-2 sm:col-span-4">
          <TextInput
            value={c.description}
            placeholder="Shown in the catalogue (optional)"
            onChange={(e) => setCls("description", e.target.value)}
          />
        </Field>
      </div>

      <div className="grid gap-3 rounded-xl bg-muted/50 p-3">
        <div className="grid gap-3 sm:grid-cols-2">
          {unit !== "none" && (
            <Field label={unit === "size" ? "Sizes" : `Sizes (${unit}) — separate with commas`}>
              {unit === "size" ? (
                <div className="flex flex-wrap gap-1.5">
                  {ref.sizes.map((s) => {
                    const on = sizes.includes(s.code);
                    return (
                      <button
                        key={s.code}
                        type="button"
                        aria-pressed={on}
                        onClick={() => toggleApparel(s.code)}
                        className={cn(
                          "rounded-full border px-2.5 py-1 text-xs font-semibold",
                          on ? "border-primary bg-primary text-primary-foreground" : "bg-card",
                        )}
                      >
                        {s.name}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <TextInput
                  inputMode="decimal"
                  value={g.sizesText}
                  placeholder={unit === "in" ? "e.g. 2, 2.5, 3" : "e.g. 50, 65"}
                  onChange={(e) => set({ sizesText: e.target.value })}
                />
              )}
            </Field>
          )}
          <Field label="Colours / finishes">
            <div className="flex flex-wrap items-center gap-1.5">
              {showColours.map((code) => {
                const on = g.colours.includes(code);
                return (
                  <button
                    key={code}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleColour(code)}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full border py-0.5 pl-0.5 pr-2.5 text-xs font-semibold",
                      on
                        ? "border-primary bg-primary/10 text-primary ring-1 ring-primary"
                        : "bg-card",
                    )}
                  >
                    <span
                      className="size-4 rounded-full ring-1 ring-black/15"
                      style={{ background: swatchOf(colourName(code)) }}
                    />
                    {colourName(code)}
                  </button>
                );
              })}
              <Select
                className="h-8 w-auto py-0 text-xs"
                value={moreColour}
                aria-label="Add another colour"
                onChange={(e) => {
                  if (e.target.value && !g.colours.includes(e.target.value))
                    set({ colours: [...g.colours, e.target.value] });
                  setMoreColour("");
                }}
              >
                <option value="">+ other</option>
                {ref.finishes
                  .filter((f) => !showColours.includes(f.code))
                  .map((f) => (
                    <option key={f.code} value={f.code}>
                      {f.name}
                    </option>
                  ))}
              </Select>
            </div>
          </Field>
        </div>

        {sizes.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-[10.5px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="p-1.5 text-left">{g.colours.length ? "Colour" : ""}</th>
                  {sizes.map((s) => (
                    <th key={s} className="p-1.5 text-left">
                      {unit === "none" ? "Qty" : sizeLabel(s, unit, ref.sizes)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {unit !== "none" && (
                  <tr className="border-t bg-card/60">
                    <th className="whitespace-nowrap p-1.5 text-left font-semibold">
                      Cost ₹ / size
                    </th>
                    {sizes.map((s) => (
                      <td key={s} className="p-1">
                        <TextInput
                          inputMode="decimal"
                          aria-label={`Cost ${sizeLabel(s, unit, ref.sizes)}`}
                          className="h-9 min-w-20 tabular-nums"
                          placeholder={g.cost ? `₹${g.cost}` : "₹ cost"}
                          value={g.sizeCost?.[s] ?? ""}
                          onChange={(e) =>
                            set({ sizeCost: { ...(g.sizeCost ?? {}), [s]: e.target.value } })
                          }
                        />
                      </td>
                    ))}
                  </tr>
                )}
                {colours.map((fc) => (
                  <tr key={fc || "one"} className="border-t">
                    <th className="whitespace-nowrap p-1.5 text-left font-semibold">
                      {fc && g.colours.length ? (
                        <span className="inline-flex items-center gap-1.5">
                          <span
                            className="size-3.5 rounded-full ring-1 ring-black/15"
                            style={{ background: swatchOf(colourName(fc)) }}
                          />
                          {colourName(fc)}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">{fc ? colourName(fc) : "—"}</span>
                      )}
                    </th>
                    {sizes.map((s) => {
                      const cell = g.cells[cellKey(s, fc)];
                      return (
                        <td key={s} className="p-1 align-top">
                          <div className="grid min-w-20 gap-1">
                            <TextInput
                              inputMode="numeric"
                              aria-label={`Quantity ${sizeLabel(s, unit, ref.sizes)} ${colourName(fc)}`}
                              className="h-9 tabular-nums"
                              placeholder="qty"
                              value={cell?.qty ?? ""}
                              onChange={(e) => setCell(s, fc, { qty: e.target.value })}
                            />
                            <TextInput
                              inputMode="decimal"
                              aria-label={`Cost ${sizeLabel(s, unit, ref.sizes)} ${colourName(fc)}`}
                              className="h-8 text-xs tabular-nums"
                              placeholder={(() => {
                                const inherited = g.sizeCost?.[s]?.trim() || g.cost.trim();
                                return inherited ? `₹${inherited}` : "₹ cost";
                              })()}
                              value={cell?.cost ?? ""}
                              onChange={(e) => setCell(s, fc, { cost: e.target.value })}
                            />
                            {(() => {
                              const P = planOf(s, fc);
                              const price =
                                P?.preview?.price.mrp ??
                                (P?.productId
                                  ? ctx.products.find((p) => p.id === P.productId)?.mrp
                                  : null);
                              return cell?.qty && price != null ? (
                                <span className="text-[10.5px] text-muted-foreground tabular-nums">
                                  ₹{variantCost(g, s, fc) || "—"} → sells {inr(price)}
                                </span>
                              ) : null;
                            })()}
                            {isBill && g.perCellReceived && (
                              <TextInput
                                inputMode="numeric"
                                aria-label="Received"
                                className="h-8 text-xs tabular-nums"
                                placeholder={cell?.qty ? `rcvd ${cell.qty}` : "received"}
                                value={cell?.received ?? ""}
                                onChange={(e) => setCell(s, fc, { received: e.target.value })}
                              />
                            )}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {c.type ? "Type the sizes to get the grid." : "Pick the type, then the sizes."}
          </p>
        )}
        <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs">
          <span className="text-muted-foreground">
            Cost: a cell's own cost, else its size's cost, else the default.
          </span>
          {isBill && (
            <label className="inline-flex items-center gap-1.5">
              <input
                type="checkbox"
                className="size-4"
                checked={!!g.perCellReceived}
                onChange={(e) => set({ perCellReceived: e.target.checked })}
              />
              Some arrived short
            </label>
          )}
        </div>
      </div>

      {members.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {members.map((m) => {
            const P = plans[m.id];
            const code = P?.preview?.code ?? ctx.products.find((p) => p.id === P?.productId)?.code;
            return (
              <span
                key={m.id}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs",
                  P?.errors.length ? "border-warning" : "bg-accent/10",
                )}
              >
                {code ? <Code>{code}</Code> : null}
                <span className="tabular-nums">
                  × {m.billed} @ {m.cost ? inr(num(m.cost)) : "—"}
                </span>
                <span className="text-muted-foreground">
                  {P?.kind === "new" ? "new" : P ? "adds to stock" : ""}
                </span>
              </span>
            );
          })}
        </div>
      )}
      {!members.length && (
        <p className="text-sm text-warning-foreground dark:text-warning">
          Enter a quantity in at least one cell.
        </p>
      )}
      {errors.length > 0 && (
        <p className="text-sm text-warning-foreground dark:text-warning">
          Needs: {errors.join("; ")}
        </p>
      )}
      {warns.length > 0 && (
        <p className="text-sm text-warning-foreground dark:text-warning">
          Check: {warns.join("; ")}
        </p>
      )}
    </div>
  );
}
