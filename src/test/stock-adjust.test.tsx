import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { Product } from "@/lib/domain";

const rpc = vi.fn().mockResolvedValue({ data: 1, error: null });
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...a: unknown[]) => rpc(...a) },
}));

import { BulkAdjust, StockAdjustForm } from "@/components/StockAdjust";

const wrap = (ui: ReactNode) =>
  render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);
const prod = (o: Partial<Product>) =>
  ({
    id: "p1",
    code: "TC-1001",
    friendly_name: "Champion Cup · 12in",
    stock: 6,
    status: "Active",
    ...o,
  }) as Product;

describe("stock adjustments", () => {
  it("single product: set count sends counted quantity", async () => {
    wrap(<StockAdjustForm p={prod({})} />);
    fireEvent.click(screen.getByRole("button", { name: "Set count" }));
    const qty = screen.getByLabelText("Counted quantity");
    fireEvent.change(qty, { target: { value: "4" } });
    expect(screen.getByText(/Stock 6 → 4/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save adjustment" }));
    await vi.waitFor(() => expect(rpc).toHaveBeenCalled());
    expect(rpc.mock.calls[0]![1]).toMatchObject({
      p_lines: [{ product_id: "p1", mode: "set", qty: 4 }],
      p_reason: "Physical count",
    });
  });

  it("bulk: resolves codes, flags unknown codes and over-removal", () => {
    wrap(
      <BulkAdjust
        products={[prod({}), prod({ id: "p2", code: "TD-1001", friendly_name: "Star", stock: 1 })]}
        onClose={() => {}}
      />,
    );
    const input = screen.getByPlaceholderText("TC-1001");
    fireEvent.change(input, { target: { value: "xx-9" } });
    expect(screen.getByText("No product with that code")).toBeTruthy();
    fireEvent.change(input, { target: { value: "td-1001" } });
    fireEvent.change(screen.getByPlaceholderText("0"), { target: { value: "3" } });
    expect(screen.getByText(/stock 1 → 4/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/^Reason/), { target: { value: "Damaged" } });
    expect(screen.getByText("Only 1 in stock")).toBeTruthy();
  });
});
