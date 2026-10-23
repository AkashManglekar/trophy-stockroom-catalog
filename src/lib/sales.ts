import { num } from "./domain";

/** Line key shared by the API sync and file imports: item name + occurrence in the document. */
export function lineKey(name: string, seen: Map<string, number>) {
  const k = name.trim().toLowerCase();
  const n = (seen.get(k) ?? 0) + 1;
  seen.set(k, n);
  return `${k}#${n}`;
}

export type SaleDoc = {
  kind: "invoice" | "credit";
  doc_id: string;
  doc_no: string;
  date: string;
  status: string;
  customer: string;
  lines: {
    line_key: string;
    item_id: string;
    name: string;
    sku: string;
    qty: number;
    rate: number;
    amount: number;
  }[];
};

const norm = (h: string) =>
  h
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
const pick = (headers: string[], ...names: string[]) => {
  const hs = headers.map(norm);
  for (const n of names) {
    const i = hs.indexOf(n);
    if (i >= 0) return i;
  }
  return -1;
};

/** Zoho dates come as 2026-10-23, 23/10/2026 or 23-10-2026. */
function isoDate(v: unknown): string {
  const s = String(v ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/.exec(s);
  if (m) return `${m[3]}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}`;
  return "";
}

/**
 * Turns a Zoho Books export (Invoices or Credit Notes, CSV/XLSX, one row per line item) into documents.
 * Returns the documents plus what couldn't be read.
 */
export function parseSalesRows(rows: unknown[][]): { docs: SaleDoc[]; problems: string[] } {
  const hi = rows.findIndex((r) => r.filter((x) => String(x ?? "").trim()).length >= 3);
  if (hi < 0) return { docs: [], problems: ["No header row found"] };
  const headers = rows[hi]!.map((x) => String(x ?? ""));
  const iCredit = pick(headers, "credit note number", "creditnote number", "credit note");
  const kind: SaleDoc["kind"] = iCredit >= 0 ? "credit" : "invoice";
  const iNo =
    iCredit >= 0 ? iCredit : pick(headers, "invoice number", "invoice no", "invoice", "invoice");
  const iDate = pick(headers, kind === "credit" ? "credit note date" : "invoice date", "date");
  const iStatus = pick(
    headers,
    kind === "credit" ? "credit note status" : "invoice status",
    "status",
  );
  const iCust = pick(headers, "customer name", "customer");
  const iItem = pick(headers, "item name", "item", "product name");
  const iItemId = pick(headers, "item id", "product id");
  const iSku = pick(headers, "sku", "item sku");
  const iQty = pick(headers, "quantity", "qty");
  const iRate = pick(headers, "item price", "rate", "item rate");
  const iTotal = pick(headers, "item total", "amount", "line total");
  const problems: string[] = [];
  if (iNo < 0)
    problems.push(`No "${kind === "credit" ? "Credit Note Number" : "Invoice Number"}" column`);
  if (iItem < 0 && iSku < 0) problems.push('No "Item Name" or "SKU" column');
  if (iQty < 0) problems.push('No "Quantity" column');
  if (problems.length) return { docs: [], problems };
  const byNo = new Map<string, SaleDoc & { seen: Map<string, number> }>();
  for (const r of rows.slice(hi + 1)) {
    const no = String(r[iNo] ?? "").trim();
    if (!no) continue;
    const name = String(iItem >= 0 ? (r[iItem] ?? "") : (r[iSku] ?? "")).trim();
    const qty = num(r[iQty]);
    if (!name || qty == null) continue;
    let d = byNo.get(no);
    if (!d) {
      d = {
        kind,
        doc_id: no,
        doc_no: no,
        date: iDate >= 0 ? isoDate(r[iDate]) : "",
        status:
          String(iStatus >= 0 ? (r[iStatus] ?? "") : "sent")
            .trim()
            .toLowerCase()
            .replace(/\s+/g, "_") || "sent",
        customer: iCust >= 0 ? String(r[iCust] ?? "").trim() : "",
        lines: [],
        seen: new Map(),
      };
      byNo.set(no, d);
    }
    d.lines.push({
      line_key: lineKey(name, d.seen),
      item_id: iItemId >= 0 ? String(r[iItemId] ?? "").trim() : "",
      name,
      sku: iSku >= 0 ? String(r[iSku] ?? "").trim() : "",
      qty,
      rate: num(iRate >= 0 ? r[iRate] : null) ?? 0,
      amount: num(iTotal >= 0 ? r[iTotal] : null) ?? qty * (num(iRate >= 0 ? r[iRate] : null) ?? 0),
    });
  }
  return { docs: [...byNo.values()].map(({ seen: _s, ...d }) => d), problems };
}
