import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Camera,
  ClipboardPaste,
  Download,
  FileUp,
  Grid3x3,
  Plus,
  Sparkles,
  Trash2,
  Undo2,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import {
  RECEIPT_TYPES,
  RECEIVE_CHOICES,
  inr,
  num,
  type Product,
  type ReceiptType,
  type Submission,
} from "@/lib/domain";
import {
  designCode,
  errMsg,
  priceFor,
  useFamilies,
  useInvalidate,
  usePhotoMap,
  useProducts,
  useReceipts,
  useRefData,
  usePhotoUrls,
  useSubmissions,
  useVendorCodes,
  useVendors,
  variantLabel,
} from "@/lib/data";
import {
  blankVendor,
  newDraft,
  newLine,
  setDraft,
  useDraft,
  type Draft,
  CHARGE_LABELS,
  type DraftLine,
} from "@/lib/draft";
import {
  billCosts,
  chargeAllocation,
  lineGstRate,
  planDraft,
  summarise,
  type LinePlan,
  type PlanCtx,
} from "@/lib/receive-plan";
import { normDesc } from "@/lib/naming";
import { pricePayload } from "@/lib/pricing";
import { GST_RATES, SUPPLY_LABEL, supplyTypeFor, vendorIssues } from "@/lib/gst";
import { blobToDataUrl, shrinkImage } from "@/lib/photos";
import { extractBill, type Extracted } from "@/lib/ai.functions";
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
  TextArea,
  TextInput,
} from "@/components/kit";
import { PhotoButtons, Thumb } from "@/components/photos";
import { VendorForm, vendorRow } from "@/components/VendorForm";
import { VariantGroupCard } from "@/components/VariantGroupCard";
import {
  applyGroup,
  groupFromLine,
  removeGroup,
  type GridCtx,
  type VariantGroup,
} from "@/lib/variant-grid";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/receive")({
  head: () => ({ meta: [{ title: "Receive stock · Sportagon Stockroom" }] }),
  component: ReceivePage,
});

type Committed = {
  receiptId: string;
  created: { product_id: string; code: string; friendly_name: string; qty: number }[];
  productIds: string[];
  label: string;
};

