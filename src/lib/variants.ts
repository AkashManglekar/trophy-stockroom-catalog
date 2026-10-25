/** Splitting a design's variants into two choices — size and colour — for medals and similar. */
export type VariantLike = { size: string; colour: string };

export type Axes = {
  sizes: string[];
  colours: string[];
  /** Index of the variant with this size and colour, or -1 when that combination isn't stocked. */
  find: (size: string, colour: string) => number;
  /** Best variant when one choice changes: keeps the other choice if that combination exists. */
  choose: (cur: number, change: { size?: string; colour?: string }) => number;
};

const uniq = (xs: string[]) => [...new Set(xs)];

export function variantAxes(vs: VariantLike[]): Axes {
  const sizes = uniq(vs.map((v) => v.size));
  const colours = uniq(vs.map((v) => v.colour).filter(Boolean));
  const find = (s: string, c: string) => vs.findIndex((v) => v.size === s && v.colour === c);
  const choose = (cur: number, change: { size?: string; colour?: string }) => {
    const now = vs[cur] ?? vs[0];
    if (!now) return 0;
    const size = change.size ?? now.size;
    const colour = change.colour ?? now.colour;
    const exact = find(size, colour);
    if (exact >= 0) return exact;
    // Keep what was just picked, take the first match for the other choice.
    const fallback = vs.findIndex((v) =>
      change.colour !== undefined ? v.colour === colour : v.size === size,
    );
    return fallback >= 0 ? fallback : cur;
  };
  return { sizes, colours, find, choose };
}

/** Swatch colours for finish names (medal metals first). */
const SWATCH: Record<string, string> = {
  gold: "linear-gradient(135deg,#f6e27a,#c9a227 55%,#9c7a12)",
  silver: "linear-gradient(135deg,#f4f5f7,#b9bec6 55%,#8b9099)",
  bronze: "linear-gradient(135deg,#e7b07a,#b0703a 55%,#7d4a1f)",
  "rose gold": "linear-gradient(135deg,#f5c8c0,#c98a7e 55%,#9a5c52)",
  antique: "linear-gradient(135deg,#c9b48a,#8d7448 55%,#5d4a2a)",
  chrome: "linear-gradient(135deg,#ffffff,#c9ced6 50%,#7d848f)",
  black: "#1f2328",
  white: "#ffffff",
  blue: "#1e4fd8",
  navy: "#14235c",
  red: "#d42a2a",
  maroon: "#7a1f2b",
  green: "#1f8a4c",
  yellow: "#f2c230",
  orange: "#f07c1f",
  grey: "#8a9099",
  pink: "#f08ab8",
  purple: "#7a3fc2",
  clear: "linear-gradient(135deg,#ffffff,#e6f2fb)",
  frosted: "linear-gradient(135deg,#f7fbff,#d9e4ee)",
  natural: "#c8a878",
};
export const swatchOf = (colour: string) =>
  SWATCH[colour.trim().toLowerCase()] ?? "linear-gradient(135deg,#eee,#bbb)";
