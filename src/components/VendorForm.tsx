import { Field, Select, TextInput } from "@/components/kit";
import {
  GST_TREATMENTS,
  PAYMENT_TERMS,
  STATES,
  VENDOR_STATUSES,
  gstinAutofill,
  vendorIssues,
} from "@/lib/gst";

export type VendorValues = Record<string, string>;
type F = {
  k: string;
  label: string;
  options?: { v: string; l: string }[];
  inputMode?: "numeric" | "email" | "tel";
  upper?: boolean;
};

const STATE_OPTS = [{ v: "", l: "—" }, ...STATES.map((s) => ({ v: s.code, l: s.name }))];
const STATE_NAME_OPTS = [{ v: "", l: "—" }, ...STATES.map((s) => ({ v: s.name, l: s.name }))];

const SECTIONS: { title: string; open: boolean; fields: F[] }[] = [
  {
    title: "Contact",
    open: true,
    fields: [
      { k: "display_name", label: "Display name *" },
      { k: "company", label: "Company name" },
      {
        k: "salutation",
        label: "Salutation",
        options: ["", "Mr.", "Ms.", "Mrs.", "Dr."].map((v) => ({ v, l: v || "—" })),
      },
      { k: "first_name", label: "Contact first name" },
      { k: "last_name", label: "Contact last name" },
      { k: "email", label: "Email", inputMode: "email" },
      { k: "phone", label: "Phone", inputMode: "tel" },
      { k: "mobile", label: "Mobile", inputMode: "tel" },
      { k: "website", label: "Website" },
    ],
  },
  {
    title: "Tax & compliance",
    open: true,
    fields: [
      {
        k: "gst_treatment",
        label: "GST treatment *",
        options: GST_TREATMENTS.map(([v, l]) => ({ v, l })),
      },
      { k: "gstin", label: "GSTIN", upper: true },
      { k: "source_of_supply", label: "Source of supply *", options: STATE_OPTS },
      { k: "pan", label: "PAN", upper: true },
      { k: "msme", label: "MSME / Udyam no." },
    ],
  },
  {
    title: "Billing address",
    open: false,
    fields: [
      { k: "billing_attention", label: "Attention" },
      { k: "street1", label: "Street 1" },
      { k: "street2", label: "Street 2" },
      { k: "city", label: "City" },
      { k: "state", label: "State", options: STATE_NAME_OPTS },
      { k: "pin", label: "PIN code", inputMode: "numeric" },
      { k: "country", label: "Country" },
    ],
  },
  {
    title: "Payment & bank",
    open: false,
    fields: [
      {
        k: "payment_terms",
        label: "Payment terms",
        options: PAYMENT_TERMS.map((t) => ({ v: t.label, l: t.label })),
      },
      { k: "currency", label: "Currency" },
      { k: "bank_holder", label: "Account holder" },
      { k: "bank_name", label: "Bank name" },
      { k: "bank_account", label: "Account number", inputMode: "numeric" },
      { k: "ifsc", label: "IFSC", upper: true },
    ],
  },
  {
    title: "Supply",
    open: false,
    fields: [
      { k: "lead_time_days", label: "Lead time (days)", inputMode: "numeric" },
      { k: "moq", label: "MOQ / min order" },
      { k: "status", label: "Status", options: VENDOR_STATUSES.map((v) => ({ v, l: v })) },
      { k: "quality", label: "Quality (1–5)", inputMode: "numeric" },
      { k: "notes", label: "Notes" },
    ],
  },
];

/** Controlled vendor form. `onChange` receives the full next value set (GSTIN autofill applied). */
export function VendorForm({
  value,
  onChange,
  onBlurField,
  disabled,
  idPrefix,
}: {
  value: VendorValues;
  onChange: (v: VendorValues) => void;
  onBlurField?: (k: string, v: VendorValues) => void;
  disabled?: boolean;
  idPrefix: string;
}) {
  const issues = vendorIssues(value);
  const set = (k: string, raw: string, upper?: boolean) => {
    let next: VendorValues = { ...value, [k]: upper ? raw.toUpperCase() : raw };
    if (k === "gstin") next = gstinAutofill(next) as VendorValues;
    onChange(next);
    return next;
  };
  return (
    <div className="grid gap-3">
      {SECTIONS.map((s) => (
        <details key={s.title} open={s.open} className="group">
          <summary className="cursor-pointer text-sm font-bold">{s.title}</summary>
          <div className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(min(170px,100%),1fr))] gap-3">
            {s.fields.map((f) => (
              <Field key={f.k} label={f.label}>
                {f.options ? (
                  <Select
                    id={`${idPrefix}-${f.k}`}
                    disabled={disabled}
                    value={value[f.k] ?? ""}
                    onChange={(e) => {
                      const n = set(f.k, e.target.value);
                      onBlurField?.(f.k, n);
                    }}
                  >
                    {f.options.map((o) => (
                      <option key={o.v} value={o.v}>
                        {o.l}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <TextInput
                    id={`${idPrefix}-${f.k}`}
                    disabled={disabled}
                    inputMode={
                      f.inputMode === "email"
                        ? "email"
                        : f.inputMode === "tel"
                          ? "tel"
                          : f.inputMode
                    }
                    value={value[f.k] ?? ""}
                    onChange={(e) => set(f.k, e.target.value, f.upper)}
                    onBlur={() => onBlurField?.(f.k, value)}
                  />
                )}
              </Field>
            ))}
          </div>
        </details>
      ))}
      {issues.length ? (
        <p className="text-sm text-warning-foreground dark:text-warning">
          For Zoho, still needs: {issues.join(", ")}
        </p>
      ) : (
        <p className="text-sm text-success">All Zoho-required details present.</p>
      )}
      <p className="text-xs text-muted-foreground">
        Enter the GSTIN and the state, source of supply and PAN fill themselves.
      </p>
    </div>
  );
}

/** Converts form strings to a vendors-table row. */
export function vendorRow(v: VendorValues) {
  const g = (k: string) => (v[k] ?? "").trim();
  const s = (k: string) => g(k) || null;
  const up = (k: string) => g(k).toUpperCase() || null;
  const n = (k: string) => (g(k) ? Number(g(k)) : null);
  return {
    display_name: g("display_name"),
    company: s("company"),
    salutation: s("salutation"),
    first_name: s("first_name"),
    last_name: s("last_name"),
    email: s("email"),
    phone: s("phone"),
    mobile: s("mobile"),
    website: s("website"),
    gst_treatment: g("gst_treatment") || "business_registered_regular",
    gstin: up("gstin"),
    source_of_supply: s("source_of_supply"),
    pan: up("pan"),
    msme: s("msme"),
    billing_attention: s("billing_attention"),
    street1: s("street1"),
    street2: s("street2"),
    city: s("city"),
    state: s("state"),
    pin: s("pin"),
    country: s("country") ?? "India",
    payment_terms: s("payment_terms"),
    currency: s("currency") ?? "INR",
    bank_holder: s("bank_holder"),
    bank_name: s("bank_name"),
    bank_account: s("bank_account"),
    ifsc: up("ifsc"),
    lead_time_days: n("lead_time_days"),
    moq: s("moq"),
    status: g("status") || "Active",
    quality: n("quality"),
    notes: s("notes"),
  };
}

export function vendorValues(row: Record<string, unknown>): VendorValues {
  const out: VendorValues = {};
  for (const [k, val] of Object.entries(row))
    out[k] = val == null ? "" : Array.isArray(val) ? val.join(", ") : String(val);
  return out;
}
