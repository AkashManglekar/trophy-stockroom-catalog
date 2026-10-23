import { useState, useSyncExternalStore } from "react";
import { CheckCircle2, MessageCircle, Minus, Plus, Trash2, X } from "lucide-react";
import { submitQuote } from "@/lib/quote.functions";
import { cn } from "@/lib/utils";

export type CartLine = {
  sku: string;
  code: string;
  name: string;
  size: string;
  price: number;
  qty: number;
};

const KEY = "sportagon-quote-v1";
const EVT = "sportagon-quote";
let cache: CartLine[] | null = null;
function read(): CartLine[] {
  if (cache) return cache;
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(KEY) : null;
    cache = raw ? (JSON.parse(raw) as CartLine[]) : [];
  } catch {
    cache = [];
  }
  return cache;
}
function write(next: CartLine[]) {
  cache = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* private mode — cart still works for this visit */
  }
  window.dispatchEvent(new Event(EVT));
}
const EMPTY: CartLine[] = [];
function subscribe(cb: () => void) {
  window.addEventListener(EVT, cb);
  return () => window.removeEventListener(EVT, cb);
}

/** The visitor's quote list (kept on their device). */
export function useQuoteCart() {
  const lines = useSyncExternalStore(subscribe, read, () => EMPTY);
  return {
    lines,
    count: lines.reduce((a, l) => a + l.qty, 0),
    total: lines.reduce((a, l) => a + l.qty * l.price, 0),
    add(l: Omit<CartLine, "qty">, qty = 1) {
      const cur = read();
      const hit = cur.find((x) => x.sku === l.sku);
      write(
        hit
          ? cur.map((x) => (x.sku === l.sku ? { ...x, qty: x.qty + qty } : x))
          : [...cur, { ...l, qty }],
      );
    },
    setQty(sku: string, qty: number) {
      write(
        read().map((x) => (x.sku === sku ? { ...x, qty: Math.max(1, Math.min(100000, qty)) } : x)),
      );
    },
    remove(sku: string) {
      write(read().filter((x) => x.sku !== sku));
    },
    clear() {
      write([]);
    },
  };
}

const inr = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");

