import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Globe,
  Mail,
  MessageCircle,
  Phone,
  Plus,
  Search,
  X,
} from "lucide-react";
import type { CatalogueData, CatalogueItem } from "@/lib/catalogue.functions";
import { cn } from "@/lib/utils";
import { QuoteCart, useQuoteCart } from "@/components/QuoteCart";
import { LOGO_BLUE, LOGO_MARK, LOGO_WHITE } from "@/lib/domain";
import { BrandMark } from "@/components/BrandMark";
import { swatchOf, variantAxes } from "@/lib/variants";

const SITE = "https://catalogue.sportagon.in";
const PHONE = "+91 72760 88888";
const PHONE_E164 = "+917276088888";
const SHARE_TITLE = "Sportagon Trophy Catalogue — Trophies, Medals & Awards";
const SHARE_DESC =
  "Browse Sportagon's trophies, medals and mementos for tournaments, schools and corporate events — with codes, prices and photos. Enquiries: +91 72760 88888.";
const SHARE_IMAGE = `${SITE}/brand/og-catalogue.jpg`;

/** Page title, search snippet and link preview (WhatsApp, Facebook, LinkedIn, X, iMessage). */
export const catalogueHead = () => ({
  meta: [
    { title: SHARE_TITLE },
    { name: "description", content: SHARE_DESC },
    { name: "robots", content: "index, follow" },
    { property: "og:site_name", content: "Sportagon" },
    { property: "og:type", content: "website" },
    { property: "og:locale", content: "en_IN" },
    { property: "og:url", content: SITE },
    { property: "og:title", content: SHARE_TITLE },
    { property: "og:description", content: SHARE_DESC },
    { property: "og:image", content: SHARE_IMAGE },
    { property: "og:image:secure_url", content: SHARE_IMAGE },
    { property: "og:image:type", content: "image/jpeg" },
    { property: "og:image:width", content: "1200" },
    { property: "og:image:height", content: "630" },
    { property: "og:image:alt", content: "Sportagon Trophy Catalogue" },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: SHARE_TITLE },
    { name: "twitter:description", content: SHARE_DESC },
    { name: "twitter:image", content: SHARE_IMAGE },
  ],
  links: [{ rel: "canonical", href: SITE }],
});

export function CatalogueError() {
  return (
    <div className="grid min-h-dvh place-items-center p-6 text-center text-sm text-muted-foreground">
      The catalogue is being updated. Please check back soon.
    </div>
  );
}

const inr = (n: number) => "₹" + Number(n).toLocaleString("en-IN", { maximumFractionDigits: 0 });

