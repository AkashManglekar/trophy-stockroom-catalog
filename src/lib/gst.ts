export const STATES: { code: string; name: string; gst: string }[] = [
  ["AN", "Andaman & Nicobar", "35"],
  ["AP", "Andhra Pradesh", "37"],
  ["AR", "Arunachal Pradesh", "12"],
  ["AS", "Assam", "18"],
  ["BR", "Bihar", "10"],
  ["CH", "Chandigarh", "04"],
  ["CT", "Chhattisgarh", "22"],
  ["DN", "Dadra & Nagar Haveli and Daman & Diu", "26"],
  ["DL", "Delhi", "07"],
  ["GA", "Goa", "30"],
  ["GJ", "Gujarat", "24"],
  ["HR", "Haryana", "06"],
  ["HP", "Himachal Pradesh", "02"],
  ["JK", "Jammu & Kashmir", "01"],
  ["JH", "Jharkhand", "20"],
  ["KA", "Karnataka", "29"],
  ["KL", "Kerala", "32"],
  ["LA", "Ladakh", "38"],
  ["LD", "Lakshadweep", "31"],
  ["MP", "Madhya Pradesh", "23"],
  ["MH", "Maharashtra", "27"],
  ["MN", "Manipur", "14"],
  ["ML", "Meghalaya", "17"],
  ["MZ", "Mizoram", "15"],
  ["NL", "Nagaland", "13"],
  ["OD", "Odisha", "21"],
  ["PY", "Puducherry", "34"],
  ["PB", "Punjab", "03"],
  ["RJ", "Rajasthan", "08"],
  ["SK", "Sikkim", "11"],
  ["TN", "Tamil Nadu", "33"],
  ["TS", "Telangana", "36"],
  ["TR", "Tripura", "16"],
  ["UP", "Uttar Pradesh", "09"],
  ["UT", "Uttarakhand", "05"],
  ["WB", "West Bengal", "19"],
].map(([code, name, gst]) => ({ code: code!, name: name!, gst: gst! }));

/** Common GST slabs, offered as suggestions — any rate can be typed. */
export const GST_RATES = [0, 0.25, 3, 5, 12, 18, 28, 40];

export type SupplyType = "igst" | "intra";
/** Two-digit GST state code of a vendor: from the GSTIN, else its source of supply / state. */
export function vendorStateCode(v: {
  gstin?: string | null;
  source_of_supply?: string | null;
  state?: string | null;
} | null | undefined): string | null {
  if (!v) return null;
  const g = (v.gstin ?? "").trim();
  if (/^\d{2}/.test(g)) return g.slice(0, 2);
  const s = STATES.find(
    (x) => x.code === v.source_of_supply || x.name === v.state || x.code === v.state,
  );
  return s?.gst ?? null;
}
/** IGST when the vendor is in another state, CGST + SGST when in the same state; null if unknown. */
export function supplyTypeFor(
  vendor: Parameters<typeof vendorStateCode>[0],
  companyState: string,
): SupplyType | null {
  const v = vendorStateCode(vendor);
  const c = STATES.find((x) => x.code === companyState)?.gst;
  if (!v || !c) return null;
  return v === c ? "intra" : "igst";
}
export const SUPPLY_LABEL: Record<SupplyType, string> = {
  igst: "IGST (other state)",
  intra: "CGST + SGST (same state)",
};

export const GST_TREATMENTS = [
  ["business_registered_regular", "Registered business – regular"],
  ["business_registered_composition", "Registered business – composition"],
  ["business_unregistered", "Unregistered business"],
  ["business_sez", "SEZ"],
  ["overseas", "Overseas"],
  ["consumer", "Consumer"],
] as const;

export const PAYMENT_TERMS: { label: string; days: number }[] = [
  { label: "Due on Receipt", days: 0 },
  { label: "Advance", days: 0 },
  { label: "Net 7", days: 7 },
  { label: "Net 15", days: 15 },
  { label: "Net 30", days: 30 },
  { label: "Net 45", days: 45 },
  { label: "Net 60", days: 60 },
];
export const VENDOR_STATUSES = ["Prospect", "Sample", "Approved", "Active", "Paused", "Exited"];

export const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
export const PAN_RE = /^[A-Z]{5}\d{4}[A-Z]$/;
export const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;

export const stateName = (code: string | null | undefined) =>
  STATES.find((s) => s.code === code)?.name ?? "";

export type VendorDraft = Record<string, string | number | null | string[] | boolean | undefined>;

/** Fills state, source of supply and PAN from a valid GSTIN. */
export function gstinAutofill<T extends VendorDraft>(
  v: T,
): T & Record<string, string | number | null | string[] | boolean | undefined> {
  const g = String(v["gstin"] ?? "")
    .trim()
    .toUpperCase();
  const out: VendorDraft = { ...v, gstin: g };
  if (!GSTIN_RE.test(g)) return out as T;
  const st = STATES.find((s) => s.gst === g.slice(0, 2));
  if (st) {
    out["source_of_supply"] = st.code;
    if (!out["state"]) out["state"] = st.name;
  }
  if (!out["pan"]) out["pan"] = g.slice(2, 12);
  if (!out["gst_treatment"] || out["gst_treatment"] === "business_unregistered")
    out["gst_treatment"] = "business_registered_regular";
  if (!out["country"]) out["country"] = "India";
  return out as T;
}

export function vendorIssues(v: VendorDraft): string[] {
  const out: string[] = [];
  const s = (k: string) => String(v[k] ?? "").trim();
  if (!s("display_name")) out.push("display name");
  if (!s("gst_treatment")) out.push("GST treatment");
  const reg = [
    "business_registered_regular",
    "business_registered_composition",
    "business_sez",
  ].includes(s("gst_treatment"));
  if (reg && !GSTIN_RE.test(s("gstin").toUpperCase()))
    out.push(s("gstin") ? "valid GSTIN" : "GSTIN");
  if (s("gst_treatment") !== "overseas" && !s("source_of_supply")) out.push("source of supply");
  if (s("pan") && !PAN_RE.test(s("pan").toUpperCase())) out.push("valid PAN");
  if (s("email") && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s("email"))) out.push("valid email");
  if (s("pin") && !/^\d{6}$/.test(s("pin"))) out.push("6-digit PIN");
  if (s("ifsc") && !IFSC_RE.test(s("ifsc").toUpperCase())) out.push("valid IFSC");
  return out;
}
