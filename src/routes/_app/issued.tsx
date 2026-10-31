import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Download, Plus, Shirt, Trash2, Undo2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import {
  ISSUE_PURPOSES,
  inr,
  num,
  today,
  type Family,
  type Product,
  type RefData,
  type StockIssue,
} from "@/lib/domain";
import {
  designCode,
  errMsg,
  useFamilies,
  useInvalidate,
  useIssues,
  useProducts,
  useRefData,
  variantLabel,
} from "@/lib/data";
import {
  Card,
  CardTitle,
  Code,
  Empty,
  Field,
  Notice,
  PageHead,
  Pill,
  Select,
  TextInput,
} from "@/components/kit";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/issued")({
  head: () => ({ meta: [{ title: "Issued stock · Sportagon Stockroom" }] }),
  validateSearch: (s: Record<string, unknown>): { issue?: string | undefined } => ({
    issue: typeof s["issue"] === "string" ? s["issue"] : undefined,
  }),
  component: IssuedPage,
});

const month = (d: string | null | undefined) => String(d ?? "").slice(0, 7);
const fmt = (d: string) =>
  new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

function IssuedPage() {
  const { canPublish } = useAuth();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const ref = useRefData();
  const products = useProducts();
  const families = useFamilies();
  const issues = useIssues();
  const [open, setOpen] = useState(!!search.issue);
  const [q, setQ] = useState("");
  const [purpose, setPurpose] = useState("");

  const fams = useMemo(() => families.data ?? [], [families.data]);
  const prods = useMemo(() => products.data ?? [], [products.data]);
  const byId = useMemo(() => new Map(prods.map((p) => [p.id, p])), [prods]);
  const internalFam = useMemo(
    () => new Set(fams.filter((f) => f.internal).map((f) => f.id)),
    [fams],
  );
  const internal = prods.filter((p) => internalFam.has(p.family_id) && p.status !== "Archived");

  const rows = useMemo(() => issues.data ?? [], [issues.data]);
  const thisM = new Date().toISOString().slice(0, 7);
  const net = (s: StockIssue) => s.qty - s.returned_qty;
  const mRows = rows.filter((s) => month(s.issued_on) === thisM);
  const mUnits = mRows.reduce((a, s) => a + net(s), 0);
  const mValue = mRows.reduce((a, s) => a + net(s) * Number(s.unit_cost ?? 0), 0);
  const onHand = internal.reduce((a, p) => a + Math.max(0, p.stock), 0);
  const onHandValue = internal.reduce(
    (a, p) => a + Math.max(0, p.stock) * Number(p.landed ?? p.unit_cost ?? 0),
    0,
  );
  const byPurpose = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of mRows) m.set(s.purpose, (m.get(s.purpose) ?? 0) + net(s));
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [mRows]);

  const shown = rows.filter((s) => {
    if (purpose && s.purpose !== purpose) return false;
    const t = q.trim().toLowerCase();
    if (!t) return true;
    const p = byId.get(s.product_id);
    return `${s.ref} ${s.issued_to} ${s.phone ?? ""} ${s.purpose} ${s.note ?? ""} ${p?.code ?? ""} ${p?.friendly_name ?? ""}`
      .toLowerCase()
      .includes(t);
  });
  const groups = useMemo(() => {
    const m = new Map<string, StockIssue[]>();
    for (const s of shown) m.set(s.ref, [...(m.get(s.ref) ?? []), s]);
    return [...m.values()];
  }, [shown]);
  const people = useMemo(
    () => [...new Set(rows.map((s) => s.issued_to.trim()))].sort((a, b) => a.localeCompare(b)),
    [rows],
  );

  function csv() {
    const head = [
      "Date",
      "Ref",
      "Issued to",
      "Phone",
      "Purpose",
      "Code",
      "Item",
      "Size",
      "Qty",
      "Returned",
      "Unit cost",
      "Value",
      "Note",
      "Issued by",
    ];
    const lines = shown.map((s) => {
      const p = byId.get(s.product_id);
      return [
        s.issued_on,
        s.ref,
        s.issued_to,
        s.phone ?? "",
        s.purpose,
        p?.code ?? "",
        p?.friendly_name ?? "",
        p ? variantLabel(p, ref.data, true) : "",
        s.qty,
        s.returned_qty,
        s.unit_cost ?? "",
        Math.round(net(s) * Number(s.unit_cost ?? 0) * 100) / 100,
        s.note ?? "",
        s.issued_by_email ?? "",
      ];
    });
    const esc = (v: unknown) => `"${String(v).replace(/"/g, '""')}"`;
    const blob = new Blob([[head, ...lines].map((r) => r.map(esc).join(",")).join("\n")], {
      type: "text/csv",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `issue-register-${today()}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  if (!ref.data || products.isLoading) return <Empty>Loading…</Empty>;
  return (
    <>
      <PageHead
        title="Issued"
        lede="Internal stock handed out — officials' T-shirts, marketing caps, staff kit, samples. Issuing takes it out of stock and records who got what, how many, the size, cost, purpose and a note."
        right={
          canPublish ? (
            <Button
              size="sm"
              className="rounded-full bg-accent text-accent-foreground hover:bg-accent/90"
              onClick={() => setOpen(true)}
            >
              <Shirt className="size-4" /> Issue stock
            </Button>
          ) : null
        }
      />

      {open && canPublish && (
        <IssueForm
          products={prods}
          families={fams}
          internalFam={internalFam}
          ref_={ref.data}
          people={people}
          preset={search.issue}
          onClose={() => {
            setOpen(false);
            if (search.issue) navigate({ search: {}, replace: true });
          }}
        />
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Tile
          k="Issued this month"
          v={String(mUnits)}
          sub={`units · ${inr(Math.round(mValue))} at cost`}
        />
        <Tile
          k="By purpose"
          v={byPurpose[0]?.[0] ?? "—"}
          sub={byPurpose.map(([p, n]) => `${p} ${n}`).join(" · ") || "nothing this month"}
        />
        <Tile
          k="Internal stock on hand"
          v={String(onHand)}
          sub={`units · ${inr(Math.round(onHandValue))} at cost`}
        />
        <Tile
          k="Hand-overs"
          v={String(new Set(rows.map((s) => s.ref)).size)}
          sub={`${people.length} people`}
        />
      </div>

      <Card>
        <CardTitle>Internal stock</CardTitle>
        {internal.length ? (
          <InternalStock items={internal} families={fams} ref_={ref.data} canIssue={canPublish} />
        ) : (
          <Notice>
            No internal items yet. Add them through <b>Receive</b> like any product (tick{" "}
            <b>Internal stock only</b> on a new design), or open a product and switch its catalogue
            visibility to <b>Internal only</b>. Any product can still be issued from the form.
          </Notice>
        )}
      </Card>

      <Card>
        <CardTitle
          right={
            <div className="flex flex-wrap items-center gap-2">
              <Select
                className="h-9 w-auto"
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
              >
                <option value="">All purposes</option>
                {[...new Set([...ISSUE_PURPOSES, ...rows.map((s) => s.purpose)])].map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </Select>
              <TextInput
                type="search"
                className="h-9 w-52"
                placeholder="Person, item, ref…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
              <Button
                size="sm"
                variant="outline"
                className="rounded-full"
                disabled={!shown.length}
                onClick={csv}
              >
                <Download className="size-4" /> CSV
              </Button>
            </div>
          }
        >
          Issue register
        </CardTitle>
        {issues.isLoading ? (
          <Empty>Loading…</Empty>
        ) : !groups.length ? (
          <Empty>{rows.length ? "Nothing matches." : "Nothing issued yet."}</Empty>
        ) : (
          <ul className="grid gap-2">
            {groups.map((g) => (
              <IssueRow
                key={g[0]!.ref}
                g={g}
                byId={byId}
                families={fams}
                ref_={ref.data}
                canEdit={canPublish}
              />
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

function Tile({ k, v, sub }: { k: string; v: string; sub?: string }) {
  return (
    <div className="panel grid min-w-0 content-start gap-0.5 p-3">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {k}
      </span>
      <b className="wrap-any text-lg tabular-nums">{v}</b>
      {sub && <span className="wrap-any text-[11px] text-muted-foreground">{sub}</span>}
    </div>
  );
}

/** Internal designs with their sizes and stock. */
function InternalStock({
  items,
  families,
  ref_,
  canIssue,
}: {
  items: Product[];
  families: Family[];
  ref_: RefData;
  canIssue: boolean;
}) {
  const byFam = new Map<string, Product[]>();
  for (const p of items) byFam.set(p.family_id, [...(byFam.get(p.family_id) ?? []), p]);
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {[...byFam.values()].map((ps) => {
        const f = families.find((x) => x.id === ps[0]!.family_id);
        const total = ps.reduce((a, p) => a + p.stock, 0);
        return (
          <div key={ps[0]!.family_id} className="grid gap-2 rounded-xl border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Code>{designCode(ps[0]!, families)}</Code>
              <b className="wrap-any min-w-0 flex-1 text-sm">
                {f?.design_name || ps[0]!.friendly_name}
              </b>
              <span className="text-xs text-muted-foreground">{total} in stock</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {ps.map((p) => (
                <Link
                  key={p.id}
                  to={canIssue ? "/issued" : "/products"}
                  search={canIssue ? { issue: p.id } : { sel: p.id }}
                  className={cn(
                    "grid rounded-lg border px-2.5 py-1 text-xs tabular-nums hover:border-primary",
                    p.stock <= 0 && "opacity-60",
                  )}
                  title={canIssue ? `Issue ${p.code}` : p.code}
                >
                  <b>{variantLabel(p, ref_, true) || p.code}</b>
                  <span className="text-muted-foreground">{p.stock} left</span>
                </Link>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function IssueRow({
  g,
  byId,
  families,
  ref_,
  canEdit,
}: {
  g: StockIssue[];
  byId: Map<string, Product>;
  families: Family[];
  ref_: RefData;
  canEdit: boolean;
}) {
  const inv = useInvalidate();
  const [back, setBack] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const d = g[0]!;
  const units = g.reduce((a, s) => a + s.qty - s.returned_qty, 0);
  const value = g.reduce((a, s) => a + (s.qty - s.returned_qty) * Number(s.unit_cost ?? 0), 0);

  async function ret(s: StockIssue) {
    const n = num(back[s.id] ?? "");
    if (!n || n <= 0) return;
    setBusy(s.id);
    const { error } = await supabase.rpc("return_issue", { p_issue: s.id, p_qty: n });
    setBusy("");
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(`${n} back in stock from ${s.issued_to}`);
    setBack((m) => ({ ...m, [s.id]: "" }));
    await inv("issues", "products", "adjustments");
  }

  return (
    <li className="grid gap-2 rounded-xl border p-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <span className="text-xs text-muted-foreground">{fmt(d.issued_on)}</span>
        <span className="font-mono text-xs font-semibold">{d.ref}</span>
        <Pill tone="info">{d.purpose}</Pill>
        <b className="wrap-any">{d.issued_to}</b>
        {d.phone && <span className="text-xs text-muted-foreground">{d.phone}</span>}
        <span className="ml-auto text-right text-sm tabular-nums">
          <b>{units}</b> unit{units === 1 ? "" : "s"} · {inr(Math.round(value))}
        </span>
      </div>
      <ul className="grid gap-1">
        {g.map((s) => {
          const p = byId.get(s.product_id);
          const out = s.qty - s.returned_qty;
          return (
            <li
              key={s.id}
              className="flex flex-wrap items-center gap-2 rounded-lg bg-muted/60 px-2 py-1 text-xs"
            >
              {p ? (
                <Link
                  to="/products"
                  search={{ sel: p.id }}
                  className="flex flex-wrap items-center gap-1.5 hover:underline"
                >
                  <Code>{designCode(p, families)}</Code>
                  <span className="wrap-any">
                    {families.find((f) => f.id === p.family_id)?.design_name || p.friendly_name}
                  </span>
                  {variantLabel(p, ref_, true) && <Pill>{variantLabel(p, ref_, true)}</Pill>}
                </Link>
              ) : (
                <span>Deleted product</span>
              )}
              <b className="tabular-nums">× {s.qty}</b>
              {s.returned_qty > 0 && <Pill tone="ok">{s.returned_qty} returned</Pill>}
              <span className="text-muted-foreground">
                {s.unit_cost != null ? `${inr(Number(s.unit_cost))} each` : "no cost"}
              </span>
              {canEdit && out > 0 && (
                <span className="ml-auto flex items-center gap-1">
                  <TextInput
                    inputMode="numeric"
                    className="h-7 w-14 text-xs"
                    placeholder={String(out)}
                    aria-label={`Quantity returned for ${p?.code ?? "item"}`}
                    value={back[s.id] ?? ""}
                    onChange={(e) => setBack((m) => ({ ...m, [s.id]: e.target.value }))}
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 rounded-full px-2 text-xs"
                    disabled={!!busy || !num(back[s.id] ?? "")}
                    onClick={() => ret(s)}
                  >
                    <Undo2 className="size-3.5" /> Return
                  </Button>
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {(d.note || d.issued_by_email) && (
        <span className="wrap-any text-xs text-muted-foreground">
          {d.note}
          {d.note && d.issued_by_email ? " · " : ""}
          {d.issued_by_email ? `issued by ${d.issued_by_email.split("@")[0]}` : ""}
        </span>
      )}
    </li>
  );
}

type Line = { id: string; q: string; productId: string; qty: string };
const uid = () => Math.random().toString(36).slice(2, 9);

function IssueForm({
  products,
  families,
  internalFam,
  ref_,
  people,
  preset,
  onClose,
}: {
  products: Product[];
  families: Family[];
  internalFam: Set<string>;
  ref_: RefData;
  people: string[];
  preset?: string | undefined;
  onClose: () => void;
}) {
  const inv = useInvalidate();
  const avail = useMemo(
    () =>
      products
        .filter((p) => p.status !== "Archived")
        // internal items first
        .sort(
          (a, b) =>
            Number(internalFam.has(b.family_id)) - Number(internalFam.has(a.family_id)) ||
            a.code.localeCompare(b.code),
        ),
    [products, internalFam],
  );
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const label = (p: Product) =>
    `${p.code} · ${families.find((f) => f.id === p.family_id)?.design_name || p.friendly_name}${
      variantLabel(p, ref_, true) ? ` · ${variantLabel(p, ref_, true)}` : ""
    }`;
  const first = preset ? byId.get(preset) : undefined;
  const [lines, setLines] = useState<Line[]>([
    { id: uid(), q: first ? label(first) : "", productId: first?.id ?? "", qty: "1" },
  ]);
  const [to, setTo] = useState("");
  const [phone, setPhone] = useState("");
  const [purpose, setPurpose] = useState(ISSUE_PURPOSES[0]!);
  const [other, setOther] = useState("");
  const [date, setDate] = useState(today());
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const upd = (id: string, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const pick = (id: string, text: string) => {
    const code = (text.split(" ")[0] ?? "").trim().toUpperCase();
    const p = avail.find((x) => x.code === code);
    upd(id, { q: text, productId: p?.id ?? "" });
  };
  /** Other sizes of the same design, to add in one tap. */
  const siblingsOf = (p: Product) =>
    avail.filter(
      (x) =>
        x.family_id === p.family_id && x.id !== p.id && !lines.some((l) => l.productId === x.id),
    );

  const rows = lines.map((l) => {
    const p = l.productId ? byId.get(l.productId) : undefined;
    const qty = num(l.qty);
    const problem = !p
      ? "pick an item"
      : qty == null || qty <= 0 || !Number.isInteger(qty)
        ? "whole quantity"
        : qty > p.stock
          ? `only ${p.stock} in stock`
          : "";
    const cost = Number(p?.landed ?? p?.unit_cost ?? 0) * (qty ?? 0);
    return { l, p, qty, problem, cost };
  });
  const why = purpose === "Other" ? other.trim() : purpose;
  const total = rows.reduce((a, r) => a + r.cost, 0);
  const units = rows.reduce((a, r) => a + (r.qty ?? 0), 0);
  const bad = rows.some((r) => r.problem) || !to.trim() || !why;

  async function submit() {
    setBusy(true);
    const { data, error } = await supabase.rpc("issue_stock", {
      p_lines: rows.map((r) => ({ product_id: r.l.productId, qty: r.qty })),
      p_to: to.trim(),
      p_phone: phone.trim(),
      p_purpose: why,
      p_note: note.trim(),
      p_date: date,
    });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    const r = data as { ref: string; units: number };
    toast.success(`${r.ref}: ${r.units} issued to ${to.trim()} — taken out of stock`);
    await inv("issues", "products", "adjustments", "reorder_flags");
    onClose();
  }

  return (
    <Card className="border-primary">
      <CardTitle
        right={
          <Button size="sm" variant="ghost" className="rounded-full" onClick={onClose}>
            Close
          </Button>
        }
      >
        Issue stock
      </CardTitle>
      <div className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr]">
        <Field label="Issued to">
          <TextInput
            list="issue-people"
            value={to}
            placeholder="Person or team"
            autoFocus
            onChange={(e) => setTo(e.target.value)}
          />
          <datalist id="issue-people">
            {people.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
        </Field>
        <Field label="Phone (optional)">
          <TextInput inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </Field>
        <Field label="Date">
          <TextInput type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-[1fr_2fr]">
        <Field label="Purpose">
          <Select value={purpose} onChange={(e) => setPurpose(e.target.value)}>
            {ISSUE_PURPOSES.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </Select>
        </Field>
        {purpose === "Other" ? (
          <Field label="Purpose (your words)">
            <TextInput value={other} onChange={(e) => setOther(e.target.value)} />
          </Field>
        ) : (
          <Field label="Note (optional)">
            <TextInput
              value={note}
              placeholder="e.g. Pune league final, Instagram contest"
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
        )}
      </div>
      {purpose === "Other" && (
        <Field label="Note (optional)">
          <TextInput value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      )}

      <div className="grid gap-2">
        {rows.map(({ l, p, problem, cost }, i) => (
          <div
            key={l.id}
            className="grid gap-2 rounded-xl border p-2.5 sm:grid-cols-[minmax(0,1fr)_80px_110px_36px] sm:items-end"
          >
            <Field label={`Item ${i + 1}`}>
              <TextInput
                list="issue-items"
                value={l.q}
                placeholder="type a code or name"
                onChange={(e) => pick(l.id, e.target.value)}
              />
            </Field>
            <Field label="Qty">
              <TextInput
                inputMode="numeric"
                value={l.qty}
                onChange={(e) => upd(l.id, { qty: e.target.value })}
              />
            </Field>
            <div className="grid gap-0.5 pb-1 text-right text-sm tabular-nums">
              <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                At cost
              </span>
              <b>{inr(Math.round(cost))}</b>
            </div>
            <Button
              size="icon"
              variant="ghost"
              className="rounded-full"
              aria-label={`Remove item ${i + 1}`}
              disabled={lines.length === 1}
              onClick={() => setLines((ls) => ls.filter((x) => x.id !== l.id))}
            >
              <Trash2 className="size-4" />
            </Button>
            {(p || (problem && l.q)) && (
              <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground sm:col-span-4">
                {p && (
                  <span>
                    {p.stock} in stock · {inr(Number(p.landed ?? p.unit_cost ?? 0))} each at cost
                    {!internalFam.has(p.family_id) && " · on the catalogue (not internal)"}
                  </span>
                )}
                {problem && <Pill tone="bad">{problem}</Pill>}
                {p &&
                  siblingsOf(p).map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      className="rounded-full border px-2 py-0.5 hover:border-primary"
                      onClick={() =>
                        setLines((ls) => [
                          ...ls,
                          { id: uid(), q: label(s), productId: s.id, qty: "1" },
                        ])
                      }
                    >
                      + {variantLabel(s, ref_, true) || s.code} ({s.stock})
                    </button>
                  ))}
              </div>
            )}
          </div>
        ))}
        <datalist id="issue-items">
          {avail.map((p) => (
            <option key={p.id} value={label(p)}>
              {p.stock} in stock
            </option>
          ))}
        </datalist>
        <Button
          size="sm"
          variant="outline"
          className="w-fit rounded-full"
          onClick={() => setLines((ls) => [...ls, { id: uid(), q: "", productId: "", qty: "1" }])}
        >
          <Plus className="size-4" /> Another item
        </Button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-muted p-3">
        <span className="text-xs text-muted-foreground">
          <b className="block text-base tabular-nums text-foreground">
            {units} unit{units === 1 ? "" : "s"} · {inr(Math.round(total))}
          </b>
          leaves stock at cost
        </span>
        <Button
          className="rounded-full font-bold uppercase"
          disabled={busy || bad}
          onClick={submit}
        >
          {busy ? "Saving…" : "Issue"}
        </Button>
      </div>
    </Card>
  );
}
