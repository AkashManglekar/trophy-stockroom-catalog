import { createServerFn } from "@tanstack/react-start";
import { stripTax } from "@/lib/naming";

export type CatalogueItem = {
  code: string;
  name: string;
  price: number;
  description: string;
  group: string;
  photos: string[];
};
export type CatalogueData = { items: CatalogueItem[]; logo: string | null; updatedAt: string };

/** Public, read-only catalogue. Uses the service role only to call the restricted catalogue function and sign photo URLs. */
export const getCatalogue = createServerFn({ method: "GET" }).handler(
  async (): Promise<CatalogueData> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [{ data, error }, logoQ] = await Promise.all([
      supabaseAdmin.rpc("get_catalogue"),
      supabaseAdmin.rpc("get_catalogue_logo"),
    ]);
    if (error) throw new Error("Catalogue is unavailable right now.");
    const rows = data ?? [];
    const paths = [
      ...new Set(rows.flatMap((r) => r.photos ?? []).concat(logoQ.data ? [logoQ.data] : [])),
    ];
    const signed: Record<string, string> = {};
    for (let i = 0; i < paths.length; i += 100) {
      const { data: s } = await supabaseAdmin.storage
        .from("media")
        .createSignedUrls(paths.slice(i, i + 100), 60 * 60 * 12);
      for (const x of s ?? []) if (x.path && x.signedUrl) signed[x.path] = x.signedUrl;
    }
    return {
      items: rows.map((r) => ({
        code: r.code,
        name: r.name,
        price: Number(r.price),
        description: stripTax(r.description),
        group: r.type_name,
        photos: (r.photos ?? []).map((p) => signed[p]).filter((u): u is string => !!u),
      })),
      logo: logoQ.data ? (signed[logoQ.data] ?? null) : null,
      updatedAt: new Date().toISOString(),
    };
  },
);