/** Floating "Your quote" bar and the request form. */
export function QuoteCart({ phoneE164 }: { phoneE164: string }) {
  const cart = useQuoteCart();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({
    name: "",
    phone: "",
    email: "",
    organisation: "",
    city: "",
    needed_by: "",
    notes: "",
    website: "",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState<{ ref: string; text: string } | null>(null);

  const message = (ref?: string) =>
    [
      `Hi Sportagon, I'd like a quote${ref ? ` (ref ${ref})` : ""}:`,
      ...cart.lines.map((l) => `• ${l.code} ${l.name}${l.size ? ` (${l.size})` : ""} × ${l.qty}`),
      f.organisation ? `For: ${f.organisation}` : "",
      f.needed_by ? `Needed by: ${f.needed_by}` : "",
      f.notes ? `Notes: ${f.notes}` : "",
      f.name ? `— ${f.name}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  const wa = (text: string) =>
    `https://wa.me/${phoneE164.replace(/\D/g, "")}?text=${encodeURIComponent(text)}`;

  async function send() {
    setErr("");
    setBusy(true);
    try {
      const r = await submitQuote({
        data: { ...f, items: cart.lines.map((l) => ({ sku: l.sku, qty: l.qty })) },
      });
      setDone({ ref: r.ref, text: message(r.ref) });
      cart.clear();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't send — please try again");
    } finally {
      setBusy(false);
    }
  }

  if (!cart.lines.length && !done) return null;
  return (
    <>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed inset-x-3 z-30 mx-auto flex max-w-md items-center justify-between gap-3 rounded-full bg-primary px-5 py-3 text-primary-foreground shadow-xl"
          style={{ bottom: "max(12px, env(safe-area-inset-bottom))" }}
        >
          <span className="text-sm font-bold">
            Your quote · {cart.count} piece{cart.count === 1 ? "" : "s"}
          </span>
          <span className="text-sm font-extrabold tabular-nums">{inr(cart.total)} · Review</span>
        </button>
      )}
      {open && (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-[#050B1C]/50"
          onClick={() => setOpen(false)}
          role="dialog"
          aria-label="Your quote"
        >
          <div
            className="grid h-full w-full max-w-md content-start gap-4 overflow-y-auto bg-background p-4 shadow-2xl sm:p-5"
            style={{
              paddingTop: "max(1rem, env(safe-area-inset-top))",
              paddingBottom: "max(1.5rem, env(safe-area-inset-bottom))",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-2">
              <h2 className="heading text-xl">{done ? "Request sent" : "Your quote"}</h2>
              <button
                className="rounded-full p-2 hover:bg-muted"
                onClick={() => setOpen(false)}
                aria-label="Close"
              >
                <X className="size-5" />
              </button>
            </div>

            {done ? (
              <div className="grid gap-3 text-sm">
                <p className="flex items-center gap-2 font-semibold text-success">
                  <CheckCircle2 className="size-5" /> Thanks! Your request {done.ref} is with our
                  team.
                </p>
                <p className="text-muted-foreground">
                  We'll call or WhatsApp you shortly with prices for your quantities, engraving and
                  delivery. Want to speed it up? Send it on WhatsApp too.
                </p>
                <a
                  href={wa(done.text)}
                  target="_blank"
                  rel="noopener"
                  className="inline-flex items-center justify-center gap-2 rounded-full bg-[#25D366] px-4 py-2.5 font-bold text-white"
                >
                  <MessageCircle className="size-4" /> Send on WhatsApp
                </a>
                <button
                  className="text-sm text-primary underline-offset-2 hover:underline"
                  onClick={() => {
                    setDone(null);
                    setOpen(false);
                  }}
                >
                  Back to catalogue
                </button>
              </div>
            ) : (
              <>
                <ul className="grid gap-2">
                  {cart.lines.map((l) => (
                    <li key={l.sku} className="grid gap-1.5 rounded-xl border p-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <span className="font-mono text-xs text-muted-foreground">{l.code}</span>
                          <p className="wrap-any text-sm font-bold">
                            {l.name}
                            {l.size ? (
                              <span className="font-normal text-muted-foreground"> · {l.size}</span>
                            ) : null}
                          </p>
                        </div>
                        <button
                          className="p-1 text-muted-foreground hover:text-destructive"
                          onClick={() => cart.remove(l.sku)}
                          aria-label={`Remove ${l.name}`}
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <div className="inline-flex items-center rounded-full border">
                          <button
                            className="p-2"
                            onClick={() => cart.setQty(l.sku, l.qty - 1)}
                            aria-label="Fewer"
                          >
                            <Minus className="size-3.5" />
                          </button>
                          <input
                            inputMode="numeric"
                            className="w-14 bg-transparent text-center text-sm font-semibold tabular-nums outline-none"
                            value={l.qty}
                            onChange={(e) =>
                              cart.setQty(l.sku, Number(e.target.value.replace(/\D/g, "")) || 1)
                            }
                            aria-label="Quantity"
                          />
                          <button
                            className="p-2"
                            onClick={() => cart.setQty(l.sku, l.qty + 1)}
                            aria-label="More"
                          >
                            <Plus className="size-3.5" />
                          </button>
                        </div>
                        <span className="text-sm tabular-nums">
                          {inr(l.price)} × {l.qty} = <b>{inr(l.price * l.qty)}</b>
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
                <div className="flex justify-between border-t pt-2 text-sm">
                  <span>Estimate (list price)</span>
                  <b className="tabular-nums">{inr(cart.total)}</b>
                </div>
                <p className="-mt-2 text-xs text-muted-foreground">
                  Bulk, engraving and delivery are quoted by our team.
                </p>
                <div className="grid gap-2.5">
                  {(
                    [
                      ["name", "Your name *", "text"],
                      ["phone", "Phone / WhatsApp *", "tel"],
                      ["organisation", "School, club or company", "text"],
                      ["email", "Email", "email"],
                      ["city", "City", "text"],
                      ["needed_by", "Needed by", "date"],
                    ] as const
                  ).map(([k, label, type]) => (
                    <label key={k} className="grid gap-1">
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        {label}
                      </span>
                      <input
                        type={type}
                        value={f[k]}
                        onChange={(e) => setF({ ...f, [k]: e.target.value })}
                        className="h-11 rounded-lg border bg-card px-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      />
                    </label>
                  ))}
                  <label className="grid gap-1">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Event, engraving text or anything else
                    </span>
                    <textarea
                      rows={3}
                      value={f.notes}
                      onChange={(e) => setF({ ...f, notes: e.target.value })}
                      className="rounded-lg border bg-card px-3 py-2 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                  </label>
                  <input
                    tabIndex={-1}
                    autoComplete="off"
                    aria-hidden="true"
                    className="hidden"
                    value={f.website}
                    onChange={(e) => setF({ ...f, website: e.target.value })}
                  />
                </div>
                {err && <p className="text-sm text-destructive">{err}</p>}
                <button
                  disabled={busy}
                  onClick={send}
                  className={cn(
                    "rounded-full bg-primary px-4 py-3 font-bold uppercase tracking-wide text-primary-foreground",
                    busy && "opacity-60",
                  )}
                >
                  {busy ? "Sending…" : "Request quote"}
                </button>
                <a
                  href={wa(message())}
                  target="_blank"
                  rel="noopener"
                  className="text-center text-sm text-primary underline-offset-2 hover:underline"
                >
                  or send this list on WhatsApp
                </a>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
