import type { Tables } from "@/integrations/supabase/types";

export type Division = Tables<"divisions">;
export type ProductType = Tables<"types">;
export type CodeItem = Tables<"code_lists">;
export type Product = Tables<"products">;
export type Vendor = Tables<"vendors">;
export type Family = Tables<"design_families">;
export type Photo = Tables<"product_photos">;
export type VendorCode = Tables<"vendor_codes">;
export type Receipt = Tables<"receipts">;
export type ReceiptLine = Tables<"receipt_lines">;
export type Adjustment = Tables<"adjustments">;
export type Submission = Tables<"bill_submissions">;
export type BillPayment = Tables<"bill_payments">;
export type VendorReview = Tables<"vendor_reviews">;
export type SaleLine = Tables<"sales_lines">;
export type QuoteRequest = Tables<"quote_requests">;
export const PAY_MODES = ["UPI", "NEFT / RTGS", "IMPS", "Cash", "Cheque", "Card", "Other"];
export type Role = "owner" | "editor" | "contributor" | "viewer";

/** The only account that can ever be owner (super admin). Enforced in the database too. */
/** Brand logos (public/brand). White for blue/dark backgrounds, blue for light ones. */
export const LOGO_WHITE = "/brand/sportagon-white.png";
export const LOGO_BLUE = "/brand/sportagon-blue.png";
export const LOGO_MARK = "/brand/sportagon-mark.png";

export const OWNER_EMAIL = "akash@sportagon.in";
export const ROLE_INFO: Record<Exclude<Role, "owner">, { label: string; does: string }> = {
  editor: {
    label: "Editor",
    does: "Adds bills, edits products, prices and settings, archives/deletes products",
  },
  contributor: { label: "Contributor", does: "Adds bills, vendors and product photos" },
  viewer: { label: "Viewer", does: "Looks things up — can't change anything" },
};

export type Band = { from: number; mult: number };
export type AppSettings = {
  bands: Band[];
  basis: "pre_gst" | "mrp";
  edge_protection: boolean;
  apparel_gst: { threshold: number; low: number; high: number };
  catalogue_divisions: string[];
  /** State the business is GST-registered in (STATES code) — decides IGST vs CGST+SGST on bills. */
  company_state: string;
  logo_url: string | null;
  zoho_templates: Partial<
    Record<
      string,
      {
        headers: string[];
        filename?: string | undefined;
        map?: Record<string, string> | undefined;
        last_export?: string | undefined;
      }
    >
  >;
};

export const DEFAULT_SETTINGS: AppSettings = {
  bands: [
    { from: 0, mult: 2.5 },
    { from: 1000, mult: 2 },
    { from: 2001, mult: 1.5 },
  ],
  basis: "pre_gst",
  edge_protection: false,
  apparel_gst: { threshold: 2500, low: 5, high: 18 },
  catalogue_divisions: ["TR"],
  company_state: "MH",
  logo_url: null,
  zoho_templates: {},
};

export function normaliseSettings(raw: unknown): AppSettings {
  const d = (raw && typeof raw === "object" ? raw : {}) as Partial<AppSettings>;
  return {
    ...DEFAULT_SETTINGS,
    ...d,
    bands: Array.isArray(d.bands) && d.bands.length ? d.bands : DEFAULT_SETTINGS.bands,
    apparel_gst: { ...DEFAULT_SETTINGS.apparel_gst, ...(d.apparel_gst ?? {}) },
    catalogue_divisions: Array.isArray(d.catalogue_divisions) ? d.catalogue_divisions : ["TR"],
    zoho_templates: d.zoho_templates ?? {},
  };
}

export type RefData = {
  divisions: Division[];
  types: ProductType[];
  materials: CodeItem[];
  sports: CodeItem[];
  finishes: CodeItem[];
  sizes: CodeItem[];
  settings: AppSettings;
};

export const RECEIPT_TYPES = {
  bill: { label: "Vendor bill", ref: "Bill / invoice no." },
  opening: { label: "Opening stock", ref: "Count reference" },
  return: { label: "Customer return", ref: "Return reference" },
} as const;
export type ReceiptType = keyof typeof RECEIPT_TYPES;
/** What Receive stock offers. Opening stock / returns of existing products are stock adjustments on Products. */
export const RECEIVE_CHOICES: { type: ReceiptType; label: string }[] = [
  { type: "bill", label: "Vendor bill" },
  { type: "opening", label: "New items (no bill)" },
];

export const PRODUCT_STATUSES = [
  "Active",
  "Draft",
  "Clearance",
  "Discontinued",
  "Archived",
] as const;
/** Statuses that are hidden from the product list unless filtered for. */
export const HIDDEN_STATUSES = ["Archived"];
/** Stock adjustments. Each reason implies the direction: add, remove, or set to a counted quantity. */
export type AdjustMode = "add" | "remove" | "set";
export const ADJUST_REASONS: Record<AdjustMode, readonly string[]> = {
  add: ["Opening stock", "Customer return", "Found in recount", "Transfer in", "Other (add)"],
  remove: [
    "Damaged",
    "Lost / missing",
    "Used for display",
    "Gifted / sample",
    "Transfer out",
    "Other (remove)",
  ],
  set: ["Physical count"],
};
export const modeOfReason = (r: string): AdjustMode =>
  (Object.keys(ADJUST_REASONS) as AdjustMode[]).find((m) => ADJUST_REASONS[m].includes(r)) ?? "add";
export const NOTE_HINT: Record<string, string> = {
  "Opening stock": "Count sheet / shelf reference",
  "Customer return": "Customer name or invoice no.",
  "Physical count": "Count reference",
};
export const AWARD_CLASSES = ["Individual", "Team", "Participation", "Corporate"] as const;

export const inr = (n: number | null | undefined) =>
  n == null || Number.isNaN(n)
    ? "—"
    : "₹" + Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 });
export const pct = (n: number | null | undefined) =>
  n == null ? "—" : `${Math.round(n * 10) / 10}%`;
export const num = (v: unknown): number | null => {
  if (v === "" || v == null) return null;
  const n = Number(String(v).replace(/[₹,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
};
export const today = () => new Date().toISOString().slice(0, 10);
