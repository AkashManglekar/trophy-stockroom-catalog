import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import type { CatalogueData, CatalogueItem } from "@/lib/catalogue.functions";
import { cn } from "@/lib/utils";
import { LOGO_BLUE, LOGO_MARK, LOGO_WHITE } from "@/lib/domain";

export const catalogueHead = () => ({
  meta: [
    { title: "Sportagon Trophy Catalogue" },
    {
      name: "description",
      content:
        "Trophies, medals and mementos for tournaments, schools and corporate events. Browse codes, prices and photos.",
    },
    { property: "og:title", content: "Sportagon Trophy Catalogue" },
    {
      property: "og:description",
      content: "Trophies, medals and mementos for tournaments, schools and corporate events.",
    },
    { property: "og:type", content: "website" },
  ],
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
  const [lb, setLb] = useState<{ item: CatalogueItem; i: number } | null>(null);
  const groups = useMemo(() => [...new Set(data.items.map((x) => x.group))], [data.items]);
  const list = data.items.filter(
    (x) =>
      (!g || x.group === g) &&
      (!q.trim() ||
        `${x.code} ${x.name} ${x.description}`.toLowerCase().includes(q.trim().toLowerCase())),
  );
  return (
    <div className="min-h-dvh bg-background">
      <header className="bg-hero text-white" style={{ paddingTop: "env(safe-area-inset-top)" }}>
        <div className="mx-auto grid max-w-6xl gap-2 px-4 py-7 sm:py-9">
          <img
            src={LOGO_WHITE}
            alt="Sportagon"
            width={799}
            height={160}
            className="h-9 w-auto max-w-[60vw] object-contain object-left sm:h-11"
          />
          <h1 className="heading text-3xl sm:text-5xl">Trophy catalogue</h1>
          <p className="max-w-xl text-sm opacity-85">
            Trophies, medals and mementos for tournaments, schools and corporate events. Quote the
            product code when you enquire.
          </p>
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
              <ItemCard key={it.code} it={it} onOpen={(i) => setLb({ item: it, i })} />
            ))}
          </div>
        )}
      </main>
      <footer className="border-t bg-card" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
        <div className="mx-auto grid max-w-6xl gap-4 px-4 py-6 sm:grid-cols-2">
          <div>
            <img
              src={LOGO_BLUE}
              alt="Sportagon"
              width={794}
              height={160}
              loading="lazy"
              className="h-7 w-auto"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Prices and availability may change. Engraving and customisation are quoted separately.
            </p>
          </div>
          <div className="grid gap-1 text-sm">
            <strong className="text-sm font-extrabold uppercase tracking-wider">Enquiries</strong>
            <span className="select-all">play@sportagon.in</span>
            <span className="select-all">+91 83088 84539</span>
            <span className="select-all">www.sportagon.in</span>
          </div>
        </div>
      </footer>
      {lb && <Lightbox item={lb.item} start={lb.i} onClose={() => setLb(null)} />}
    </div>
  );
}

function ItemCard({ it, onOpen }: { it: CatalogueItem; onOpen: (i: number) => void }) {
  const track = useRef<HTMLDivElement>(null);
  const [idx, setIdx] = useState(0);
  const step = (d: number) =>
    track.current?.scrollBy({ left: d * track.current.clientWidth, behavior: "smooth" });
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
                src={u}
                alt={`${it.name} photo ${i + 1}`}
                loading="lazy"
                onClick={() => onOpen(i)}
                className="h-full w-full flex-[0_0_100%] cursor-zoom-in snap-center bg-white object-contain"
              />
            ))}
          </div>
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
            {inr(it.price)}
          </span>
        </div>
        <h3 className="wrap-any text-[14.5px] font-bold leading-snug sm:text-base">{it.name}</h3>
        {it.description && (
          <p className="wrap-any text-[12.5px] text-muted-foreground sm:text-[13.5px]">
            {it.description}
          </p>
        )}
      </div>
    </article>
  );
}

function Lightbox({
  item,
  start,
  onClose,
}: {
  item: CatalogueItem;
  start: number;
  onClose: () => void;
}) {
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
        <span className="wrap-any min-w-0 font-bold">{item.name}</span>
        <span className="whitespace-nowrap text-lg font-extrabold">{inr(item.price)}</span>
      </div>
    </div>
  );
}
