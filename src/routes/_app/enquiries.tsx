import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, Copy, MessageCircle, Phone, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { inr, type QuoteRequest } from "@/lib/domain";
import { useInvalidate, useQuotes } from "@/lib/data";
import type { QuoteItem } from "@/lib/quote.functions";
import { Empty, Field, PageHead, Pill, Select, TextArea } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Search = { sel?: string | undefined; status?: string | undefined };
export const Route = createFileRoute("/_app/enquiries")({
  head: () => ({ meta: [{ title: "Enquiries · Sportagon Stockroom" }] }),
  validateSearch: (s: Record<string, unknown>): Search => ({
    sel: typeof s["sel"] === "string" ? s["sel"] : undefined,
    status: typeof s["status"] === "string" ? s["status"] : undefined,
  }),
  component: EnquiriesPage,
});

const STATUSES = ["new", "contacted", "quoted", "won", "lost"] as const;
const TONE: Record<string, "warn" | "info" | "ok" | "bad" | "mute"> = {
  new: "warn",
  contacted: "info",
  quoted: "info",
  won: "ok",
  lost: "mute",
};
const itemsOf = (q: QuoteRequest) =>
  Array.isArray(q.items) ? (q.items as unknown as QuoteItem[]) : [];

function EnquiriesPage() {
  const search = Route.useSearch();
  const nav = Route.useNavigate();
  const set = (p: Partial<Search>) =>
    nav({ search: (s: Search) => ({ ...s, ...p }), replace: true });
  const quotes = useQuotes();
  const all = quotes.data ?? [];
  const list = all.filter((q) =>
    search.status ? q.status === search.status : q.status !== "lost",
  );
  const sel = search.sel ? all.find((q) => q.id === search.sel) : undefined;
  const won = all.filter((q) => q.status === "won");
  const open = all.filter((q) => !["won", "lost"].includes(q.status));
  return (
    <>
      <PageHead
        title="Enquiries"
        lede="Quote requests from the public catalogue. Call or WhatsApp, then move each one along until it's won or lost."
      />
      <div className="flex flex-wrap gap-1.5">
        {STATUSES.map((st) => {
          const n = all.filter((q) => q.status === st).length;
          return (
            <button key={st} onClick={() => set({ status: search.status === st ? undefined : st })}>
              <Pill
                tone={search.status === st ? "brand" : (TONE[st] ?? "mute")}
                className="cursor-pointer capitalize"
              >
                {st} · {n}
              </Pill>
            </button>
          );
        })}
        <Pill>
          open pipeline {inr(Math.round(open.reduce((a, q) => a + Number(q.est_total ?? 0), 0)))}
        </Pill>
        {won.length > 0 && (
          <Pill tone="ok">
            won {inr(Math.round(won.reduce((a, q) => a + Number(q.est_total ?? 0), 0)))}
          </Pill>
        )}
      </div>
      <div
        className={cn(
          "grid items-start gap-5",
          sel && "lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]",
        )}
      >
        <div className="grid min-w-0 gap-2">
          {quotes.isLoading ? (
            <Empty>Loading…</Empty>
          ) : !list.length ? (
            <Empty>
              No enquiries {search.status ? `marked ${search.status}` : "yet"}. They arrive from
              “Request quote” on the catalogue.
            </Empty>
          ) : (
            list.map((q) => {
              const items = itemsOf(q);
              return (
                <button
                  key={q.id}
                  onClick={() => set({ sel: q.id })}
                  className={cn(
                    "panel grid gap-1 p-3 text-left hover:border-primary",
                    sel?.id === q.id && "ring-2 ring-accent",
                  )}
                >
                  <span className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span>
                      {q.ref} ·{" "}
                      {new Date(q.created_at).toLocaleString("en-IN", {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </span>
                    <Pill tone={TONE[q.status] ?? "mute"} className="capitalize">
                      {q.status}
                    </Pill>
                  </span>
                  <span className="flex flex-wrap items-baseline justify-between gap-2">
                    <strong className="wrap-any text-sm">
                      {q.name}
                      {q.organisation ? ` · ${q.organisation}` : ""}
                    </strong>
                    <span className="text-sm font-bold tabular-nums">
                      {inr(Number(q.est_total ?? 0))}
                    </span>
                  </span>
                  <span className="wrap-any text-xs text-muted-foreground">
                    {items.reduce((a, i) => a + i.qty, 0)} pcs ·{" "}
                    {items.map((i) => i.code).join(", ")}
                    {q.needed_by ? ` · needed by ${q.needed_by}` : ""}
                  </span>
                </button>
              );
            })
          )}
        </div>
        {sel && (
          <EnquiryPanel
            key={sel.id + sel.updated_at}
            q={sel}
            onClose={() => set({ sel: undefined })}
          />
        )}
      </div>
    </>
  );
}

function EnquiryPanel({ q, onClose }: { q: QuoteRequest; onClose: () => void }) {
  const { canContribute, email } = useAuth();
  const inv = useInvalidate();
  const items = itemsOf(q);
  const [notes, setNotes] = useState(q.internal_notes ?? "");
  const phone = q.phone.replace(/[^\d+]/g, "");
  const waNum = phone
    .replace(/\D/g, "")
    .replace(/^0/, "")
    .replace(/^(\d{10})$/, "91$1");
  const quoteText = [
    `Hi ${q.name}, thank you for your enquiry (${q.ref}) with Sportagon.`,
    ...items.map(
      (i) =>
        `• ${i.code} ${i.name}${i.size ? ` (${i.size})` : ""} × ${i.qty} @ ${inr(i.price)} = ${inr(i.qty * i.price)}`,
    ),
    `Total (list price): ${inr(Number(q.est_total ?? 0))}`,
  ].join("\n");

  async function save(patch: Partial<QuoteRequest>, msg: string) {
    const { error } = await supabase
      .from("quote_requests")
      .update({ ...patch, handled_by_email: email, updated_at: new Date().toISOString() })
      .eq("id", q.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(msg);
    await inv("quotes");
  }
  return (
    <aside
      className="panel fixed inset-0 z-40 grid content-start gap-4 overflow-y-auto p-4 lg:sticky lg:inset-auto lg:top-20 lg:z-0 lg:max-h-[calc(100dvh-6rem)] lg:p-5"
      style={{
        paddingTop: "max(1rem, env(safe-area-inset-top))",
        paddingBottom: "max(1.5rem, env(safe-area-inset-bottom))",
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">
            {q.ref} ·{" "}
            {new Date(q.created_at).toLocaleString("en-IN", {
              dateStyle: "medium",
              timeStyle: "short",
            })}
          </p>
          <h3 className="wrap-any text-lg font-bold">{q.name}</h3>
          <p className="wrap-any text-sm text-muted-foreground">
            {[q.organisation, q.city].filter(Boolean).join(" · ") || "—"}
          </p>
        </div>
        <Button size="icon" variant="ghost" className="shrink-0 rounded-full" onClick={onClose}>
          <ArrowLeft className="size-4 lg:hidden" />
          <X className="hidden size-4 lg:block" />
        </Button>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" className="rounded-full" asChild>
          <a href={`tel:${phone}`}>
            <Phone className="size-4" /> {q.phone}
          </a>
        </Button>
        <Button size="sm" variant="outline" className="rounded-full" asChild>
          <a
            href={`https://wa.me/${waNum}?text=${encodeURIComponent(quoteText)}`}
            target="_blank"
            rel="noopener"
          >
            <MessageCircle className="size-4" /> WhatsApp quote
          </a>
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="rounded-full"
          onClick={() =>
            navigator.clipboard?.writeText(quoteText).then(() => toast.success("Quote copied"))
          }
        >
          <Copy className="size-4" /> Copy
        </Button>
        {q.email && (
          <Button size="sm" variant="ghost" className="rounded-full" asChild>
            <a
              href={`mailto:${q.email}?subject=${encodeURIComponent(`Your Sportagon quote ${q.ref}`)}&body=${encodeURIComponent(quoteText)}`}
            >
              {q.email}
            </a>
          </Button>
        )}
      </div>
      <section className="grid gap-1.5">
        <h4 className="text-xs font-extrabold uppercase tracking-[0.1em] text-muted-foreground">
          Requested
        </h4>
        {items.map((i) => (
          <div
            key={i.sku}
            className="flex flex-wrap items-baseline gap-x-2 rounded-lg border px-2.5 py-1.5 text-sm"
          >
            <span className="font-mono text-xs">{i.sku}</span>
            <span className="wrap-any min-w-0 flex-1">
              {i.name}
              {i.size ? ` · ${i.size}` : ""}
            </span>
            <span className="tabular-nums">
              {i.qty} × {inr(i.price)} = <b>{inr(i.qty * i.price)}</b>
            </span>
          </div>
        ))}
        <div className="flex justify-between text-sm font-extrabold">
          <span>List total</span>
          <span className="tabular-nums">{inr(Number(q.est_total ?? 0))}</span>
        </div>
        {q.needed_by && (
          <p className="text-sm">
            Needed by <b>{q.needed_by}</b>
          </p>
        )}
        {q.notes && <p className="wrap-any rounded-lg bg-muted p-2.5 text-sm">“{q.notes}”</p>}
      </section>
      <section className="grid gap-3">
        <Field label="Status">
          <Select
            disabled={!canContribute}
            value={q.status}
            onChange={(e) => save({ status: e.target.value }, `Marked ${e.target.value}`)}
          >
            {STATUSES.map((s) => (
              <option key={s} value={s} className="capitalize">
                {s}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Internal notes"
          hint={q.handled_by_email ? `Last updated by ${q.handled_by_email}` : undefined}
        >
          <TextArea
            className="min-h-20 font-sans"
            disabled={!canContribute}
            value={notes}
            placeholder="Discount offered, engraving details, follow-up date…"
            onChange={(e) => setNotes(e.target.value)}
            onBlur={() => {
              if (notes !== (q.internal_notes ?? ""))
                save({ internal_notes: notes || null }, "Notes saved");
            }}
          />
        </Field>
      </section>
    </aside>
  );
}
