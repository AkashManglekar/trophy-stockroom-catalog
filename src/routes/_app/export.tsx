import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Download, FileUp } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import type { AppSettings, Product, RefData, Vendor } from "@/lib/domain";
import {
  errMsg,
  saveSettings,
  useFamilies,
  useInvalidate,
  useProducts,
  useRefData,
  useVendorCodes,
  useVendors,
} from "@/lib/data";
import { vendorIssues } from "@/lib/gst";
import { KINDS, headerKey, type Kind } from "@/lib/zoho";
import { Card, CardTitle, Empty, Notice, PageHead, Select } from "@/components/kit";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_app/export")({
  head: () => ({ meta: [{ title: "Zoho export · Sportagon Stockroom" }] }),
  component: ExportPage,
});

function ExportPage() {
  const ref = useRefData();
  if (!ref.data) return <Empty>Loading…</Empty>;
  return (
    <>
      <PageHead
        title="Zoho export"
        lede="Full-refresh files built from your system, in the exact column layout of Zoho's sample files. Import vendors first, then items, so preferred vendors resolve."
      />
      <ExportSection kind="vendors" ref_={ref.data} />
      <ExportSection kind="items" ref_={ref.data} />
    </>
  );
}

function ExportSection({ kind, ref_ }: { kind: Kind; ref_: RefData }) {
  const K = KINDS[kind];
  const { canEdit, email } = useAuth();
  const products = useProducts();
  const vendors = useVendors();
  const families = useFamilies();
  const vcodes = useVendorCodes();
  const inv = useInvalidate();
  const [drafts, setDrafts] = useState(false);
  const tpl = ref_.settings.zoho_templates[kind];
  const headers = tpl?.headers?.length ? tpl.headers : [...K.defaults];
  const keys = headers.map((h) => headerKey(kind, h, tpl?.map));
  const unmapped = headers.filter((_, i) => keys[i] === "blank");

  const rows: (string | number)[][] =
    kind === "items"
      ? (products.data ?? [])
          .filter((p) => !p.is_sample && (drafts || p.status !== "Draft"))
          .map((p: Product) =>
            keys.map((k) => {
              const f = K.fields.find((x) => x.key === k) as
                (typeof KINDS)["items"]["fields"][number] | undefined;
              const v = f?.get(p, {
                ref: ref_,
                vendors: vendors.data ?? [],
                families: families.data ?? [],
                vcodes: vcodes.data ?? [],
              });
              return v ?? "";
            }),
          )
      : (vendors.data ?? [])
          .filter((v) => !v.is_sample)
          .map((v: Vendor) =>
            keys.map((k) => {
              const f = KINDS.vendors.fields.find((x) => x.key === k);
              return f?.get(v, null) ?? "";
            }),
          );
  const issues =
    kind === "vendors"
      ? (vendors.data ?? []).filter((v) => !v.is_sample && vendorIssues(v as never).length)
      : [];
  const changed = tpl?.last_export
    ? (kind === "items" ? (products.data ?? []) : (vendors.data ?? [])).filter(
        (x) => (x.updated_at ?? x.created_at ?? "") > (tpl.last_export ?? ""),
      ).length
    : null;

  async function persist(patch: Partial<AppSettings["zoho_templates"][string]>) {
    const cur = ref_.settings.zoho_templates[kind] ?? { headers: [] };
    const next: AppSettings = {
      ...ref_.settings,
      zoho_templates: { ...ref_.settings.zoho_templates, [kind]: { ...cur, ...patch } },
    };
    await saveSettings(next);
    await inv("ref");
  }
  async function onSample(file: File | undefined) {
    if (!file) return;
    try {
      const XLSX = await import("xlsx");
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const data = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0] ?? ""]!, {
        header: 1,
        raw: false,
        defval: "",
      });
      const hr = data.find((r) => (r as unknown[]).filter((x) => String(x).trim()).length >= 3) as
        unknown[] | undefined;
      if (!hr) throw new Error("No header row found in that file.");
      await persist({
        headers: hr.map((x) => String(x).trim()).filter(Boolean),
        filename: file.name,
        map: {},
      });
      toast.success(`${K.label} template saved`);
    } catch (e) {
      toast.error(errMsg(e));
    }
  }
  async function download(fmt: "xlsx" | "csv") {
    const XLSX = await import("xlsx");
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, K.label);
    const name = `Sportagon_Zoho_${K.label}_${new Date().toISOString().slice(0, 10)}.${fmt}`;
    XLSX.writeFile(wb, name, { bookType: fmt });
    await supabase
      .from("zoho_exports")
      .insert({ kind, records: rows.length, created_by_email: email });
    try {
      await persist({ last_export: new Date().toISOString() });
    } catch {
      /* viewers can't save settings */
    }
  }

  return (
    <Card>
      <CardTitle
        right={
          kind === "items" ? (
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={drafts}
                onChange={(e) => setDrafts(e.target.checked)}
              />{" "}
              Include Draft products
            </label>
          ) : null
        }
      >
        {K.label} file · {rows.length} rows
      </CardTitle>
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="wrap-any min-w-0 flex-1">
          {tpl?.headers?.length ? (
            <>
              Template: <strong>{tpl.filename}</strong> · {headers.length} columns
            </>
          ) : (
            <>
              Zoho's standard {K.label.toLowerCase()} import columns ({headers.length}). Upload
              Zoho's sample {K.label.toLowerCase()} file to match it exactly.
            </>
          )}
        </span>
        {canEdit && (
          <span className="flex flex-wrap gap-2">
            <label
              htmlFor={`zs-${kind}`}
              className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-[11px] font-bold uppercase hover:border-primary"
            >
              <FileUp className="size-4" />
              Upload Zoho sample
            </label>
            <input
              id={`zs-${kind}`}
              type="file"
              hidden
              accept=".xlsx,.xls,.csv"
              onChange={(e) => {
                onSample(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
            {tpl?.headers?.length ? (
              <Button
                size="sm"
                variant="ghost"
                className="rounded-full"
                onClick={() => persist({ headers: [], filename: "", map: {} })}
              >
                Use standard columns
              </Button>
            ) : null}
          </span>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        {tpl?.last_export
          ? `Last exported ${tpl.last_export.slice(0, 16).replace("T", " ")} · ${changed} changed since`
          : "Not exported yet."}
      </p>
      {unmapped.length > 0 && (
        <Notice>
          Left blank: {unmapped.join(", ")}. Pick a field in the mapping if one should be filled.
        </Notice>
      )}
      {issues.length > 0 && (
        <Notice tone="warn">
          {issues.length} vendor{issues.length === 1 ? "" : "s"} missing Zoho details:{" "}
          {issues.map((v) => `${v.code} (${vendorIssues(v as never).join(", ")})`).join("; ")}.
          Complete them in Vendors.
        </Notice>
      )}
      <details>
        <summary className="cursor-pointer text-sm">Column mapping ({headers.length})</summary>
        <div className="mt-3 grid gap-2">
          {headers.map((h, i) => (
            <div
              key={h + i}
              className="grid grid-cols-1 items-center gap-1 sm:grid-cols-[1fr_1fr] sm:gap-3"
            >
              <span className="wrap-any text-sm">{h}</span>
              <Select
                disabled={!canEdit}
                value={keys[i]}
                onChange={(e) =>
                  persist({ headers, map: { ...(tpl?.map ?? {}), [h]: e.target.value } })
                }
              >
                {K.fields.map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.label}
                  </option>
                ))}
              </Select>
            </div>
          ))}
        </div>
      </details>
      <div className="panel overflow-x-auto">
        <table className="w-max min-w-full text-xs">
          <thead className="bg-muted">
            <tr>
              {headers.map((h, i) => (
                <th key={i} className="whitespace-nowrap p-2 text-left font-semibold">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 5).map((r, i) => (
              <tr key={i} className="border-t">
                {r.map((c, j) => (
                  <td key={j} className="max-w-60 truncate p-2">
                    {String(c)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        Preview of {Math.min(5, rows.length)} of {rows.length}. Sample data is never exported. In
        Zoho Inventory: {K.where}.
        {kind === "items"
          ? " Opening Stock only applies when Zoho creates an item; record later stock through a purchase bill or inventory adjustment."
          : ""}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button className="rounded-full" disabled={!rows.length} onClick={() => download("xlsx")}>
          <Download className="size-4" />
          Download .xlsx
        </Button>
        <Button
          variant="outline"
          className="rounded-full"
          disabled={!rows.length}
          onClick={() => download("csv")}
        >
          <Download className="size-4" />
          Download .csv
        </Button>
      </div>
    </Card>
  );
}
