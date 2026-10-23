import { describe, expect, it } from "vitest";
import { parseSalesRows } from "@/lib/sales";
import { billMoney, vendorBusiness } from "@/lib/finance";

const bill = (o: Record<string, unknown>) =>
  ({
    id: "b1",
    receipt_type: "bill",
    vendor_id: "v1",
    reversed_at: null,
    total_cost: 1180,
    due_date: "2000-01-01",
    bill_date: "1999-12-01",
    created_at: "1999-12-01",
    lines: [{ product_id: "p1", received_qty: 10, billed_qty: 10, unit_cost: 100 }],
    ...o,
  }) as never;

describe("Zoho export import", () => {
  it("groups invoice lines and repeats keep separate keys", () => {
    const { docs, problems } = parseSalesRows([
      [
        "Invoice Date",
        "Invoice Number",
        "Invoice Status",
        "Customer Name",
        "Item Name",
        "SKU",
        "Quantity",
        "Item Price",
        "Item Total",
      ],
      [
        "23/10/2026",
        "INV-001",
        "Sent",
        "DPS",
        "Symbol · 11in · Gold",
        "TC-1005-11",
        "3",
        "1130",
        "3390",
      ],
      [
        "23/10/2026",
        "INV-001",
        "Sent",
        "DPS",
        "Symbol · 11in · Gold",
        "TC-1005-11",
        "1",
        "1130",
        "1130",
      ],
      ["24/10/2026", "INV-002", "Void", "ABC", "World Map", "", "2", "2020", "4040"],
    ]);
    expect(problems).toEqual([]);
    expect(docs).toHaveLength(2);
    expect(docs[0]!.date).toBe("2026-10-23");
    expect(docs[0]!.lines.map((l) => l.line_key)).toEqual([
      "symbol · 11in · gold#1",
      "symbol · 11in · gold#2",
    ]);
    expect(docs[1]!.status).toBe("void");
  });
  it("reads credit notes and reports missing columns", () => {
    const cn = parseSalesRows([
      ["Credit Note Date", "Credit Note Number", "Item Name", "Quantity"],
      ["2026-10-25", "CN-1", "World Map", "1"],
    ]);
    expect(cn.docs[0]!.kind).toBe("credit");
    expect(parseSalesRows([["Date", "Customer", "Total"]]).problems.length).toBeGreaterThan(0);
  });
});

describe("payables", () => {
  it("tracks paid, balance and overdue", () => {
    const pays = [{ receipt_id: "b1", amount: 500 }] as never[];
    const m = billMoney(bill({}), pays);
    expect(m).toMatchObject({ total: 1180, paid: 500, balance: 680, status: "overdue" });
    expect(billMoney(bill({}), [{ receipt_id: "b1", amount: 1180 }] as never[]).status).toBe(
      "paid",
    );
    const v = vendorBusiness("v1", [bill({})], pays, [
      { vendor_id: "v1", quality: 4, delivery: 5, pricing: 3 },
    ] as never[]);
    expect(v).toMatchObject({
      bills: 1,
      total: 1180,
      paid: 500,
      owed: 680,
      overdue: 680,
      rating: 4,
      units: 10,
    });
  });
});
