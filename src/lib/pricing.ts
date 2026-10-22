import type { AppSettings, Band, Division, ProductType } from "./domain";

export type PriceMode = "auto" | "mult" | "margin" | "fixed";
export type PriceInput = {
  unitCost: number | null;
  division: Division;
  type: ProductType;
  settings: AppSettings;
  mode?: PriceMode | string | null;
  value?: number | null;
};
export type PriceResult = {
  landed: number | null;
  selling: number | null;
  mrp: number | null;
  floor: number | null;
  bulk: number | null;
  bulkMin: number;
  gst: number | null; // percent
  margin: number | null; // percent of selling
  rule: string;
  belowCost: boolean;
};

const r2 = (x: number) => Math.round(x * 100) / 100;

export function sortedBands(bands: Band[]): Band[] {
  return [...bands]
    .filter((b) => Number.isFinite(b.from) && b.mult > 0)
    .sort((a, b) => a.from - b.from);
}

export function bandFor(landed: number, bands: Band[]): Band | null {
  const bs = sortedBands(bands);
  let hit: Band | null = null;
  for (const b of bs) if (landed >= b.from) hit = b;
  return hit ?? bs[0] ?? null;
}

export function gstFor(
  type: ProductType,
  division: Division,
  settings: AppSettings,
  selling: number | null,
): number | null {
  if (type.gst != null) return Number(type.gst);
  if (division.code === "AP") {
    const g = settings.apparel_gst;
    return selling != null && selling > g.threshold ? g.high : g.low;
  }
  return 18;
}

export function computePrice(p: PriceInput): PriceResult {
  const { division: d, type: t, settings: s } = p;
  const rd = Number(d.rounding) || 1;
  const ceil = (x: number) => Math.ceil(x / rd - 1e-9) * rd;
  const cost = p.unitCost;
  const landed =
    cost == null ? null : r2(cost * (1 + Number(d.freight_pct) / 100) + Number(d.packaging));
  const mode = (p.mode as PriceMode) || "auto";
  const value = p.value ?? null;
  let selling: number | null = null;
  let mrp: number | null = null;
  let rule = "";
  let mult: number | null = null;
  let margin: number | null = null;

  if (mode === "fixed" && value != null && value > 0) {
    selling = value;
    rule = "Fixed price";
  } else if (landed != null) {
    if (mode === "mult" && value != null && value > 0) {
      mult = value;
      rule = `Custom ×${value}`;
    } else if (mode === "margin" && value != null && value > 0 && value < 100) {
      margin = value / 100;
      rule = `Custom margin ${value}%`;
    } else if (d.pricing_mode !== "margin") {
      const band = bandFor(landed, s.bands);
      if (band) {
        mult = band.mult;
        rule = `Band ×${band.mult}`;
        if (s.edge_protection) {
          const bs = sortedBands(s.bands);
          const i = bs.indexOf(band);
          const prev = i > 0 ? bs[i - 1] : null;
          if (prev && band.from * prev.mult > landed * band.mult) {
            mult = r2((band.from * prev.mult) / landed);
            rule = `Band ×${band.mult} (edge-protected)`;
          }
        }
      }
    }
    if (mult == null && margin == null) {
      const m = t.margin_override ?? d.target_margin;
      margin = Number(m) / 100;
      rule = `Margin ${Number(m)}%`;
    }
    if (mult != null) {
      if (s.basis === "mrp") {
        mrp = ceil(landed * mult);
        let g = gstFor(t, d, s, mrp / 1.05) ?? 0;
        selling = r2(mrp / (1 + g / 100));
        const g2 = gstFor(t, d, s, selling) ?? 0;
        if (g2 !== g) {
          g = g2;
          selling = r2(mrp / (1 + g / 100));
        }
      } else {
        selling = ceil(landed * mult);
      }
    } else if (margin != null && margin < 1) {
      selling = ceil(landed / (1 - margin));
    }
  }
  const gst = gstFor(t, d, s, selling);
  if (mrp == null && selling != null && gst != null) mrp = ceil(selling * (1 + gst / 100));
  let floor = landed == null ? null : ceil(landed / (1 - Number(d.floor_margin) / 100));
  if (floor != null && selling != null && floor > selling) floor = selling;
  const bulk =
    selling == null ? null : Math.max(floor ?? 0, ceil(selling * (1 - Number(d.bulk_pct) / 100)));
  const realMargin = selling && landed != null ? r2(((selling - landed) / selling) * 100) : null;
  return {
    landed,
    selling,
    mrp,
    floor,
    bulk,
    bulkMin: Number(d.bulk_min_qty) || 1,
    gst,
    margin: realMargin,
    rule: rule || (selling == null ? "Needs cost" : ""),
    belowCost: selling != null && landed != null && selling <= landed,
  };
}

export function pricePayload(r: PriceResult) {
  return {
    landed: r.landed,
    selling: r.selling,
    mrp: r.mrp,
    floor: r.floor,
    bulk: r.bulk,
    bulk_min: r.bulkMin,
    gst: r.gst,
    rule: r.rule,
  };
}