/** The public trophy catalogue page body (used on catalogue.sportagon.in and /catalogue). */
export function CatalogueView({ data }: { data: CatalogueData }) {
  const [q, setQ] = useState("");
  const [g, setG] = useState("");
  const [lb, setLb] = useState<{ item: CatalogueItem; i: number; size: number } | null>(null);
  const groups = useMemo(() => [...new Set(data.items.map((x) => x.group))], [data.items]);
  const list = data.items.filter(
    (x) =>
      (!g || x.group === g) &&
      (!q.trim() ||
        `${x.code} ${x.name} ${x.description} ${x.variants.map((v) => `${v.sku} ${v.label}`).join(" ")}`
          .toLowerCase()
          .includes(q.trim().toLowerCase())),
  );
  return (
    <div className="min-h-dvh bg-background">
      <header className="bg-hero text-white" style={{ paddingTop: "env(safe-area-inset-top)" }}>
        <div className="mx-auto flex max-w-6xl flex-col-reverse gap-5 px-4 py-7 sm:flex-row sm:items-center sm:justify-between sm:gap-8 sm:py-10">
          <div className="grid min-w-0 gap-2">
            <h1 className="heading text-3xl sm:text-5xl">Trophy catalogue</h1>
            <p className="max-w-xl text-sm opacity-85">
              Trophies, medals and mementos for tournaments, schools and corporate events. Quote the
              product code when you enquire.
            </p>
          </div>
          <img
            src={LOGO_WHITE}
            alt="Sportagon"
            width={799}
            height={160}
            className="h-8 w-auto max-w-[55vw] shrink-0 self-start object-contain sm:h-11 sm:self-center"
          />
        </div>
      </header>
      <div
        className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur"
        style={{ paddingTop: "env(safe-area-inset-top)" }}
      >
        <div className="mx-auto grid max-w-6xl gap-2.5 px-4 py-3">
          <label className="relative">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <span className="sr-only">Search by code or name</span>
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search by code or name"
              className="h-11 w-full rounded-full border bg-card pl-10 pr-4 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </label>
          {groups.length > 1 && (
            <div
              className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none]"
              role="group"
              aria-label="Type"
            >
              {["", ...groups].map((x) => (
                <button
                  key={x || "all"}
                  onClick={() => setG(x)}
                  aria-pressed={g === x}
                  className={cn(
                    "shrink-0 rounded-full border px-3.5 py-2 text-[11.5px] font-bold uppercase tracking-wide text-muted-foreground",
                    g === x && "border-primary bg-primary text-primary-foreground",
                  )}
                >
                  {x || "All"}{" "}
                  <span className="opacity-70">
                    {x ? data.items.filter((i) => i.group === x).length : data.items.length}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <main className="mx-auto grid max-w-6xl gap-4 px-4 py-5">
        <p className="text-xs text-muted-foreground">
          {list.length === data.items.length
            ? `${data.items.length} products`
            : `${list.length} of ${data.items.length} products`}{" "}
          · Prices in INR
        </p>
        {!data.items.length ? (
          <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
            The catalogue is being updated. Please check back soon.
          </div>
        ) : !list.length ? (
          <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
            No trophies match “{q}”. Try a product code like TC-1001 or a word from the name.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 min-[341px]:grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 lg:gap-4">
            {list.map((it) => (
              <ItemCard key={it.code} it={it} onOpen={(i, size) => setLb({ item: it, i, size })} />
            ))}
          </div>
        )}
      </main>
      <footer
        className="border-t bg-card pb-20"
        style={{ paddingBottom: "calc(5rem + env(safe-area-inset-bottom))" }}
      >
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:grid-cols-[1.3fr_1fr_1fr] sm:gap-10">
          <div className="grid content-start gap-3">
            <img
              src={LOGO_BLUE}
              alt="Sportagon"
              width={794}
              height={160}
              loading="lazy"
              className="h-8 w-auto self-start justify-self-start"
            />
            <p className="max-w-sm text-sm text-muted-foreground">
              Trophies, medals and mementos for tournaments, schools and corporate events —
              engraving and custom awards on request.
            </p>
          </div>
          <div className="grid content-start gap-3">
            <h2 className="text-xs font-extrabold uppercase tracking-[0.14em] text-muted-foreground">
              Enquiries
            </h2>
            <ul className="grid gap-2.5 text-sm">
              <li>
                <a
                  href={`tel:${PHONE_E164}`}
                  className="inline-flex items-center gap-2.5 hover:text-primary"
                >
                  <Phone className="size-4 text-primary" /> {PHONE}
                </a>
              </li>
              <li>
                <a
                  href={`https://wa.me/${PHONE_E164.slice(1)}?text=${encodeURIComponent("Hi Sportagon, I'd like a quote for: ")}`}
                  target="_blank"
                  rel="noopener"
                  className="inline-flex items-center gap-2.5 hover:text-primary"
                >
                  <MessageCircle className="size-4 text-primary" /> WhatsApp us
                </a>
              </li>
              <li>
                <a
                  href="mailto:play@sportagon.in"
                  className="inline-flex items-center gap-2.5 hover:text-primary"
                >
                  <Mail className="size-4 text-primary" /> play@sportagon.in
                </a>
              </li>
              <li>
                <a
                  href="https://www.sportagon.in"
                  target="_blank"
                  rel="noopener"
                  className="inline-flex items-center gap-2.5 hover:text-primary"
                >
                  <Globe className="size-4 text-primary" /> www.sportagon.in
                </a>
              </li>
            </ul>
          </div>
          <div className="grid content-start gap-3">
            <h2 className="text-xs font-extrabold uppercase tracking-[0.14em] text-muted-foreground">
              Ordering
            </h2>
            <ul className="grid gap-2 text-sm text-muted-foreground">
              <li>Quote the product code when you enquire.</li>
              <li>Engraving and customisation are quoted separately.</li>
              <li>Prices in INR. Prices and availability may change.</li>
            </ul>
          </div>
        </div>
        <div className="border-t">
          <p className="mx-auto max-w-6xl px-4 py-4 text-xs text-muted-foreground">
            © {new Date().getFullYear()} Sportagon Technologies Pvt. Ltd.
          </p>
        </div>
      </footer>
      {lb && <Lightbox item={lb.item} start={lb.i} size={lb.size} onClose={() => setLb(null)} />}
      <QuoteCart phoneE164={PHONE_E164} />
    </div>
  );
}

function ItemCard({
  it,
  onOpen,
}: {
  it: CatalogueItem;
  onOpen: (i: number, size: number) => void;
}) {
  const track = useRef<HTMLDivElement>(null);
  const [idx, setIdx] = useState(0);
  const [size, setSize] = useState(0);
  const cart = useQuoteCart();
  const v = it.variants[size];
  const inCart = v ? (cart.lines.find((l) => l.sku === v.sku)?.qty ?? 0) : 0;
  const step = (d: number) =>
    track.current?.scrollBy({ left: d * track.current.clientWidth, behavior: "smooth" });
  // Picking a colour or size shows that variant's own photo when it has one.
  const pick = (i: number) => {
    setSize(i);
    const at = photoIndex(it, i);
    const t = track.current;
    if (at >= 0 && t) t.scrollTo({ left: at * t.clientWidth, behavior: "smooth" });
  };
  return (
    <article className="card-lift grid min-w-0 content-start overflow-hidden">
      {it.photos.length ? (
        <div className="group relative border-b bg-white">
          <div
            ref={track}
            className="flex aspect-square snap-x snap-mandatory overflow-x-auto [scrollbar-width:none]"
            onScroll={(e) =>
              setIdx(
                Math.round(e.currentTarget.scrollLeft / Math.max(1, e.currentTarget.clientWidth)),
              )
            }
          >
            {it.photos.map((u, i) => (
              <img
                key={u}
                src={`${u}?w=t`}
                alt={`${it.name} photo ${i + 1}`}
                loading="lazy"
                decoding="async"
                width={480}
                height={480}
                onClick={() => onOpen(i, size)}
                className="h-full w-full flex-[0_0_100%] cursor-zoom-in snap-center bg-white object-contain"
              />
            ))}
          </div>
          <BrandMark size="sm" />
          {it.photos.length > 1 && (
            <>
              <span className="pointer-events-none absolute right-2 top-2 rounded-full bg-[#0B1B3F]/75 px-2 py-0.5 text-[11px] font-bold text-white">
                {it.photos.length} photos
              </span>
              <span className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center gap-1.5">
                {it.photos.map((_, i) => (
                  <i
                    key={i}
                    className={cn(
                      "size-[7px] rounded-full",
                      i === idx ? "bg-primary" : "bg-[#0B1B3F]/25",
                    )}
                  />
                ))}
              </span>
              <button
                onClick={() => step(-1)}
                className="absolute left-2 top-1/2 hidden size-8 -translate-y-1/2 place-items-center rounded-full border bg-white/90 text-[#0B1B3F] opacity-0 transition-opacity group-hover:opacity-100 [@media(hover:hover)]:grid"
                aria-label="Previous photo"
              >
                <ChevronLeft className="size-4" />
              </button>
              <button
                onClick={() => step(1)}
                className="absolute right-2 top-1/2 hidden size-8 -translate-y-1/2 place-items-center rounded-full border bg-white/90 text-[#0B1B3F] opacity-0 transition-opacity group-hover:opacity-100 [@media(hover:hover)]:grid"
                aria-label="Next photo"
              >
                <ChevronRight className="size-4" />
              </button>
            </>
          )}
        </div>
      ) : (
        <div className="grid aspect-square place-items-center content-center gap-1 border-b bg-muted p-4 text-center text-xs text-muted-foreground">
          <img src={LOGO_MARK} alt="" loading="lazy" className="mx-auto size-10 opacity-30" />
          Photo coming soon
        </div>
      )}
      <div className="grid min-w-0 gap-1.5 p-3 sm:p-4">
        <div className="flex flex-wrap items-start justify-between gap-1.5">
          <span className="code-tag rounded-md bg-accent/20 px-2 py-0.5 text-xs text-accent-foreground dark:text-accent">
            {it.code}
          </span>
          <span className="whitespace-nowrap text-base font-extrabold tabular-nums sm:text-lg">
            {inr(priceOf(it, size))}
          </span>
        </div>
        <div className="grid min-w-0 gap-0.5">
          <h3 className="wrap-any text-[14.5px] font-bold leading-snug sm:text-base">{it.name}</h3>
          {variantCaption(it, size) && (
            <span className="text-[12px] text-muted-foreground" aria-live="polite">
              {variantCaption(it, size)}
            </span>
          )}
        </div>
        <SizePicker it={it} sel={size} onSel={pick} />
        {usefulDescription(it) && (
          <p className="wrap-any line-clamp-3 text-[12.5px] text-muted-foreground sm:text-[13px]">
            {it.description}
          </p>
        )}
        {v && (
          <button
            type="button"
            onClick={() =>
              cart.add({ sku: v.sku, code: it.code, name: it.name, size: v.label, price: v.price })
            }
            className={cn(
              "mt-1 inline-flex w-full items-center justify-center gap-1.5 rounded-full border px-3 py-2 text-[12.5px] font-bold",
              inCart
                ? "border-primary bg-primary/10 text-primary"
                : "border-primary text-primary hover:bg-primary hover:text-primary-foreground",
            )}
          >
            <Plus className="size-3.5" />
            {inCart ? `${inCart} in quote · add` : "Add to quote"}
          </button>
        )}
      </div>
    </article>
  );
}

const priceOf = (it: CatalogueItem, i: number) => it.variants[i]?.price ?? it.price;
/** Hide descriptions that only repeat the type ("Medal") or a size/colour. */
const usefulDescription = (it: CatalogueItem) => {
  const d = it.description.trim().toLowerCase();
  if (!d || d === it.group.toLowerCase() || d === it.name.toLowerCase()) return false;
  return !it.variants.some((v) => d.endsWith(v.label.toLowerCase()) && v.label);
};
const photoIndex = (it: CatalogueItem, i: number) => {
  const p = it.variants[i]?.photo;
  return p ? it.photos.indexOf(p) : -1;
};

/** What's selected, in words: "3in · Gold". */
const variantCaption = (it: CatalogueItem, i: number) => {
  const v = it.variants[i];
  if (!v) return "";
  return [v.size, v.colour].filter(Boolean).join(" · ") || v.label;
};

/**
 * Compact variant choice: colour dots and size chips on one wrapping row. Sizes not made in the
 * chosen colour are dimmed (picking one switches to a colour that has it).
 */
function SizePicker({
  it,
  sel,
  onSel,
  dark,
}: {
  it: CatalogueItem;
  sel: number;
  onSel: (i: number) => void;
  dark?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const vs = it.variants;
  const cur = vs[sel] ?? vs[0];
  if (!cur || vs.length < 2) return null;
  const ax = variantAxes(vs);
  const byColour = ax.colours.length > 1;
  const sizes = byColour ? ax.sizes : vs.map((v) => v.label);
  const many = !byColour && sizes.length > 6;
  const chip = (on: boolean, dim: boolean) =>
    cn(
      "min-w-9 rounded-md border px-2 py-0.5 text-center text-[11.5px] font-semibold tabular-nums transition-colors",
      on
        ? dark
          ? "border-white bg-white text-[#0B1B3F]"
          : "border-primary bg-primary text-primary-foreground"
        : dark
          ? "border-white/30 text-white hover:border-white"
          : "bg-card hover:border-primary",
      dim && !on && "opacity-40",
    );
  const sizeChips = (
    <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Size">
      {byColour
        ? ax.sizes.map((s) => {
            const exists = ax.find(s, cur.colour) >= 0;
            return (
              <button
                key={s || "one"}
                type="button"
                role="radio"
                aria-checked={cur.size === s}
                title={exists ? s : `${s} — not in ${cur.colour}`}
                onClick={() => onSel(ax.choose(sel, { size: s }))}
                className={chip(cur.size === s, !exists)}
              >
                {s || "One size"}
              </button>
            );
          })
        : vs.map((v, i) => (
            <button
              key={v.sku}
              type="button"
              role="radio"
              aria-checked={i === sel}
              onClick={() => {
                onSel(i);
                setOpen(false);
              }}
              className={chip(i === sel, false)}
            >
              {v.label}
            </button>
          ))}
    </div>
  );
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      {byColour && (
        <div className="flex items-center gap-1.5" role="radiogroup" aria-label="Colour">
          {ax.colours.map((c) => {
            const on = cur.colour === c;
            return (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={on}
                aria-label={c}
                title={c}
                onClick={() => onSel(ax.choose(sel, { colour: c }))}
                className={cn(
                  "size-6 shrink-0 rounded-full ring-1 ring-black/15 transition-shadow",
                  on &&
                    (dark
                      ? "ring-2 ring-white ring-offset-2 ring-offset-[#050B1C]"
                      : "ring-2 ring-primary ring-offset-2 ring-offset-card"),
                )}
                style={{ background: swatchOf(c) }}
              />
            );
          })}
        </div>
      )}
      {(byColour ? ax.sizes.length > 1 : true) &&
        (many ? (
          <div className="grid gap-1.5">
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              className={chip(false, false) + " inline-flex items-center gap-1"}
            >
              {vs.length} sizes
              <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
            </button>
            {open && sizeChips}
          </div>
        ) : (
          sizeChips
        ))}
    </div>
  );
}

function Lightbox({
  item,
  start,
  size: size0,
  onClose,
}: {
  item: CatalogueItem;
  start: number;
  size: number;
  onClose: () => void;
}) {
  const [size, setSize] = useState(size0);
  const track = useRef<HTMLDivElement>(null);
  const [i, setI] = useState(start);
  useEffect(() => {
    const t = track.current;
    if (t) t.scrollLeft = start * t.clientWidth;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") t?.scrollBy({ left: t.clientWidth, behavior: "smooth" });
      if (e.key === "ArrowLeft") t?.scrollBy({ left: -t.clientWidth, behavior: "smooth" });
    };
    window.addEventListener("keydown", key);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", key);
    };
  }, [start, onClose]);
  const step = (d: number) =>
    track.current?.scrollBy({ left: d * track.current.clientWidth, behavior: "smooth" });
  return (
    <div
      className="fixed inset-0 z-50 grid grid-rows-[auto_1fr_auto] bg-[#050B1C] text-white"
      role="dialog"
      aria-modal="true"
      aria-label={`${item.name} photos`}
    >
      <div
        className="flex items-center justify-between gap-3 px-4 py-3"
        style={{ paddingTop: "max(.75rem, env(safe-area-inset-top))" }}
      >
        <span className="code-tag rounded-md bg-white/10 px-2 py-0.5 text-sm text-accent">
          {item.code}
        </span>
        <span className="text-sm opacity-80">
          {item.photos.length > 1 ? `${i + 1} / ${item.photos.length}` : ""}
        </span>
        <button
          onClick={onClose}
          className="grid size-10 place-items-center rounded-full bg-white/10"
          aria-label="Close"
          autoFocus
        >
          <X className="size-5" />
        </button>
      </div>
      <div className="relative grid min-h-0">
        <div
          ref={track}
          className="flex min-h-0 snap-x snap-mandatory overflow-x-auto [scrollbar-width:none]"
          onScroll={(e) =>
            setI(Math.round(e.currentTarget.scrollLeft / Math.max(1, e.currentTarget.clientWidth)))
          }
          onClick={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
        >
          {item.photos.map((u, k) => (
            <img
              key={u}
              src={u}
              alt={`${item.name} photo ${k + 1}`}
              className="h-full w-full flex-[0_0_100%] snap-center object-contain p-2"
            />
          ))}
        </div>
        <BrandMark size="md" className="bottom-3 right-3" />
        {item.photos.length > 1 && (
          <>
            <button
              onClick={() => step(-1)}
              className="absolute left-3 top-1/2 grid size-11 -translate-y-1/2 place-items-center rounded-full border border-white/20 bg-white/15"
              aria-label="Previous photo"
            >
              <ChevronLeft className="size-5" />
            </button>
            <button
              onClick={() => step(1)}
              className="absolute right-3 top-1/2 grid size-11 -translate-y-1/2 place-items-center rounded-full border border-white/20 bg-white/15"
              aria-label="Next photo"
            >
              <ChevronRight className="size-5" />
            </button>
          </>
        )}
      </div>
      <div
        className="flex items-center justify-between gap-3 px-4 py-3"
        style={{ paddingBottom: "max(.875rem, env(safe-area-inset-bottom))" }}
      >
        <span className="grid min-w-0 gap-1.5">
          <span className="wrap-any font-bold">
            <span className="code-tag mr-2 text-xs opacity-80">{item.code}</span>
            {item.name}
            {variantCaption(item, size) && (
              <span className="ml-2 text-sm font-normal opacity-75">
                {variantCaption(item, size)}
              </span>
            )}
          </span>
          <SizePicker
            it={item}
            sel={size}
            onSel={(k) => {
              setSize(k);
              const at = photoIndex(item, k);
              const t = track.current;
              if (at >= 0 && t) t.scrollTo({ left: at * t.clientWidth, behavior: "smooth" });
            }}
            dark
          />
        </span>
        <span className="whitespace-nowrap text-lg font-extrabold">{inr(priceOf(item, size))}</span>
      </div>
    </div>
  );
}
