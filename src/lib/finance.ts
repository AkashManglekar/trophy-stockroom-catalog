import type { BillPayment, VendorReview } from "./domain";
import type { BillWithLines } from "./data";

const r2 = (x: number) => Math.round(x * 100) / 100;
export const today = () => new Date().toISOString().slice(0, 10);

/** What the bill costs the company (goods + charges + GST). */
export function billPayable(b: BillWithLines): number {
  if (b.total_cost != null) return Number(b.total_cost);
  const goods =
    b.goods_value != null
      ? Number(b.goods_value)
      : b.lines.reduce(
          (a, l) => a + (Number(l.unit_cost) || 0) * Number(l.billed_qty ?? l.received_qty),
          0,
        );
  return r2(goods + Number(b.charges_total ?? 0) + Number(b.gst_total ?? 0));
}

export type PayStatus = "paid" | "partly" | "unpaid" | "overdue" | "reversed" | "none";
export const PAY_LABEL: Record<PayStatus, string> = {
  paid: "Paid",
  partly: "Part paid",
  unpaid: "Unpaid",
  overdue: "Overdue",
  reversed: "Reversed",
  none: "—",
};
export const PAY_TONE: Record<PayStatus, "ok" | "warn" | "bad" | "mute" | "info"> = {
  paid: "ok",
  partly: "info",
  unpaid: "warn",
  overdue: "bad",
  reversed: "mute",
  none: "mute",
};

export function billMoney(b: BillWithLines, payments: BillPayment[]) {
  const total = b.receipt_type === "bill" ? billPayable(b) : 0;
  const paid = r2(
    payments.filter((p) => p.receipt_id === b.id).reduce((a, p) => a + Number(p.amount), 0),
  );
  const balance = r2(Math.max(0, total - paid));
  const overdueDays =
    b.due_date && balance > 0.5
      ? Math.floor((Date.parse(today()) - Date.parse(String(b.due_date))) / 86_400_000)
      : 0;
  const status: PayStatus =
    b.receipt_type !== "bill"
      ? "none"
      : b.reversed_at
        ? "reversed"
        : balance <= 0.5
          ? "paid"
          : overdueDays > 0
            ? "overdue"
            : paid > 0
              ? "partly"
              : "unpaid";
  return { total, paid, balance, status, overdueDays: Math.max(0, overdueDays) };
}

export function avgRating(rs: VendorReview[]) {
  const vals = rs.flatMap((r) =>
    [r.quality, r.delivery, r.pricing].filter((x): x is number => x != null),
  );
  return vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10 : null;
}

/** Business with one vendor: bills, cost, paid, owed, overdue, last bill, rating. */
export function vendorBusiness(
  vendorId: string,
  bills: BillWithLines[],
  payments: BillPayment[],
  reviews: VendorReview[],
) {
  const vb = bills.filter(
    (b) => b.vendor_id === vendorId && b.receipt_type === "bill" && !b.reversed_at,
  );
  let total = 0;
  let paid = 0;
  let owed = 0;
  let overdue = 0;
  for (const b of vb) {
    const m = billMoney(b, payments);
    total += m.total;
    paid += m.paid;
    owed += m.balance;
    if (m.status === "overdue") overdue += m.balance;
  }
  const products = new Set(vb.flatMap((b) => b.lines.map((l) => l.product_id).filter(Boolean)));
  const units = vb.reduce((a, b) => a + b.lines.reduce((x, l) => x + l.received_qty, 0), 0);
  const short = vb.reduce(
    (a, b) =>
      a +
      b.lines.reduce(
        (x, l) => x + Math.max(0, Number(l.billed_qty ?? l.received_qty) - l.received_qty),
        0,
      ),
    0,
  );
  const vr = reviews.filter((r) => r.vendor_id === vendorId);
  const dates = vb.map((b) => String(b.bill_date ?? b.created_at).slice(0, 10)).sort();
  return {
    bills: vb.length,
    total: r2(total),
    paid: r2(paid),
    owed: r2(owed),
    overdue: r2(overdue),
    products: products.size,
    units,
    shortUnits: short,
    first: dates[0] ?? null,
    last: dates[dates.length - 1] ?? null,
    rating: avgRating(vr),
    reviews: vr.length,
  };
}
