import { createServerFn } from "@tanstack/react-start";

export type QuoteItemIn = { sku: string; qty: number };
export type QuoteIn = {
  name: string;
  phone: string;
  email?: string | undefined;
  organisation?: string | undefined;
  city?: string | undefined;
  needed_by?: string | undefined;
  notes?: string | undefined;
  items: QuoteItemIn[];
  /** Honeypot — real people never fill it. */
  website?: string | undefined;
};
export type QuoteItem = {
  sku: string;
  code: string;
  name: string;
  size: string;
  qty: number;
  price: number;
};

const clip = (v: unknown, n: number) =>
  String(v ?? "")
    .trim()
    .slice(0, n);

/** Public: a customer asks for a quote from the catalogue. Prices are re-read on the server. */
export const submitQuote = createServerFn({ method: "POST" })
  .validator((d: QuoteIn) => d)
  .handler(async ({ data }): Promise<{ ref: string; items: QuoteItem[]; total: number }> => {
    if (clip(data.website, 200)) return { ref: "Q-0000", items: [], total: 0 };
    const name = clip(data.name, 80);
    const phone = clip(data.phone, 20).replace(/[^\d+]/g, "");
    if (name.length < 2) throw new Error("Please enter your name");
    if (phone.replace(/\D/g, "").length < 10) throw new Error("Please enter a valid phone number");
    const email = clip(data.email, 120);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      throw new Error("Please check the email");
    const wanted = (Array.isArray(data.items) ? data.items : [])
      .slice(0, 60)
      .map((i) => ({ sku: clip(i.sku, 40), qty: Math.floor(Number(i.qty)) }))
      .filter((i) => i.sku && i.qty > 0 && i.qty <= 100000);
    if (!wanted.length) throw new Error("Add at least one trophy to the quote");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: cat, error: ce } = await supabaseAdmin.rpc("get_catalogue");
    if (ce) throw new Error("Couldn't send right now — please try again or WhatsApp us");
    const bySku = new Map<string, QuoteItem>();
    for (const r of cat ?? [])
      for (const v of (r.variants as { sku: string; label: string; price: number }[] | null) ?? [])
        bySku.set(v.sku, {
          sku: v.sku,
          code: r.code,
          name: r.name,
          size: v.label ?? "",
          qty: 0,
          price: Number(v.price),
        });
    const items = wanted
      .map((w) => {
        const v = bySku.get(w.sku);
        return v ? { ...v, qty: w.qty } : null;
      })
      .filter((x): x is QuoteItem => !!x);
    if (!items.length)
      throw new Error("Those items are no longer in the catalogue — please refresh");
    const total = Math.round(items.reduce((a, i) => a + i.qty * i.price, 0));
    const needed = clip(data.needed_by, 10);
    const { data: row, error } = await supabaseAdmin
      .from("quote_requests")
      .insert({
        name,
        phone,
        email: email || null,
        organisation: clip(data.organisation, 120) || null,
        city: clip(data.city, 60) || null,
        needed_by: /^\d{4}-\d{2}-\d{2}$/.test(needed) ? needed : null,
        notes: clip(data.notes, 1000) || null,
        items: items as never,
        est_total: total,
      })
      .select("ref")
      .single();
    if (error) throw new Error("Couldn't send right now — please try again or WhatsApp us");
    return { ref: row.ref, items, total };
  });
