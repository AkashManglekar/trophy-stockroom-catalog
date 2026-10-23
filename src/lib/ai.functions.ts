import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type ExtractedLine = {
  vendorItemCode?: string;
  description?: string;
  qty?: number;
  unitCost?: number;
  /** Total GST % on the line as printed (IGST, or CGST + SGST added together). */
  gstRate?: number;
  div?: string;
  type?: string;
  mat?: string;
  sport?: string;
  size?: string;
  finish?: string;
  designName?: string;
  match?: string;
};
export type Extracted = {
  vendorName?: string;
  vendorGstin?: string;
  billNo?: string;
  billDate?: string;
  lines: ExtractedLine[];
};

type Input = { text?: string; fileDataUrl?: string; codeLists: string; existing: string };

const PROMPT = `You read purchase bills, invoices, quotations and catalogues for an Indian sports-goods store (trophies, medals, apparel, sports infrastructure) and classify each product line into the store's code system.

Return ONLY JSON:
{"vendorName":"","vendorGstin":"","billNo":"","billDate":"YYYY-MM-DD","lines":[{"vendorItemCode":"","description":"","qty":0,"unitCost":0,"gstRate":0,"div":"","type":"","mat":"","sport":"","size":"","finish":"","designName":"","match":""}]}

Rules:
- gstRate = the line's total GST % as printed: IGST %, or CGST % + SGST % added together (e.g. CGST 9 + SGST 9 = 18). Omit if not shown.
- unitCost = price for ONE unit EXCLUDING GST. If only a line amount is printed, divide by qty. If prices include GST, remove it.
- vendorItemCode = the vendor's own item/model/part code if printed, else "".
- Skip totals, tax, freight, round-off and discount rows.
- div/type/mat/sport/finish must be codes from the CODE LISTS. Size: number for in/mm/ft/W units, apparel size code for "size", "" when the type has no size.
- sport "GEN" when none is implied; "COR" for corporate awards.
- designName: short distinctive customer-facing design name (1–3 words, e.g. "Champion Cup", "Laurel", "Victory Star"). Never only category/material/colour/size words. Sizes/finishes of the same model share the same designName. Prefer the vendor's model name when meaningful. Never reuse an existing design name for a different design.
- match: if the line is clearly the SAME physical product (same design, size and finish) as an EXISTING PRODUCT, put that product code; else "".
- Use "" or 0 when unknown.`;

export const extractBill = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: Input) => d)
  .handler(async ({ data }): Promise<Extracted> => {
    const key = process.env["LOVABLE_API_KEY"];
    if (!key)
      throw new Error(
        "AI bill reading isn't enabled for this project yet. Add lines manually, or enable Lovable AI.",
      );
    const content: unknown[] = [
      {
        type: "text",
        text: `${PROMPT}\n\nCODE LISTS:\n${data.codeLists}\n\nEXISTING PRODUCTS (code | name | spec):\n${data.existing || "(none)"}`,
      },
    ];
    if (data.text)
      content.push({ type: "text", text: `DOCUMENT:\n${data.text.slice(0, 120_000)}` });
    if (data.fileDataUrl) content.push({ type: "image_url", image_url: { url: data.fileDataUrl } });
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [{ role: "user", content }],
        response_format: { type: "json_object" },
      }),
    });
    if (res.status === 429) throw new Error("AI is busy — try again in a minute.");
    if (res.status === 402)
      throw new Error(
        "AI credits are used up for this workspace. Add credits in Lovable, or add lines manually.",
      );
    if (!res.ok)
      throw new Error(
        `AI couldn't read the document (${res.status}). Try a clearer photo or paste the text.`,
      );
    const j = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const txt = j.choices?.[0]?.message?.content ?? "";
    const m = txt.match(/\{[\s\S]*\}/);
    if (!m) throw new Error("AI didn't return any lines. Try a clearer photo or paste the text.");
    const out = JSON.parse(m[0]) as Extracted;
    if (!Array.isArray(out.lines)) out.lines = [];
    return out;
  });