function ReceivePage() {
  const { canContribute, canEdit, canPublish, canApprove } = useAuth();
  const ref = useRefData();
  const products = useProducts();
  const families = useFamilies();
  const vendors = useVendors();
  const vcodes = useVendorCodes();
  const photoMap = usePhotoMap();
  const counters = useQuery({
    queryKey: ["counters"],
    queryFn: async () => {
      const { data } = await supabase.from("code_counters").select("*");
      return Object.fromEntries((data ?? []).map((c) => [c.prefix, c.next_no])) as Record<
        string,
        number
      >;
    },
  });
  const inv = useInvalidate();
  const draft = useDraft();
  const [busy, setBusy] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [onlyAttn, setOnlyAttn] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [done, setDone] = useState<Committed | null>(null);
  const reviewing = !!draft.reviewOf && canApprove;
  const mode: "publish" | "submit" | "approve" = reviewing
    ? "approve"
    : canPublish
      ? "publish"
      : "submit";

  const ctx: PlanCtx | null = ref.data
    ? {
        ref: ref.data,
        products: products.data ?? [],
        families: families.data ?? [],
        vendorCodes: vcodes.data ?? [],
        counters: counters.data ?? {},
      }
    : null;
  const plans = useMemo(() => (ctx ? planDraft(draft, ctx) : {}), [draft, ctx]);
  const sum = summarise(draft, plans);
  const billVendor =
    draft.vendorId === "NEW"
      ? draft.newVendor
      : (vendors.data ?? []).find((v) => v.id === draft.vendorId);
  const supply = ref.data
    ? supplyTypeFor(billVendor as never, ref.data.settings.company_state)
    : null;
  const costs = ctx ? billCosts(draft, plans, ctx, supply) : null;
  const prodById = useMemo(
    () => new Map((products.data ?? []).map((p) => [p.id, p])),
    [products.data],
  );
  const thumbPaths = useMemo(() => {
    const ids = new Set<string>();
    for (const l of draft.lines) {
      const p = plans[l.id];
      if (p?.productId) ids.add(p.productId);
    }
    for (const c of done?.productIds ?? []) ids.add(c);
    return [...ids].map((id) => photoMap.get(id)?.[0]?.path ?? "").filter(Boolean);
  }, [draft.lines, plans, photoMap, done]);
  const urls = usePhotoUrls(thumbPaths);
  const thumbOf = (pid: string) => urls[photoMap.get(pid)?.[0]?.path ?? ""];

  const dupQ = useQuery({
    queryKey: ["dup-bill", draft.vendorId, draft.billNo.trim().toLowerCase(), draft.type],
    enabled:
      draft.type === "bill" &&
      !!draft.vendorId &&
      draft.vendorId !== "NEW" &&
      !!draft.billNo.trim(),
    queryFn: async () => {
      const { data } = await supabase
        .from("receipts")
        .select("id,created_at,bill_no")
        .eq("vendor_id", draft.vendorId)
        .eq("receipt_type", "bill")
        .is("reversed_at", null)
        .ilike("bill_no", draft.billNo.trim());
      return data?.[0] ?? null;
    },
  });
  const dup = dupQ.data ?? null;

  const vendorProblem =
    draft.type === "bill" && !draft.vendorId
      ? "Pick the vendor"
      : draft.vendorId === "NEW" && vendorIssues(draft.newVendor).length
        ? "Complete the new vendor's details"
        : draft.type === "bill" && !draft.billNo.trim()
          ? "Enter the bill number"
          : dup
            ? `Bill ${draft.billNo} from this vendor was already received`
            : "";
  const ready =
    !!ctx && draft.lines.length > 0 && !sum.err && !vendorProblem && canContribute && !busy;

  const upd = (fn: (d: Draft) => Draft) => {
    setConfirming(false);
    setDraft(fn);
  };
  const updLine = (id: string, patch: Partial<DraftLine> | ((l: DraftLine) => DraftLine)) =>
    upd((d) => ({
      ...d,
      lines: d.lines.map((l) =>
        l.id === id ? (typeof patch === "function" ? patch(l) : { ...l, ...patch }) : l,
      ),
    }));
  const updCls = (id: string, k: keyof DraftLine["cls"], v: string) =>
    updLine(id, (l) => {
      const cls = { ...l.cls, [k]: v };
      if (k === "div") {
        const t = ctx?.ref.types.find((x) => x.code === cls.type && x.div === v);
        if (!t) cls.type = "";
      }
      if (["div", "type", "mat", "sport"].includes(k)) cls.family = "new";
      if (k === "type") cls.size = "";
      return { ...l, cls };
    });

  // ---------- size × colour entries ----------
  const gridCtx = (cls: DraftLine["cls"]): GridCtx => ({
    unit: ctx?.ref.types.find((x) => x.div === cls.div && x.code === cls.type)?.size_unit ?? "in",
    apparelSizes: ctx?.ref.sizes ?? [],
    finishes: ctx?.ref.finishes ?? [],
    products: ctx?.products ?? [],
  });
  const setGroup = (g: VariantGroup) => upd((d) => applyGroup(d, g, gridCtx(g.cls)));
  const toGroup = (l: DraftLine) =>
    upd((d) => {
      const g = groupFromLine(l, gridCtx(l.cls).unit);
      const marked = {
        ...d,
        lines: d.lines.map((x) => (x.id === l.id ? { ...x, group: g.id } : x)),
      };
      return applyGroup(marked, g, gridCtx(l.cls));
    });

  // ---------- AI / file intake ----------
  function codeLists() {
    const r = ctx!.ref;
    return [
      `DIVISIONS: ${r.divisions.map((d) => `${d.code}=${d.name}`).join(", ")}`,
      `TYPES (div:code=name [size unit]): ${r.types.map((t) => `${t.div}:${t.code}=${t.name} [${t.size_unit}]`).join("; ")}`,
      `MATERIALS: ${r.materials.map((m) => `${m.code}=${m.name}`).join(", ")}`,
      `SPORTS: ${r.sports.map((m) => `${m.code}=${m.name}`).join(", ")}`,
      `FINISHES: ${r.finishes.map((m) => `${m.code}=${m.name}`).join(", ")}`,
      `APPAREL SIZES: ${r.sizes.map((m) => `${m.code}=${m.name}`).join(", ")}`,
      `EXISTING DESIGN NAMES: ${
        (families.data ?? [])
          .map((f) => f.design_name)
          .filter(Boolean)
          .join(", ") || "(none)"
      }`,
    ].join("\n");
  }
  function applyExtract(r: Extracted) {
    const r2 = ctx!.ref;
    const okList = (list: { code: string }[], v?: string) =>
      v && list.some((x) => x.code === v) ? v : "";
    const lines = r.lines
      .filter((x) => x && x.description)
      .map((x) => {
        const t = r2.types.find((tt) => tt.code === x.type && tt.div === x.div);
        const matchP = x.match ? (products.data ?? []).find((p) => p.code === x.match) : undefined;
        return newLine({
          vitem: String(x.vendorItemCode ?? "").trim(),
          desc: String(x.description).trim(),
          billed: String(x.qty ?? 1),
          cost: x.unitCost != null ? String(x.unitCost) : "",
          gst: x.gstRate != null && Number.isFinite(Number(x.gstRate)) ? String(x.gstRate) : "",
          ai: true,
          mode: matchP ? "link" : "new",
          linkId: matchP?.id ?? "",
          ...(matchP ? { suggest: matchP.code } : {}),
          cls: {
            div: okList(r2.divisions, x.div),
            type: t ? t.code : "",
            mat: okList(r2.materials, x.mat),
            sport: okList(r2.sports, x.sport) || "GEN",
            size: x.size ? String(x.size) : "",
            finish: okList(r2.finishes, x.finish) || (t?.is_service ? "NA" : ""),
            family: "new",
            designName: x.designName ?? "",
            description: "",
          },
        });
      });
    // link same-name new lines into one family
    const firstByName = new Map<string, string>();
    for (const l of lines) {
      if (l.mode !== "new" || !l.cls.designName) continue;
      const key = [
        l.cls.div,
        l.cls.type,
        l.cls.mat,
        l.cls.sport,
        l.cls.designName.toLowerCase(),
      ].join("|");
      const fam = (families.data ?? []).find(
        (f) =>
          f.design_name?.toLowerCase() === l.cls.designName.toLowerCase() &&
          f.div === l.cls.div &&
          f.type === l.cls.type &&
          f.mat === l.cls.mat &&
          f.sport === l.cls.sport,
      );
      if (fam) l.cls.family = "f:" + fam.id;
      else if (firstByName.has(key)) l.cls.family = "l:" + firstByName.get(key);
      else firstByName.set(key, l.id);
    }
    upd((d) => {
      const n = { ...d, lines: [...d.lines, ...lines] };
      if (!n.vendorId && (r.vendorName || r.vendorGstin)) {
        const g = (r.vendorGstin ?? "").toUpperCase();
        const nm = (r.vendorName ?? "").toLowerCase();
        const hit = (vendors.data ?? []).find(
          (v) =>
            (g && v.gstin?.toUpperCase() === g) ||
            (nm && v.display_name.toLowerCase().includes(nm)),
        );
        if (hit) n.vendorId = hit.id;
        else {
          n.vendorId = "NEW";
          n.newVendor = { ...blankVendor(), display_name: r.vendorName ?? "", gstin: g };
        }
      }
      if (!n.billNo && r.billNo) n.billNo = String(r.billNo);
      if (r.billDate && /^\d{4}-\d{2}-\d{2}$/.test(r.billDate)) n.billDate = r.billDate;
      return n;
    });
    toast.success(
      `${lines.length} line${lines.length === 1 ? "" : "s"} added — check the details marked "Filled by AI".`,
    );
  }
  async function runAI(input: { text?: string; fileDataUrl?: string }) {
    const existing = (products.data ?? [])
      .slice(0, 400)
      .map((p) => `${p.code} | ${p.friendly_name} | ${p.spec_code}`)
      .join("\n");
    const r = await extractBill({ data: { ...input, codeLists: codeLists(), existing } });
    applyExtract(r);
  }
  async function onFile(file: File | undefined) {
    if (!file || !ctx) return;
    setBusy(`Reading ${file.name}…`);
    try {
      const name = file.name.toLowerCase();
      if (/\.(xlsx|xls|csv)$/.test(name)) {
        const XLSX = await import("xlsx");
        const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
        const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0] ?? ""]!, {
          header: 1,
          raw: false,
          defval: "",
        });
        await runAI({
          text: rows
            .slice(0, 500)
            .map((r) => (r as unknown[]).join(" | "))
            .join("\n"),
        });
      } else if (file.type.startsWith("image/")) {
        await runAI({ fileDataUrl: await blobToDataUrl(await shrinkImage(file, 2000, 0.85)) });
      } else if (name.endsWith(".pdf")) {
        if (file.size > 8_000_000)
          throw new Error("PDF is too large — take a photo of the bill instead.");
        await runAI({ fileDataUrl: await blobToDataUrl(file) });
      } else throw new Error("Use a photo, PDF, Excel or CSV file.");
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy("");
    }
  }

  // ---------- commit ----------
  async function commit() {
    if (!ctx || !ready) return;
    setBusy("Receiving stock…");
    try {
      let vendorId = draft.vendorId;
      if (vendorId === "NEW") {
        const { data, error } = await supabase
          .from("vendors")
          .insert({ ...vendorRow(draft.newVendor), code: "" })
          .select("id")
          .single();
        if (error)
          throw new Error(
            error.message.includes("duplicate")
              ? "A vendor with this name or GSTIN already exists — pick it from the list."
              : error.message,
          );
        vendorId = data.id;
        setDraft((d) => ({ ...d, vendorId: data.id }));
        await inv("vendors");
      }
      const p2 = planDraft({ ...draft, vendorId }, ctx);
      // name unnamed existing families first
      for (const l of draft.lines) {
        const pv = p2[l.id]?.preview;
        if (pv?.renameFamily && pv.familyId && l.cls.designName.trim()) {
          const { error } = await supabase.rpc("rename_family", {
            p_family: pv.familyId,
            p_name: l.cls.designName.trim(),
          });
          if (error) throw new Error(error.message);
        }
      }
      const c2 = billCosts({ ...draft, vendorId }, p2, ctx, supply);
      const lines = draft.lines.map((l, i) => {
        const P = p2[l.id] as LinePlan;
        const cost = num(l.cost);
        const extra = c2.perUnit ? (c2.perUnit[l.id] ?? 0) : null;
        const base = {
          extra_cost: extra,
          gst_rate: draft.type === "bill" ? lineGstRate(l, P, ctx) : null,
          line_no: i + 1,
          received_qty: P.received ?? 0,
          billed_qty: num(l.billed),
          unit_cost: cost,
          vendor_item_code: l.vitem.trim() || null,
          description: l.desc,
          norm_desc: normDesc(l.desc),
          location: l.location.trim() || null,
        };
        if (P.kind !== "new") {
          const prod = prodById.get(P.productId!)!;
          const pr =
            draft.type === "bill" && cost != null
              ? priceFor({ ...prod, unit_cost: cost, extra_cost: extra }, ctx.ref)
              : null;
          return {
            ...base,
            product_id: P.productId,
            prices: pr ? pricePayload(pr) : null,
            vendor_item_code: P.matchBy === "code" ? null : base.vendor_item_code,
          };
        }
        const pv = P.preview!;
        const sameIdx = pv.familyMode === "same" ? pv.sameAs : undefined;
        return {
          ...base,
          new: {
            div: l.cls.div,
            type: l.cls.type,
            mat: l.cls.mat,
            sport: l.cls.sport,
            size: pv.size,
            finish: l.cls.finish,
            design_mode: pv.familyMode,
            family_id: pv.familyMode === "existing" ? pv.familyId : null,
            same_as_line: sameIdx != null ? String(sameIdx) : null,
            design_name: pv.designName,
            internal: pv.familyMode === "new" && l.cls.internal === "1",
            friendly_name: pv.friendly,
            description: l.cls.description.trim() || l.desc,
          },
          prices: pricePayload(pv.price),
        };
      });
      const payload = {
        receipt_type: draft.type,
        vendor_id: vendorId && vendorId !== "NEW" ? vendorId : null,
        bill_no: draft.billNo,
        bill_date: draft.billDate,
        bill_total: num(draft.billTotal),
        charges:
          draft.type === "bill"
            ? (draft.charges ?? [])
                .filter((c) => (num(c.amount) ?? 0) > 0)
                .map((c) => ({ label: c.label, amount: num(c.amount), gst: num(c.gst) ?? 0 }))
            : [],
        goods_value: c2.goods,
        charges_total: c2.charges,
        gst_total: draft.type === "bill" ? c2.gst : null,
        gst_type: draft.type === "bill" ? c2.gstType : null,
        gst_breakup: draft.type === "bill" ? c2.breakup : null,
        total_cost: draft.type === "bill" ? c2.total : null,
        lines,
      };
      const savedDraft = { ...draft, vendorId, reviewOf: undefined, resubmitOf: undefined };
      if (mode === "submit") {
        const { error } = await supabase.rpc("submit_bill", {
          p_payload: payload,
          p_draft: savedDraft,
          p_meta: {
            vendor_name:
              vendors.data?.find((v) => v.id === vendorId)?.display_name ??
              draft.newVendor["display_name"] ??
              null,
            line_count: draft.lines.length,
            units: sum.units,
            value: sum.value,
            new_codes: sum.new,
          },
          ...(draft.resubmitOf ? { p_replaces: draft.resubmitOf } : {}),
        });
        if (error) throw new Error(error.message);
        setDraft(newDraft());
        setConfirming(false);
        await inv("submissions", "families");
        toast.success("Sent for approval. Stock is added once it's approved.");
        return;
      }
      const { data, error } =
        mode === "approve"
          ? await supabase.rpc("approve_bill", {
              p_id: draft.reviewOf!,
              p_payload: payload,
              p_draft: savedDraft,
            })
          : await supabase.rpc("receive_stock", { payload });
      if (error) throw new Error(error.message);
      const res = data as { receipt_id: string; created: Committed["created"] };
      const ids = [
        ...new Set(
          lines.map((l) => ("product_id" in l ? (l.product_id as string) : "")).filter(Boolean),
        ),
        ...res.created.map((c) => c.product_id),
      ];
      setDone({
        receiptId: res.receipt_id,
        created: res.created,
        productIds: ids,
        label: `${RECEIPT_TYPES[draft.type].label} ${draft.billNo}`.trim(),
      });
      setDraft(newDraft());
      setConfirming(false);
      await inv("products", "families", "vendor_codes", "receipts", "counters", "submissions");
      toast.success(
        `${mode === "approve" ? "Approved & received" : "Received"} — ${res.created.length} new code${res.created.length === 1 ? "" : "s"}`,
      );
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy("");
    }
  }

  if (!ctx) return <Empty>Loading…</Empty>;
  const vend = vendors.data ?? [];
  const R = RECEIPT_TYPES[draft.type];
  const shown = draft.lines
    .map((l, i) => [l, i] as const)
    .filter(
      ([l]) =>
        !onlyAttn ||
        plans[l.id]?.errors.length ||
        plans[l.id]?.kind === "new" ||
        (!!l.group &&
          draft.lines.some(
            (x) =>
              x.group === l.group && (plans[x.id]?.errors.length || plans[x.id]?.kind === "new"),
          )),
    );
  const diff =
    num(draft.billTotal) != null
      ? Math.round(((num(draft.billTotal) as number) - sum.value - (costs?.charges ?? 0)) * 100) /
        100
      : null;

  return (
    <>
      <PageHead
        title="Receive stock"
        lede="Record stock arriving at the store. Known items map to your codes automatically; new items get the next code in their series."
      />

      {canContribute && !canPublish && !draft.resubmitOf && (
        <Notice>
          Your bills go for approval before stock is added. You'll see the status below.
        </Notice>
      )}
      {draft.reviewOf && (
        <Notice tone="warn">
          <span className="flex flex-wrap items-center justify-between gap-2">
            <span>
              Reviewing {draft.reviewOfLabel ?? "a submitted bill"}. Fix anything, then{" "}
              <b>Approve & receive</b>.
            </span>
            <Button
              size="sm"
              variant="outline"
              className="rounded-full"
              onClick={() => setDraft(newDraft())}
            >
              Stop reviewing
            </Button>
          </span>
        </Notice>
      )}
      {draft.resubmitOf && (
        <Notice tone="warn">
          <span className="flex flex-wrap items-center justify-between gap-2">
            <span>Fixing a returned bill — submit again when it's right.</span>
            <Button
              size="sm"
              variant="outline"
              className="rounded-full"
              onClick={() => setDraft(newDraft())}
            >
              Cancel
            </Button>
          </span>
        </Notice>
      )}

      <BillApprovals vendors={vend} prodById={prodById} draftBusy={draft.lines.length > 0} />

      {done && (
        <DoneCard
          done={done}
          prodById={prodById}
          photoMap={photoMap}
          thumbOf={thumbOf}
          onClose={() => setDone(null)}
        />
      )}

      <Card>
        <CardTitle>1 · Where is the stock coming from?</CardTitle>
        <div
          className="inline-flex w-fit flex-wrap gap-1 rounded-full border bg-muted p-1"
          role="group"
          aria-label="Receipt type"
        >
          {RECEIVE_CHOICES.map(({ type: k, label }) => (
            <button
              key={k}
              onClick={() => upd((d) => ({ ...d, type: k }))}
              aria-pressed={draft.type === k}
              className={cn(
                "rounded-full px-4 py-2 text-[11.5px] font-bold uppercase tracking-wide text-muted-foreground",
                draft.type === k && "bg-card text-primary shadow-sm",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="text-sm text-muted-foreground">
          {draft.type === "bill"
            ? "Stock bought from a vendor. Cost and preferred vendor update to this bill."
            : "Items already on the shelf that don't have a code yet and no vendor bill. Each line creates a new product code with its stock. For products that already have a code — opening stock, customer returns, recounts — use Products → Adjust stock."}
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[2fr_1fr_1fr_1fr]">
          <Field label={draft.type === "bill" ? "Vendor" : "Vendor (optional)"}>
            <Select
              value={draft.vendorId}
              onChange={(e) => upd((d) => ({ ...d, vendorId: e.target.value }))}
            >
              <option value="">{draft.type === "bill" ? "Select vendor…" : "No vendor"}</option>
              {vend
                .filter((v) => v.status !== "Archived" || v.id === draft.vendorId)
                .map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.code} · {v.display_name}
                  </option>
                ))}
              <option value="NEW">+ New vendor</option>
            </Select>
          </Field>
          <Field label={R.ref}>
            <TextInput
              value={draft.billNo}
              onChange={(e) => upd((d) => ({ ...d, billNo: e.target.value }))}
            />
          </Field>
          <Field label="Date">
            <TextInput
              type="date"
              value={draft.billDate}
              onChange={(e) => upd((d) => ({ ...d, billDate: e.target.value }))}
            />
          </Field>
          {draft.type === "bill" ? (
            <Field label="Bill total before GST ₹" hint="goods + charges, to cross-check">
              <TextInput
                inputMode="decimal"
                placeholder="to cross-check"
                value={draft.billTotal}
                onChange={(e) => upd((d) => ({ ...d, billTotal: e.target.value }))}
              />
            </Field>
          ) : (
            <span />
          )}
        </div>
        {draft.type === "bill" && costs && <BillCharges draft={draft} costs={costs} upd={upd} />}
        {dup && (
          <Notice tone="bad">
            Bill {draft.billNo} from this vendor was already received on{" "}
            {String(dup.created_at).slice(0, 10)}. Receiving it again would double the stock — check
            the bill number, or reverse the earlier receipt first.
          </Notice>
        )}
        {draft.vendorId === "NEW" && (
          <div className="grid gap-3">
            <Notice>
              New vendor — saved when you receive this {draft.type === "bill" ? "bill" : "stock"}.
              Fill the Zoho-required details now.
            </Notice>
            <VendorForm
              idPrefix="nv"
              value={draft.newVendor}
              onChange={(v) => upd((d) => ({ ...d, newVendor: v }))}
            />
          </div>
        )}
      </Card>

      <Card>
        <CardTitle>2 · Add lines</CardTitle>
        <div
          className="grid justify-items-start gap-3 rounded-xl border-2 border-dashed bg-muted/50 p-4"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            onFile(e.dataTransfer.files[0]);
          }}
        >
          <strong className="text-sm">Drop the bill here, take a photo, or choose a file</strong>
          <span className="text-xs text-muted-foreground">
            Photo, PDF, Excel or CSV — AI reads codes, descriptions, quantities and rates before
            GST, and suggests the classification.
          </span>
          <div className="flex w-full flex-wrap gap-2">
            <label
              htmlFor="bill-cam"
              className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-full bg-primary px-4 text-[12px] font-bold uppercase tracking-wide text-primary-foreground md:hidden"
            >
              <Camera className="size-4" /> Photo of bill
            </label>
            <input
              id="bill-cam"
              type="file"
              accept="image/*"
              capture="environment"
              hidden
              onChange={(e) => {
                onFile(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
            <label
              htmlFor="bill-file"
              className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-full border bg-card px-4 text-[12px] font-bold uppercase tracking-wide hover:border-primary md:bg-primary md:text-primary-foreground"
            >
              <FileUp className="size-4" /> Upload file
            </label>
            <input
              id="bill-file"
              type="file"
              accept=".xlsx,.xls,.csv,.pdf,image/*"
              hidden
              onChange={(e) => {
                onFile(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
            <Button
              variant="outline"
              className="h-10 rounded-full text-[12px] font-bold uppercase"
              onClick={() => setPasteOpen((v) => !v)}
            >
              <ClipboardPaste className="size-4" /> Paste text
            </Button>
            <Button
              variant="outline"
              className="h-10 rounded-full text-[12px] font-bold uppercase"
              onClick={() => upd((d) => ({ ...d, lines: [...d.lines, newLine()] }))}
            >
              <Plus className="size-4" /> Add line
            </Button>
            <Button
              variant="outline"
              className="h-10 rounded-full text-[12px] font-bold uppercase"
              onClick={() => setGroup(groupFromLine(newLine(), "in"))}
            >
              <Grid3x3 className="size-4" /> Sizes & colours
            </Button>
          </div>
          {pasteOpen && (
            <div className="grid w-full gap-2">
              <TextArea
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                placeholder="Paste the bill, quotation or WhatsApp message"
              />
              <Button
                size="sm"
                className="w-fit rounded-full"
                disabled={!pasteText.trim() || !!busy}
                onClick={async () => {
                  setBusy("AI is reading the text…");
                  try {
                    await runAI({ text: pasteText });
                    setPasteText("");
                    setPasteOpen(false);
                  } catch (e) {
                    toast.error(errMsg(e));
                  } finally {
                    setBusy("");
                  }
                }}
              >
                <Sparkles className="size-4" /> Extract lines
              </Button>
            </div>
          )}
          {busy && (
            <p role="status" className="text-sm">
              <span className="mr-2 inline-block size-3.5 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-accent align-[-2px]" />
              {busy}
            </p>
          )}
        </div>
      </Card>

      {!draft.lines.length && !Object.keys(draft.grids ?? {}).length ? (
        <Empty>
          {draft.type === "bill"
            ? "No lines yet. Upload the vendor bill above — vendor codes seen before map to your codes instantly."
            : "Add a line for each new item. Products that already have a code are adjusted from Products → Adjust stock."}
        </Empty>
      ) : (
        <Card>
          <CardTitle
            right={
              <div className="flex flex-wrap gap-1.5">
                <Pill tone="ok">{sum.known} known</Pill>
                <Pill tone="info">{sum.link} linked</Pill>
                <Pill tone="brand">{sum.new} new codes</Pill>
                {sum.err ? <Pill tone="warn">{sum.err} need details</Pill> : null}
                {sum.short ? <Pill tone="bad">{sum.short} short</Pill> : null}
              </div>
            }
          >
            3 · Check {draft.lines.length} line{draft.lines.length === 1 ? "" : "s"}
          </CardTitle>
          <div className="inline-flex w-fit flex-wrap gap-1 rounded-full border bg-muted p-1">
            <button
              aria-pressed={!onlyAttn}
              onClick={() => setOnlyAttn(false)}
              className={cn(
                "rounded-full px-3 py-1.5 text-[11px] font-bold uppercase text-muted-foreground",
                !onlyAttn && "bg-card text-primary shadow-sm",
              )}
            >
              All lines
            </button>
            <button
              aria-pressed={onlyAttn}
              onClick={() => setOnlyAttn(true)}
              className={cn(
                "rounded-full px-3 py-1.5 text-[11px] font-bold uppercase text-muted-foreground",
                onlyAttn && "bg-card text-primary shadow-sm",
              )}
            >
              New & needs details ·{" "}
              {
                draft.lines.filter((l) => plans[l.id]?.errors.length || plans[l.id]?.kind === "new")
                  .length
              }
            </button>
          </div>
          {shown.map(([l, i]) => {
            const g = l.group ? draft.grids?.[l.group] : undefined;
            if (g) {
              if (draft.lines.findIndex((x) => x.group === g.id) !== i) return null;
              return (
                <VariantGroupCard
                  key={g.id}
                  g={g}
                  members={draft.lines.filter((x) => x.group === g.id)}
                  plans={plans}
                  ctx={ctx}
                  isBill={draft.type === "bill"}
                  firstNo={i + 1}
                  onChange={setGroup}
                  onRemove={() => upd((d) => removeGroup(d, g.id))}
                />
              );
            }
            return (
              <LineCard
                key={l.id}
                l={l}
                i={i}
                P={plans[l.id] ?? { kind: "new", errors: [], warns: [], received: null }}
                ctx={ctx}
                draft={draft}
                prodById={prodById}
                thumbOf={thumbOf}
                updLine={updLine}
                updCls={updCls}
                upd={upd}
                onGrid={() => toGroup(l)}
              />
            );
          })}
          {Object.values(draft.grids ?? {})
            .filter((g) => !draft.lines.some((x) => x.group === g.id))
            .map((g) => (
              <VariantGroupCard
                key={g.id}
                g={g}
                members={[]}
                plans={plans}
                ctx={ctx}
                isBill={draft.type === "bill"}
                firstNo={draft.lines.length + 1}
                onChange={setGroup}
                onRemove={() => upd((d) => removeGroup(d, g.id))}
              />
            ))}
          {!shown.length && (
            <Empty>
              Every line matches an existing product. Check the totals below and receive.
            </Empty>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              className="w-fit rounded-full"
              onClick={() => upd((d) => ({ ...d, lines: [...d.lines, newLine()] }))}
            >
              <Plus className="size-4" /> Add line
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="w-fit rounded-full"
              onClick={() => setGroup(groupFromLine(newLine(), "in"))}
            >
              <Grid3x3 className="size-4" /> Add sizes & colours entry
            </Button>
          </div>
        </Card>
      )}

      {draft.lines.length > 0 && (
        <div className="panel sticky bottom-[calc(72px+env(safe-area-inset-bottom))] z-20 grid gap-2 p-3 shadow-lg md:bottom-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-4 text-xs">
              <span>
                <b className="block text-base tabular-nums">{sum.units}</b>units in
              </span>
              <span>
                <b className="block text-base tabular-nums">{inr(sum.value)}</b>goods before GST
              </span>
              {draft.type === "bill" && costs && (
                <span>
                  <b className="block text-base tabular-nums">{inr(costs.total)}</b>cost to company
                </span>
              )}
              <span className="hidden sm:inline">
                <b className="block text-base tabular-nums">{sum.new}</b>new codes
              </span>
              {diff != null &&
                (Math.abs(diff) <= 1 ? (
                  <Pill tone="ok">matches bill total</Pill>
                ) : (
                  <Pill tone="warn">
                    {inr(Math.abs(diff))} {diff > 0 ? "less than" : "more than"} bill total
                  </Pill>
                ))}
              {sum.warn ? <Pill tone="warn">{sum.warn} to check</Pill> : null}
            </div>
            <div className="flex flex-1 justify-end gap-2 sm:flex-none">
              <Button
                variant="ghost"
                className="rounded-full"
                onClick={() => {
                  if (confirm("Discard this draft?")) {
                    setDraft(newDraft());
                    setConfirming(false);
                  }
                }}
              >
                Discard
              </Button>
              {confirming ? (
                <>
                  <Button
                    variant="outline"
                    className="rounded-full"
                    onClick={() => setConfirming(false)}
                  >
                    Back
                  </Button>
                  <Button
                    className="flex-1 rounded-full font-bold uppercase sm:flex-none"
                    disabled={!ready}
                    onClick={commit}
                  >
                    {mode === "submit"
                      ? "Submit for approval"
                      : mode === "approve"
                        ? "Approve & receive"
                        : "Confirm receive"}
                  </Button>
                </>
              ) : (
                <Button
                  className="flex-1 rounded-full font-bold uppercase sm:flex-none"
                  disabled={!ready}
                  onClick={() => setConfirming(true)}
                >
                  {mode === "submit" ? "Review & submit" : "Review & receive"}
                </Button>
              )}
            </div>
          </div>
          {!ready && !busy && (
            <p className="text-sm text-warning-foreground dark:text-warning">
              {vendorProblem ||
                (sum.err
                  ? `${sum.err} line${sum.err === 1 ? "" : "s"} need details — use the filter above to find them.`
                  : !canContribute
                    ? "You have view-only access."
                    : "")}
            </p>
          )}
          {confirming && ready && (
            <Notice>
              {mode === "submit"
                ? "This goes for approval first. Nothing changes in stock until it's approved. Once approved, it "
                : "This "}
              will create {sum.new} new product code{sum.new === 1 ? "" : "s"}, add {sum.units}{" "}
              units across {sum.lines} line{sum.lines === 1 ? "" : "s"}
              {draft.type === "bill"
                ? ", update cost, price and preferred vendor on known items"
                : ""}
              , and remember this vendor's codes for next time. Codes are never reused once issued.
            </Notice>
          )}
          {confirming && ready && draft.type === "bill" && costs && <CostBreakdown costs={costs} />}
        </div>
      )}

      <RecentReceipts
        canReverse={canPublish}
        vendors={vend}
        prodById={prodById}
        isEditor={canEdit}
      />
    </>
  );
}

function LineCard({
  l,
  i,
  P,
  ctx,
  draft,
  prodById,
  thumbOf,
  updLine,
  updCls,
  upd,
  onGrid,
}: {
  l: DraftLine;
  i: number;
  P: LinePlan;
  ctx: PlanCtx;
  draft: Draft;
  prodById: Map<string, Product>;
  thumbOf: (id: string) => string | undefined;
  updLine: (id: string, patch: Partial<DraftLine> | ((l: DraftLine) => DraftLine)) => void;
  updCls: (id: string, k: keyof DraftLine["cls"], v: string) => void;
  upd: (fn: (d: Draft) => Draft) => void;
  onGrid: () => void;
}) {
  const { ref } = ctx;
  const c = l.cls;
  const isBill = draft.type === "bill";
  const extra = chargeAllocation(draft).perUnit?.[l.id] ?? null;
  const border = P.errors.length
    ? "border-l-warning"
    : P.kind === "known"
      ? "border-l-success"
      : P.kind === "link"
        ? "border-l-primary"
        : "border-l-accent";
  const prod = P.productId ? prodById.get(P.productId) : undefined;
  const types = ref.types.filter((t) => !c.div || t.div === c.div);
  const t = ref.types.find((x) => x.div === c.div && x.code === c.type);
  const famKey = [c.div, c.type, c.mat, c.sport].join("-");
  const fams =
    c.div && c.type && c.mat && c.sport
      ? ctx.families.filter((f) => [f.div, f.type, f.mat, f.sport].join("-") === famKey)
      : [];
  const earlier = draft.lines
    .slice(0, i)
    .filter(
      (o) =>
        o.mode === "new" &&
        !o.unmap &&
        o.cls.family === "new" &&
        [o.cls.div, o.cls.type, o.cls.mat, o.cls.sport].join("-") === famKey,
    );
  const [linkQ, setLinkQ] = useState(prod ? `${prod.code} · ${prod.friendly_name}` : "");
  const received = l.received.trim() === "" ? num(l.billed) : num(l.received);
  const billed = num(l.billed);
  return (
    <div className={cn("grid gap-3 rounded-xl border border-l-4 bg-card p-3", border)}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="code-tag text-xs text-muted-foreground">#{i + 1}</span>
        {P.kind === "known" ? (
          <Pill tone="ok">Known</Pill>
        ) : P.kind === "link" ? (
          <Pill tone="info">Link</Pill>
        ) : (
          <Pill tone="brand">New</Pill>
        )}
        {l.ai && P.kind !== "known" && <Pill>Filled by AI · check</Pill>}
        <button
          className="ml-auto rounded-full p-2 text-muted-foreground hover:bg-muted"
          aria-label={`Remove line ${i + 1}`}
          title="Remove line"
          onClick={() =>
            upd((d) => ({
              ...d,
              lines: d.lines
                .filter((x) => x.id !== l.id)
                .map((x) =>
                  x.cls.family === "l:" + l.id ? { ...x, cls: { ...x.cls, family: "new" } } : x,
                ),
            }))
          }
        >
          <Trash2 className="size-4" />
        </button>
      </div>
      <div
        className={cn(
          "grid grid-cols-2 gap-3",
          isBill
            ? "sm:grid-cols-[1fr_2fr_80px_80px_100px_76px]"
            : "sm:grid-cols-[1fr_2fr_90px_90px_110px]",
        )}
      >
        <Field label={isBill ? "Vendor code" : "Code"} className="col-span-2 sm:col-span-1">
          <TextInput
            value={l.vitem}
            placeholder={isBill ? "their item code" : "TC-1001"}
            onChange={(e) => updLine(l.id, { vitem: e.target.value, unmap: false })}
          />
        </Field>
        <Field label="Description" className="col-span-2 sm:col-span-1">
          <TextInput value={l.desc} onChange={(e) => updLine(l.id, { desc: e.target.value })} />
        </Field>
        <Field label={isBill ? "Billed" : "Qty"}>
          <TextInput
            inputMode="numeric"
            value={l.billed}
            onChange={(e) => updLine(l.id, { billed: e.target.value })}
          />
        </Field>
        {isBill ? (
          <Field label="Received">
            <TextInput
              inputMode="numeric"
              value={l.received}
              placeholder={l.billed}
              onChange={(e) => updLine(l.id, { received: e.target.value })}
            />
          </Field>
        ) : (
          <span className="hidden sm:block" />
        )}
        <Field label="Unit cost ₹">
          <TextInput
            inputMode="decimal"
            value={l.cost}
            placeholder={P.kind !== "new" && !isBill ? "optional" : ""}
            onChange={(e) => updLine(l.id, { cost: e.target.value })}
          />
        </Field>
        {isBill && (
          <Field label="GST %">
            <TextInput
              inputMode="decimal"
              list="gst-rates"
              value={l.gst ?? ""}
              placeholder={String(lineGstRate(l, P, ctx))}
              onChange={(e) => updLine(l.id, { gst: e.target.value })}
            />
          </Field>
        )}
      </div>
      {received != null && billed != null && received < billed && (
        <p className="text-sm text-destructive">
          Short by {billed - received} — only received units are added to stock. Raise it with the
          vendor.
        </p>
      )}
      {P.warns.length > 0 && (
        <p className="text-sm text-warning-foreground dark:text-warning">
          Check: {P.warns.join("; ")}
        </p>
      )}
      {l.unmap && (
        <p className="text-sm text-muted-foreground">
          Unlinked for this receipt — pick the right product below; the vendor code will map to it
          from now on.{" "}
          <button
            className="font-semibold text-primary"
            onClick={() => updLine(l.id, { unmap: false, mode: "new" })}
          >
            <Undo2 className="inline size-3.5" /> Undo
          </button>
        </p>
      )}

      {P.kind === "known" && prod && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg bg-muted p-2.5">
          <Thumb url={thumbOf(prod.id)} label={prod.code} />
          <Code>{prod.code}</Code>
          <span className="wrap-any text-sm">{prod.friendly_name}</span>
          <span className="text-xs text-muted-foreground">
            stock {prod.stock} → {prod.stock + (P.received ?? 0)}
          </span>
          {P.matchBy === "code" && <Pill>by product code</Pill>}
          {isBill && extra != null && num(l.cost) != null && (
            <Pill tone="info">
              landed {inr((num(l.cost) ?? 0) + extra)} incl. {inr(extra)} charges
            </Pill>
          )}
          {isBill &&
            num(l.cost) != null &&
            prod.unit_cost != null &&
            (num(l.cost) !== prod.unit_cost || extra != null) &&
            (() => {
              const np = priceFor({ ...prod, unit_cost: num(l.cost), extra_cost: extra }, ref);
              return (
                <Pill tone="warn">
                  cost {inr(prod.unit_cost)} → {inr(num(l.cost))} · price {inr(prod.mrp)} →{" "}
                  {inr(np?.mrp)}
                </Pill>
              );
            })()}
          <button
            className="ml-auto text-xs font-semibold text-muted-foreground underline-offset-4 hover:underline"
            onClick={() => updLine(l.id, { unmap: true, mode: "link", linkId: "" })}
          >
            Not this product?
          </button>
        </div>
      )}

      {P.kind !== "known" && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant={l.mode === "new" ? "default" : "outline"}
              className="rounded-full"
              onClick={() => updLine(l.id, { mode: "new" })}
            >
              New product
            </Button>
            <Button
              size="sm"
              variant={l.mode === "link" ? "default" : "outline"}
              className="rounded-full"
              onClick={() => updLine(l.id, { mode: "link" })}
            >
              Same as an existing product
            </Button>
            {l.suggest && (
              <span className="text-xs text-muted-foreground">
                AI suggests <Code>{l.suggest}</Code>
              </span>
            )}
          </div>
          {l.mode === "link" ? (
            <div className="grid gap-2">
              <Field label="Link to product — type a code or name">
                <TextInput
                  list={`dl-${l.id}`}
                  value={linkQ}
                  placeholder="e.g. TC-1001 or Champion"
                  onChange={(e) => {
                    setLinkQ(e.target.value);
                    const code = (e.target.value.split(" ")[0] ?? "").trim().toUpperCase();
                    const p = ctx.products.find((x) => x.code === code);
                    updLine(l.id, { linkId: p?.id ?? "" });
                  }}
                />
                <datalist id={`dl-${l.id}`}>
                  {ctx.products
                    .filter((p) => p.status !== "Discontinued" && p.status !== "Archived")
                    .map((p) => (
                      <option key={p.id} value={`${p.code} · ${p.friendly_name}`} />
                    ))}
                </datalist>
              </Field>
              {prod && (
                <div className="flex flex-wrap items-center gap-3 rounded-lg bg-muted p-2.5">
                  <Thumb url={thumbOf(prod.id)} label={prod.code} />
                  <Code>{prod.code}</Code>
                  <span className="wrap-any text-sm">{prod.friendly_name}</span>
                  <span className="text-xs text-muted-foreground">
                    this vendor's code will map here from now on
                  </span>
                </div>
              )}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Field label="Division">
                  <Select value={c.div} onChange={(e) => updCls(l.id, "div", e.target.value)}>
                    <option value="">—</option>
                    {ref.divisions.map((d) => (
                      <option key={d.code} value={d.code}>
                        {d.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Type">
                  <Select value={c.type} onChange={(e) => updCls(l.id, "type", e.target.value)}>
                    <option value="">—</option>
                    {types.map((x) => (
                      <option key={x.id} value={x.code}>
                        {x.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Material">
                  <Select value={c.mat} onChange={(e) => updCls(l.id, "mat", e.target.value)}>
                    <option value="">—</option>
                    {ref.materials.map((m) => (
                      <option key={m.code} value={m.code}>
                        {m.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Sport">
                  <Select value={c.sport} onChange={(e) => updCls(l.id, "sport", e.target.value)}>
                    {ref.sports.map((m) => (
                      <option key={m.code} value={m.code}>
                        {m.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                {t?.size_unit !== "none" &&
                  (t?.size_unit === "size" ? (
                    <Field label="Size">
                      <Select value={c.size} onChange={(e) => updCls(l.id, "size", e.target.value)}>
                        <option value="">—</option>
                        {ref.sizes.map((m) => (
                          <option key={m.code} value={m.code}>
                            {m.name}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  ) : (
                    <Field label={`Size${t ? ` (${t.size_unit})` : ""}`}>
                      <TextInput
                        inputMode="decimal"
                        value={c.size}
                        onChange={(e) => updCls(l.id, "size", e.target.value)}
                      />
                    </Field>
                  ))}
                <Field label="Finish / colour">
                  <Select value={c.finish} onChange={(e) => updCls(l.id, "finish", e.target.value)}>
                    <option value="">—</option>
                    {ref.finishes.map((m) => (
                      <option key={m.code} value={m.code}>
                        {m.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Design family">
                  <Select value={c.family} onChange={(e) => updCls(l.id, "family", e.target.value)}>
                    <option value="new">New design</option>
                    {fams.map((f) => (
                      <option key={f.id} value={`f:${f.id}`}>
                        Design {String(f.design_no).padStart(3, "0")} · {f.design_name || "unnamed"}
                      </option>
                    ))}
                    {earlier.map((o) => (
                      <option key={o.id} value={`l:${o.id}`}>
                        Same new design as line #{draft.lines.indexOf(o) + 1}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Design name">
                  <TextInput
                    value={
                      c.family.startsWith("l:")
                        ? ""
                        : c.family.startsWith("f:") &&
                            fams.find((f) => "f:" + f.id === c.family)?.design_name
                          ? fams.find((f) => "f:" + f.id === c.family)!.design_name!
                          : c.designName
                    }
                    disabled={
                      c.family.startsWith("l:") ||
                      (c.family.startsWith("f:") &&
                        !!fams.find((f) => "f:" + f.id === c.family)?.design_name)
                    }
                    placeholder={c.family === "new" ? "e.g. Champion Cup" : "inherits family name"}
                    onChange={(e) => updCls(l.id, "designName", e.target.value)}
                  />
                </Field>
                {c.family === "new" ? (
                  <Field label="Catalogue">
                    <Select
                      value={c.internal === "1" ? "1" : ""}
                      onChange={(e) => updCls(l.id, "internal", e.target.value)}
                    >
                      <option value="">Show on catalogue</option>
                      <option value="1">Internal only (marketing, staff use)</option>
                    </Select>
                  </Field>
                ) : c.family.startsWith("f:") &&
                  fams.find((f) => "f:" + f.id === c.family)?.internal ? (
                  <Field label="Catalogue">
                    <span className="flex h-10 items-center text-sm text-muted-foreground">
                      Internal only
                    </span>
                  </Field>
                ) : null}
                <Field label="Shelf location">
                  <TextInput
                    value={l.location}
                    placeholder="e.g. A1-03"
                    onChange={(e) => updLine(l.id, { location: e.target.value })}
                  />
                </Field>
                <Field label="Customer description" className="col-span-2 sm:col-span-3">
                  <TextInput
                    value={c.description}
                    placeholder="Shown in the catalogue (optional)"
                    onChange={(e) => updCls(l.id, "description", e.target.value)}
                  />
                </Field>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-full"
                  onClick={() =>
                    upd((d) => {
                      const idx = d.lines.findIndex((x) => x.id === l.id);
                      const fam = l.cls.family === "new" ? "l:" + l.id : l.cls.family;
                      const nl = newLine({
                        desc: l.desc,
                        cost: l.cost,
                        location: l.location,
                        cls: { ...l.cls, size: "", designName: "", family: fam },
                      });
                      const lines = [...d.lines];
                      lines.splice(idx + 1, 0, nl);
                      return { ...d, lines };
                    })
                  }
                >
                  <Plus className="size-4" /> Another size / finish of this design
                </Button>
                <Button size="sm" className="rounded-full" onClick={onGrid}>
                  <Grid3x3 className="size-4" /> Several sizes / colours — one entry
                </Button>
              </div>
              {P.errors.length > 0 ? (
                <div className="grid gap-2">
                  <p className="text-sm text-warning-foreground dark:text-warning">
                    Needs: {P.errors.join("; ")}
                  </p>
                  {P.twin && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="w-fit rounded-full"
                      onClick={() => updLine(l.id, { mode: "link", linkId: P.twin! })}
                    >
                      Link to {prodById.get(P.twin)?.code} instead
                    </Button>
                  )}
                </div>
              ) : P.preview ? (
                <div className="flex flex-wrap items-center gap-2 rounded-lg bg-accent/10 p-2.5">
                  <Pill tone="brand">{P.preview.newSize ? "New size of" : "Will create"}</Pill>
                  <Code>{P.preview.base}</Code>
                  <span className="text-xs text-muted-foreground">SKU {P.preview.code}</span>
                  <strong className="wrap-any text-sm">{P.preview.friendly}</strong>
                  <span className="text-xs text-muted-foreground">
                    landed {inr(P.preview.price.landed)}
                    {extra != null ? ` incl. ${inr(extra)} charges` : ""} · price{" "}
                    {inr(P.preview.price.mrp)} · {P.preview.price.rule}
                  </span>
                </div>
              ) : null}
            </>
          )}
          {l.mode === "link" && P.errors.length > 0 && (
            <p className="text-sm text-warning-foreground dark:text-warning">
              Needs: {P.errors.join("; ")}
            </p>
          )}
        </>
      )}
    </div>
  );
}

function DoneCard({
  done,
  prodById,
  photoMap,
  thumbOf,
  onClose,
}: {
  done: Committed;
  prodById: Map<string, Product>;
  photoMap: Map<string, { id: string }[]>;
  thumbOf: (id: string) => string | undefined;
  onClose: () => void;
}) {
  const ref = useRefData();
  const fams = useFamilies();
  const items = done.productIds.map((id) => prodById.get(id)).filter(Boolean) as Product[];
  const physical = items.filter(
    (p) => !ref.data?.types.find((t) => t.div === p.div && t.code === p.type)?.is_service,
  );
  const need = physical.filter((p) => !photoMap.get(p.id)?.length);
  async function labels() {
    const XLSX = await import("xlsx");
    const rec = new Map(done.created.map((c) => [c.product_id, c.qty]));
    const rows = [
      [
        "Product code",
        "Size",
        "Name",
        "Price",
        "Labels to print",
        "Location",
        "SKU (barcode, Code 128)",
      ],
    ];
    for (const p of physical)
      rows.push([
        designCode(p, fams.data ?? []),
        variantLabel(p, ref.data),
        p.friendly_name,
        String(p.mrp ?? ""),
        String(rec.get(p.id) ?? ""),
        p.location ?? "",
        p.code,
      ]);
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"] = [
      { wch: 12 },
      { wch: 10 },
      { wch: 40 },
      { wch: 10 },
      { wch: 14 },
      { wch: 14 },
      { wch: 20 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Labels");
    XLSX.writeFile(wb, `Labels_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }
  return (
    <Card className="border-success">
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone="ok">Received</Pill>
        <strong>{done.label}</strong>
      </div>
      <p className="text-sm">
        {done.created.length} new code{done.created.length === 1 ? "" : "s"}
        {done.created.length ? ": " : ""}
        {done.created.map((c) => c.code).join(", ")}
        <span className="block text-xs text-muted-foreground">
          Tag each piece with its product code and size — one code covers every size of a design.
        </span>
      </p>
      <p className="text-sm text-muted-foreground">
        Next: photograph new products, tag the stock with its code and price, shelve it, then export
        to Zoho.
      </p>
      {physical.length > 0 && (
        <div className="grid gap-2">
          <h3 className="text-sm font-bold">
            Product photos{" "}
            {need.length ? (
              <Pill tone="warn">{need.length} without photo</Pill>
            ) : (
              <Pill tone="ok">all done</Pill>
            )}
          </h3>
          {physical.map((p) => (
            <div key={p.id} className="flex flex-wrap items-center gap-3 rounded-lg bg-muted p-2.5">
              <Thumb url={thumbOf(p.id)} label={p.code} className="size-12" />
              <Code>{p.code}</Code>
              <span className="wrap-any min-w-0 flex-1 text-sm">{p.friendly_name}</span>
              <PhotoButtons productId={p.id} count={photoMap.get(p.id)?.length ?? 0} />
            </div>
          ))}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" className="rounded-full" onClick={labels}>
          <Download className="size-4" /> Label sheet
        </Button>
        <Button size="sm" variant="outline" className="rounded-full" asChild>
          <Link to="/export">Export to Zoho</Link>
        </Button>
        <Button size="sm" variant="ghost" className="rounded-full" onClick={onClose}>
          Done
        </Button>
      </div>
    </Card>
  );
}

function RecentReceipts({
  canReverse,
  vendors,
  prodById,
}: {
  canReverse: boolean;
  vendors: { id: string; display_name: string }[];
  prodById: Map<string, Product>;
  isEditor: boolean;
}) {
  const q = useReceipts();
  const inv = useInvalidate();
  const [open, setOpen] = useState<string | null>(null);
  const [confirmRev, setConfirmRev] = useState<string | null>(null);
  const list = q.data ?? [];
  if (!list.length) return null;
  async function reverse(id: string) {
    if (confirmRev !== id) {
      setConfirmRev(id);
      return;
    }
    setConfirmRev(null);
    const { error } = await supabase.rpc("reverse_receipt", { p_receipt: id });
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Receipt reversed");
    inv("receipts", "products");
  }
  return (
    <Card>
      <CardTitle
        right={
          <Link to="/bills" className="text-xs font-bold uppercase text-primary hover:underline">
            All bills →
          </Link>
        }
      >
        Recent receipts
      </CardTitle>
      <div className="grid gap-2">
        {list.slice(0, 15).map((r) => {
          const units = r.lines.reduce((a, l) => a + l.received_qty, 0);
          const short = r.lines.some(
            (l) => l.billed_qty != null && l.received_qty < Number(l.billed_qty),
          );
          const isOpen = open === r.id;
          return (
            <div
              key={r.id}
              className={cn("overflow-hidden rounded-xl border", isOpen && "border-accent")}
            >
              <button
                className="grid w-full gap-1 p-3 text-left"
                onClick={() => setOpen(isOpen ? null : r.id)}
                aria-expanded={isOpen}
              >
                <span className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span>
                    {String(r.bill_date ?? r.created_at).slice(0, 10)} ·{" "}
                    {RECEIPT_TYPES[r.receipt_type as ReceiptType]?.label ?? r.receipt_type}
                  </span>
                  {r.reversed_at ? (
                    <Pill tone="bad">reversed</Pill>
                  ) : short ? (
                    <Pill tone="bad">short</Pill>
                  ) : null}
                </span>
                <strong className="wrap-any text-sm">
                  {vendors.find((v) => v.id === r.vendor_id)?.display_name ?? "No vendor"}
                </strong>
                <span className="wrap-any text-xs text-muted-foreground">
                  {r.bill_no ? `${r.bill_no} · ` : ""}
                  {r.lines.length} lines · {units} units ·{" "}
                  {r.lines.filter((l) => l.created_new).length} new · by {r.created_by_email ?? "—"}
                  {r.approved_by_email ? ` · approved by ${r.approved_by_email}` : ""}
                </span>
              </button>
              {isOpen && (
                <div className="grid gap-2 border-t p-3">
                  {r.lines.map((l) => {
                    const p = l.product_id ? prodById.get(l.product_id) : undefined;
                    return (
                      <div key={l.id} className="flex items-center gap-3 text-sm">
                        <Code>{p?.code ?? "—"}</Code>
                        <span className="wrap-any min-w-0 flex-1">
                          {p?.friendly_name ?? l.description}
                        </span>
                        <span className="whitespace-nowrap text-xs">
                          {l.received_qty} in
                          {l.billed_qty != null && l.received_qty < Number(l.billed_qty) ? (
                            <span className="text-destructive"> of {Number(l.billed_qty)}</span>
                          ) : null}
                        </span>
                      </div>
                    );
                  })}
                  {r.reversed_at ? (
                    <p className="text-xs text-muted-foreground">
                      Reversed {String(r.reversed_at).slice(0, 10)} by {r.reversed_by_email ?? "—"}
                    </p>
                  ) : canReverse ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="w-fit rounded-full"
                      onClick={() => reverse(r.id)}
                    >
                      {confirmRev === r.id
                        ? "Click again — removes this receipt's stock"
                        : "Reverse this receipt"}
                    </Button>
                  ) : null}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

type PayloadLine = {
  product_id?: string;
  description?: string;
  received_qty?: number;
  billed_qty?: number | null;
  unit_cost?: number | null;
  new?: { friendly_name?: string };
};

function BillApprovals({
  vendors,
  prodById,
  draftBusy,
}: {
  vendors: { id: string; display_name: string }[];
  prodById: Map<string, Product>;
  draftBusy: boolean;
}) {
  const { canApprove, canContribute, userId } = useAuth();
  const q = useSubmissions(canContribute);
  const inv = useInvalidate();
  const [open, setOpen] = useState<string | null>(null);
  const [sure, setSure] = useState<string | null>(null);
  const [returning, setReturning] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState("");
  const all = q.data ?? [];
  const list = canApprove
    ? all.filter((s) => s.status === "pending")
    : all.filter(
        (s) =>
          s.submitted_by === userId &&
          s.status !== "withdrawn" &&
          (s.status !== "approved" || isRecent(s.reviewed_at)),
      );
  const recent = canApprove
    ? all.filter((s) => s.status === "approved" || s.status === "rejected").slice(0, 5)
    : [];
  if (!list.length && !recent.length) return null;

  const vName = (s: Submission) =>
    vendors.find((v) => v.id === s.vendor_id)?.display_name ?? s.vendor_name ?? "No vendor";
  const label = (s: Submission) =>
    `${vName(s)}${s.bill_no ? ` · ${s.bill_no}` : ""} from ${s.submitted_by_email ?? "—"}`;

  function load(s: Submission, as: "review" | "fix") {
    if (draftBusy && !confirm("Replace the bill you're working on with this one?")) return;
    const d = s.draft as unknown as Draft;
    setDraft({
      ...newDraft(),
      ...d,
      reviewOf: as === "review" ? s.id : undefined,
      reviewOfLabel: as === "review" ? label(s) : undefined,
      resubmitOf: as === "fix" ? s.id : undefined,
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  async function run(
    key: string,
    fn: () => PromiseLike<{ error: { message: string } | null }>,
    ok: string,
  ) {
    setBusy(key);
    const { error } = await fn();
    setBusy("");
    if (error) {
      toast.error(error.message);
      return false;
    }
    toast.success(ok);
    await inv("submissions", "products", "receipts", "families", "vendor_codes", "counters");
    return true;
  }
  async function approve(s: Submission) {
    if (sure !== s.id) {
      setSure(s.id);
      return;
    }
    setSure(null);
    await run(s.id, () => supabase.rpc("approve_bill", { p_id: s.id }), "Approved — stock added");
  }
  async function sendBack(s: Submission) {
    if (!note.trim()) {
      toast.error("Say what needs fixing");
      return;
    }
    if (
      await run(
        s.id,
        () => supabase.rpc("reject_bill", { p_id: s.id, p_note: note.trim() }),
        "Sent back with your note",
      )
    ) {
      setReturning(null);
      setNote("");
    }
  }

  const row = (s: Submission, actions: boolean) => {
    const isOpen = open === s.id;
    const lines = ((s.payload as { lines?: PayloadLine[] }).lines ?? []) as PayloadLine[];
    return (
      <div
        key={s.id}
        className={cn("overflow-hidden rounded-xl border", isOpen && "border-accent")}
      >
        <button
          className="grid w-full gap-1 p-3 text-left"
          onClick={() => setOpen(isOpen ? null : s.id)}
          aria-expanded={isOpen}
        >
          <span className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>
              {String(s.bill_date ?? s.created_at).slice(0, 10)} ·{" "}
              {RECEIPT_TYPES[s.receipt_type as ReceiptType]?.label ?? s.receipt_type}
            </span>
            <SubmissionPill s={s.status} />
          </span>
          <strong className="wrap-any text-sm">
            {vName(s)}
            {s.bill_no ? ` · ${s.bill_no}` : ""}
          </strong>
          <span className="wrap-any text-xs text-muted-foreground">
            {s.line_count ?? lines.length} lines · {s.units ?? "—"} units · {inr(s.value)} ·{" "}
            {s.new_codes ?? 0} new · by {s.submitted_by_email ?? "—"}
            {s.reviewed_by_email && s.status !== "withdrawn"
              ? ` · ${s.status} by ${s.reviewed_by_email}`
              : ""}
          </span>
          {s.status === "rejected" && s.review_note && (
            <span className="wrap-any rounded-lg bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive">
              {s.review_note}
            </span>
          )}
        </button>
        {isOpen && (
          <div className="grid gap-2 border-t p-3">
            {lines.map((l, i) => {
              const p = l.product_id ? prodById.get(l.product_id) : undefined;
              return (
                <div key={i} className="flex items-center gap-3 text-sm">
                  {p ? <Code>{p.code}</Code> : <Pill tone="info">new</Pill>}
                  <span className="wrap-any min-w-0 flex-1">
                    {p?.friendly_name ?? l.new?.friendly_name ?? l.description}
                  </span>
                  <span className="whitespace-nowrap text-xs tabular-nums">
                    {l.received_qty ?? 0} × {inr(l.unit_cost)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
        {actions && (
          <div className="flex flex-wrap gap-2 border-t bg-muted/40 p-2.5">
            {canApprove && s.status === "pending" && (
              <>
                <Button
                  size="sm"
                  className="rounded-full"
                  disabled={!!busy}
                  onClick={() => approve(s)}
                >
                  {busy === s.id ? "Working…" : sure === s.id ? "Tap again to approve" : "Approve"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-full"
                  disabled={!!busy}
                  onClick={() => load(s, "review")}
                >
                  Edit, then approve
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="rounded-full"
                  disabled={!!busy}
                  onClick={() => {
                    setReturning(returning === s.id ? null : s.id);
                    setNote("");
                  }}
                >
                  Send back
                </Button>
              </>
            )}
            {!canApprove && s.submitted_by === userId && s.status === "rejected" && (
              <Button size="sm" className="rounded-full" onClick={() => load(s, "fix")}>
                Fix & resubmit
              </Button>
            )}
            {s.submitted_by === userId && (s.status === "pending" || s.status === "rejected") && (
              <Button
                size="sm"
                variant="ghost"
                className="rounded-full"
                disabled={!!busy}
                onClick={() =>
                  run(s.id, () => supabase.rpc("withdraw_bill", { p_id: s.id }), "Withdrawn")
                }
              >
                Withdraw
              </Button>
            )}
            {returning === s.id && (
              <div className="grid w-full gap-2">
                <TextArea
                  className="min-h-16 font-sans"
                  placeholder="What needs fixing? e.g. Line 3 cost should be ₹420"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
                <Button
                  size="sm"
                  variant="destructive"
                  className="w-fit rounded-full"
                  disabled={!!busy}
                  onClick={() => sendBack(s)}
                >
                  Send back with note
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <Card className={cn(canApprove && list.length > 0 && "border-warning")}>
      <CardTitle right={list.length ? <Pill tone="warn">{list.length}</Pill> : null}>
        {canApprove ? "Bills waiting for approval" : "My submitted bills"}
      </CardTitle>
      {list.length ? (
        <div className="grid gap-2">{list.map((s) => row(s, true))}</div>
      ) : (
        <p className="text-sm text-muted-foreground">Nothing waiting.</p>
      )}
      {recent.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground">Recently reviewed</summary>
          <div className="mt-2 grid gap-2">{recent.map((s) => row(s, false))}</div>
        </details>
      )}
    </Card>
  );
}

function isRecent(ts: string | null) {
  return !!ts && Date.now() - new Date(ts).getTime() < 3 * 86_400_000;
}

function SubmissionPill({ s }: { s: string }) {
  const map: Record<string, ["ok" | "warn" | "bad" | "mute", string]> = {
    pending: ["warn", "waiting"],
    approved: ["ok", "approved"],
    rejected: ["bad", "sent back"],
    withdrawn: ["mute", "withdrawn"],
  };
  const [tone, text] = map[s] ?? ["mute", s];
  return <Pill tone={tone}>{text}</Pill>;
}

type Costs = ReturnType<typeof billCosts>;

/** Shipping, packaging and other bill charges. They are spread over the lines by value and become
 *  part of each unit's landed cost. */
function BillCharges({
  draft,
  costs,
  upd,
}: {
  draft: Draft;
  costs: Costs;
  upd: (fn: (d: Draft) => Draft) => void;
}) {
  const charges = draft.charges ?? [];
  const set = (id: string, patch: Partial<Draft["charges"][number]>) =>
    upd((d) => ({
      ...d,
      charges: (d.charges ?? []).map((c) => (c.id === id ? { ...c, ...patch } : c)),
    }));
  const add = () =>
    upd((d) => ({
      ...d,
      charges: [
        ...(d.charges ?? []),
        {
          id: Math.random().toString(36).slice(2, 10),
          label: (d.charges ?? []).length ? "Packaging" : "Shipping / freight",
          amount: "",
          gst: "18",
        },
      ],
    }));
  return (
    <div className="grid gap-2 rounded-xl border bg-muted/30 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-bold">Other charges on this bill</span>
        <Button size="sm" variant="outline" className="rounded-full" onClick={add}>
          <Plus className="size-4" /> Add charge
        </Button>
      </div>
      {charges.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Shipping, packaging, loading or other costs on the bill. Add them and they're spread
          across the items by value, so each item's landed cost is what it really cost you. Without
          charges, the division's estimated freight and packaging are used.
        </p>
      ) : (
        <div className="grid gap-2">
          {charges.map((c) => (
            <div key={c.id} className="grid grid-cols-[1fr_110px_76px_auto] items-end gap-2">
              <Field label="Charge">
                <Select value={c.label} onChange={(e) => set(c.id, { label: e.target.value })}>
                  {CHARGE_LABELS.map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </Select>
              </Field>
              <Field label="₹ before GST">
                <TextInput
                  inputMode="decimal"
                  value={c.amount}
                  placeholder="0"
                  onChange={(e) => set(c.id, { amount: e.target.value })}
                />
              </Field>
              <Field label="GST %">
                <TextInput
                  inputMode="decimal"
                  value={c.gst}
                  onChange={(e) => set(c.id, { gst: e.target.value })}
                />
              </Field>
              <Button
                size="icon"
                variant="ghost"
                className="mb-0.5 rounded-full"
                title="Remove charge"
                onClick={() =>
                  upd((d) => ({ ...d, charges: (d.charges ?? []).filter((x) => x.id !== c.id) }))
                }
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
          {costs.charges > 0 && !costs.perUnit && (
            <p className="text-xs text-warning-foreground dark:text-warning">
              Add item costs and quantities to spread these charges.
            </p>
          )}
        </div>
      )}
      <datalist id="gst-rates">
        {GST_RATES.map((r) => (
          <option key={r} value={r} />
        ))}
      </datalist>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 sm:items-start">
        <Field
          label="Tax type"
          hint={
            costs.gstTypeAuto
              ? "Set from the vendor's state vs yours (Settings → Company)."
              : !draft.gstType
                ? "Vendor's state unknown — pick what the bill shows."
                : "Chosen for this bill."
          }
        >
          <Select
            value={draft.gstType ?? ""}
            onChange={(e) => upd((d) => ({ ...d, gstType: e.target.value as Draft["gstType"] }))}
          >
            <option value="">Auto — {SUPPLY_LABEL[costs.gstType]}</option>
            <option value="igst">{SUPPLY_LABEL.igst}</option>
            <option value="intra">{SUPPLY_LABEL.intra}</option>
          </Select>
        </Field>
        <Field label="GST on this bill ₹" hint="Blank = worked out from each line's GST %">
          <TextInput
            inputMode="decimal"
            value={draft.billGst ?? ""}
            placeholder={`≈ ${inr(costs.gstEstimated)}`}
            onChange={(e) => upd((d) => ({ ...d, billGst: e.target.value }))}
          />
        </Field>
      </div>
    </div>
  );
}

/** Final cost to the company for this bill, shown before confirming. */
function CostBreakdown({ costs }: { costs: Costs }) {
  const rows: [string, number, string?][] = [
    ["Goods (before GST)", costs.goods],
    ["Other charges (before GST)", costs.charges],
  ];
  const split = costs.gstType === "intra";
  for (const x of costs.breakup) {
    if (!x.tax && !x.rate) continue;
    if (split) {
      rows.push([`CGST ${x.rate / 2}% on ${inr(x.taxable)}`, x.tax / 2]);
      rows.push([`SGST ${x.rate / 2}% on ${inr(x.taxable)}`, x.tax / 2]);
    } else rows.push([`IGST ${x.rate}% on ${inr(x.taxable)}`, x.tax]);
  }
  if (costs.gstFromBill && Math.abs(costs.gst - costs.gstEstimated) > 0.5)
    rows.push(["GST as printed on the bill", costs.gst, `calculated ${inr(costs.gstEstimated)}`]);
  return (
    <div className="grid gap-1.5 rounded-xl border border-primary/30 bg-card p-3 text-sm">
      <strong className="text-xs font-extrabold uppercase tracking-[0.1em] text-muted-foreground">
        Cost to company
      </strong>
      {rows.map(([k, v, note]) => (
        <div key={k} className="flex justify-between gap-3 tabular-nums">
          <span>
            {k}
            {note ? <span className="text-xs text-muted-foreground"> · {note}</span> : null}
          </span>
          <span>{inr(v)}</span>
        </div>
      ))}
      <div className="flex justify-between gap-3 border-t pt-1.5 text-base font-extrabold tabular-nums">
        <span>Total</span>
        <span>{inr(costs.total)}</span>
      </div>
      <p className="text-xs text-muted-foreground">
        Item landed cost includes its share of the charges; prices are set on cost before GST (GST
        you pay is claimable as input credit).
      </p>
    </div>
  );
}
