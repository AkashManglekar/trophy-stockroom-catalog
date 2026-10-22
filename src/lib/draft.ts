import { useSyncExternalStore } from "react";
import { today, type ReceiptType } from "./domain";

export type DraftLine = {
  id: string;
  vitem: string;
  desc: string;
  billed: string;
  received: string;
  cost: string;
  location: string;
  mode: "new" | "link";
  linkId: string;
  unmap?: boolean;
  ai?: boolean;
  suggest?: string;
  cls: {
    div: string;
    type: string;
    mat: string;
    sport: string;
    size: string;
    finish: string;
    family: string; // "new" | "f:<familyId>" | "l:<lineId>"
    designName: string;
    description: string;
  };
};
export type VendorForm = Record<string, string>;
export type Draft = {
  type: ReceiptType;
  vendorId: string; // "" | "NEW" | uuid
  newVendor: VendorForm;
  billNo: string;
  billDate: string;
  billTotal: string;
  lines: DraftLine[];
  /** Approver is editing someone's submitted bill before approving it. */
  reviewOf?: string | undefined;
  reviewOfLabel?: string | undefined;
  /** Submitter is fixing a bill that was sent back. */
  resubmitOf?: string | undefined;
};

const KEY = "stockroom-draft-v1";
const EVT = "stockroom-draft";
export const uid = () => Math.random().toString(36).slice(2, 10);
export const blankVendor = (): VendorForm => ({
  display_name: "",
  company: "",
  salutation: "",
  first_name: "",
  last_name: "",
  email: "",
  phone: "",
  mobile: "",
  website: "",
  gst_treatment: "business_registered_regular",
  gstin: "",
  source_of_supply: "",
  pan: "",
  msme: "",
  billing_attention: "",
  street1: "",
  street2: "",
  city: "",
  state: "",
  pin: "",
  country: "India",
  payment_terms: "Net 30",
  currency: "INR",
  bank_holder: "",
  bank_name: "",
  bank_account: "",
  ifsc: "",
  lead_time_days: "",
  moq: "",
  status: "Active",
  quality: "",
  notes: "",
});
export const newDraft = (): Draft => ({
  type: "bill",
  vendorId: "",
  newVendor: blankVendor(),
  billNo: "",
  billDate: today(),
  billTotal: "",
  lines: [],
});
export const newLine = (o: Partial<DraftLine> = {}): DraftLine => ({
  id: uid(),
  vitem: "",
  desc: "",
  billed: "1",
  received: "",
  cost: "",
  location: "",
  mode: "new",
  linkId: "",
  ...o,
  cls: {
    div: "",
    type: "",
    mat: "",
    sport: "GEN",
    size: "",
    finish: "",
    family: "new",
    designName: "",
    description: "",
    ...(o.cls ?? {}),
  },
});

let cache: Draft | null = null;
function read(): Draft {
  if (cache) return cache;
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(KEY) : null;
    cache = raw ? { ...newDraft(), ...JSON.parse(raw) } : newDraft();
  } catch {
    cache = newDraft();
  }
  return cache!;
}
export function setDraft(next: Draft | ((d: Draft) => Draft)) {
  cache = typeof next === "function" ? next(read()) : next;
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    /* storage unavailable — keep in memory */
  }
  window.dispatchEvent(new Event(EVT));
}
const subscribe = (cb: () => void) => {
  window.addEventListener(EVT, cb);
  return () => window.removeEventListener(EVT, cb);
};
const SERVER_DRAFT = newDraft();
export function useDraft(): Draft {
  return useSyncExternalStore(subscribe, read, () => SERVER_DRAFT);
}
