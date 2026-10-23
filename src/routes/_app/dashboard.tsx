import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { inr, type Product } from "@/lib/domain";
import {
  designCode,
  useBills,
  useFamilies,
  usePayments,
  useProducts,
  useQuotes,
  useRefData,
  useReviews,
  useSales,
  useVendors,
} from "@/lib/data";
import { billMoney, vendorBusiness } from "@/lib/finance";
import { Card, CardTitle, Code, Empty, PageHead, Pill } from "@/components/kit";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard · Sportagon Stockroom" }] }),
  component: Dashboard,
});

const ym = (d: string | null | undefined) => String(d ?? "").slice(0, 7);
const monthLabel = (k: string) =>
  new Date(`${k}-01T00:00:00`).toLocaleString("en-IN", { month: "short", year: "2-digit" });
const lastMonths = (n: number) => {
  const out: string[] = [];
  const d = new Date();
  d.setDate(1);
  for (let i = n - 1; i >= 0; i--) {
    const x = new Date(d.getFullYear(), d.getMonth() - i, 1);
    out.push(`${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}`);
  }
  return out;
};
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
const pctChange = (a: number, b: number) => (b > 0 ? Math.round(((a - b) / b) * 100) : null);

function Dashboard() {
  const ref = useRefData();
  const products = useProducts();
  const families = useFamilies();
  const bills = useBills();
  const payments = usePayments();
  const sales = useSales(400);
  const quotes = useQuotes();
  const reviews = useReviews();
  const vendors = useVendors();

  const d = useMemo(() => {
    const ps = (products.data ?? []).filter((p) => p.status !== "Archived" && !p.is_sample);
    const byId = new Map(ps.map((p) => [p.id, p]));
    const live = (sales.data ?? []).filter(
      (s) => Number(s.qty) !== 0 && !["draft", "void"].includes(s.doc_status ?? ""),
    );
    const sign = (k: string) => (k === "credit" ? -1 : 1);
    const months = lastMonths(6);
    const thisM = months[months.length - 1]!;
    const prevM = months[months.length - 2]!;
    const activeBills = (bills.data ?? []).filter(
      (b) => b.receipt_type === "bill" && !b.reversed_at,
    );

    const salesBy = (m: string) =>
      live
        .filter((s) => ym(s.doc_date) === m)
        .reduce((a, s) => a + sign(s.doc_kind) * Number(s.amount ?? 0), 0);
    const cogsBy = (m: string) =>
      live
        .filter((s) => ym(s.doc_date) === m && s.product_id)
        .reduce(
          (a, s) =>
            a + sign(s.doc_kind) * Number(s.qty) * Number(byId.get(s.product_id!)?.landed ?? 0),
          0,
        );
    const purchBy = (m: string) =>
      activeBills
        .filter((b) => ym(b.bill_date ?? b.created_at) === m)
        .reduce((a, b) => a + Number(b.goods_value ?? 0) + Number(b.charges_total ?? 0), 0);

    const stockValue = ps.reduce((a, p) => a + Math.max(0, p.stock) * Number(p.landed ?? 0), 0);
    const retailValue = ps.reduce((a, p) => a + Math.max(0, p.stock) * Number(p.selling ?? 0), 0);
    const units = ps.reduce((a, p) => a + Math.max(0, p.stock), 0);
    const designs = new Set(ps.map((p) => p.family_id)).size;

    // last 30 days movers
    const since30 = daysAgo(30);
    const since60 = daysAgo(60);
    const sold30 = new Map<string, { qty: number; amt: number }>();
    const soldAny60 = new Set<string>();
    for (const s of live) {
      if (!s.product_id) continue;
      if (String(s.doc_date) >= since60) soldAny60.add(s.product_id);
      if (s.doc_kind !== "invoice" || String(s.doc_date) < since30) continue;
      const x = sold30.get(s.product_id) ?? { qty: 0, amt: 0 };
      x.qty += Number(s.qty);
      x.amt += Number(s.amount ?? 0);
      sold30.set(s.product_id, x);
    }
    const top = [...sold30.entries()]
      .map(([id, x]) => ({ p: byId.get(id), ...x }))
      .filter((x): x is { p: Product; qty: number; amt: number } => !!x.p)
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 8);
    const slow = ps
      .filter((p) => p.stock > 0 && !soldAny60.has(p.id))
      .map((p) => ({ p, value: p.stock * Number(p.landed ?? 0) }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);
    const low = ps
      .filter((p) => {
        const t = ref.data?.types.find((x) => x.div === p.div && x.code === p.type);
        if (t?.is_service) return false;
        const rp = p.reorder_point ?? 0;
        return (rp > 0 && p.stock <= rp) || (p.stock <= 0 && sold30.has(p.id));
      })
      .sort((a, b) => a.stock - b.stock)
      .slice(0, 8);

    // by type
    const byType = new Map<string, number>();
    for (const p of ps) {
      const t = ref.data?.types.find((x) => x.div === p.div && x.code === p.type)?.name ?? p.type;
      byType.set(t, (byType.get(t) ?? 0) + Math.max(0, p.stock) * Number(p.landed ?? 0));
    }
    const types = [...byType.entries()]
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);

    // payables
    const pay = payments.data ?? [];
    let owed = 0;
    let overdue = 0;
    const dueSoon: {
      id: string;
      vendor: string;
      no: string | null;
      due: string;
      balance: number;
      overdue: boolean;
    }[] = [];
    for (const b of activeBills) {
      const m = billMoney(b, pay);
      owed += m.balance;
      if (m.status === "overdue") overdue += m.balance;
      if (m.balance > 0.5 && b.due_date && String(b.due_date) <= daysAgo(-14))
        dueSoon.push({
          id: b.id,
          vendor: vendors.data?.find((v) => v.id === b.vendor_id)?.display_name ?? "Vendor",
          no: b.bill_no,
          due: String(b.due_date),
          balance: m.balance,
          overdue: m.status === "overdue",
        });
    }
    dueSoon.sort((a, b) => a.due.localeCompare(b.due));
    const vendorRows = (vendors.data ?? [])
      .map((v) => ({ v, b: vendorBusiness(v.id, bills.data ?? [], pay, reviews.data ?? []) }))
      .filter((x) => x.b.bills > 0)
      .sort((a, b) => b.b.total - a.b.total)
      .slice(0, 6);

    const qs = quotes.data ?? [];
    const openQ = qs.filter((q) => !["won", "lost"].includes(q.status));
    const wonM = qs.filter((q) => q.status === "won" && ym(q.updated_at) === thisM);

    const sThis = salesBy(thisM);
    const sPrev = salesBy(prevM);
    const cThis = cogsBy(thisM);
    return {
      months: months.map((m) => ({
        m: monthLabel(m),
        Sales: Math.round(salesBy(m)),
        Purchases: Math.round(purchBy(m)),
      })),
      sThis,
      sPrev,
      unitsThis: live
        .filter((s) => ym(s.doc_date) === thisM)
        .reduce((a, s) => a + sign(s.doc_kind) * Number(s.qty), 0),
      margin: sThis > 0 ? Math.round(((sThis - cThis) / sThis) * 100) : null,
      gross: sThis - cThis,
      purchThis: purchBy(thisM),
      stockValue,
      retailValue,
      units,
      designs,
      top,
      slow,
      low,
      types,
      owed,
      overdue,
      dueSoon: dueSoon.slice(0, 6),
      vendorRows,
      openQ: openQ.length,
      pipeline: openQ.reduce((a, q) => a + Number(q.est_total ?? 0), 0),
      newQ: qs.filter((q) => q.status === "new").length,
      wonM: wonM.reduce((a, q) => a + Number(q.est_total ?? 0), 0),
      unmatched: (sales.data ?? []).filter((s) => !s.product_id && Number(s.qty) !== 0).length,
      noSales: !(sales.data ?? []).length,
    };
  }, [
    products.data,
    sales.data,
    bills.data,
    payments.data,
    quotes.data,
    reviews.data,
    vendors.data,
    ref.data,
  ]);

  if (!ref.data || products.isLoading) return <Empty>Loading…</Empty>;
  const ch = pctChange(d.sThis, d.sPrev);
  const fam = families.data ?? [];
  return (
    <>
      <PageHead
        title="Dashboard"
        lede="How the store is doing — sales, stock, what to reorder, what you owe and what's coming in."
      />
      {d.noSales && (
        <p className="rounded-xl bg-accent/15 px-4 py-3 text-sm">
          Sales figures fill in once Zoho is connected or an export is imported —{" "}
          <Link
            to="/sales"
            className="font-semibold text-primary underline-offset-2 hover:underline"
          >
            go to Sales
          </Link>
          .
        </p>
      )}
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Kpi
          k="Sales this month"
          v={inr(Math.round(d.sThis))}
          sub={
            ch != null
              ? `${ch >= 0 ? "▲" : "▼"} ${Math.abs(ch)}% vs last month`
              : "before GST, net of returns"
          }
          tone={ch != null && ch < 0 ? "bad" : "ok"}
        />
        <Kpi
          k="Gross margin"
          v={d.margin != null ? `${d.margin}%` : "—"}
          sub={
            d.margin != null ? `${inr(Math.round(d.gross))} on ${d.unitsThis} units` : "needs sales"
          }
        />
        <Kpi
          k="Stock value (cost)"
          v={inr(Math.round(d.stockValue))}
          sub={`${d.units} units · ${d.designs} designs · sells for ${inr(Math.round(d.retailValue))}`}
        />
        <Kpi
          k="Purchases this month"
          v={inr(Math.round(d.purchThis))}
          sub="goods + charges, before GST"
        />
        <Kpi
          k="To pay vendors"
          v={inr(Math.round(d.owed))}
          sub={d.overdue > 0.5 ? `${inr(Math.round(d.overdue))} overdue` : "nothing overdue"}
          tone={d.overdue > 0.5 ? "bad" : undefined}
          to="/bills"
        />
        <Kpi
          k="Open enquiries"
          v={String(d.openQ)}
          sub={`${inr(Math.round(d.pipeline))} pipeline · ${d.newQ} new`}
          tone={d.newQ ? "warn" : undefined}
          to="/enquiries"
        />
        <Kpi k="Won this month" v={inr(Math.round(d.wonM))} sub="from catalogue enquiries" />
        <Kpi
          k="Low stock"
          v={String(d.low.length)}
          sub={d.unmatched ? `${d.unmatched} Zoho lines unmatched` : "at or below reorder point"}
          tone={d.low.length ? "warn" : undefined}
          to="/products"
        />
      </div>

      <Card>
        <CardTitle>Sales vs purchases · last 6 months</CardTitle>
        <div className="h-64 w-full">
          <ResponsiveContainer>
            <BarChart data={d.months} margin={{ left: 0, right: 8, top: 8 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
              <XAxis dataKey="m" tickLine={false} axisLine={false} fontSize={12} />
              <YAxis
                tickLine={false}
                axisLine={false}
                fontSize={11}
                width={56}
                tickFormatter={(v: number) =>
                  v >= 100000
                    ? `${(v / 100000).toFixed(1)}L`
                    : v >= 1000
                      ? `${Math.round(v / 1000)}k`
                      : String(v)
                }
              />
              <Tooltip
                formatter={(v: number) => inr(v)}
                contentStyle={{ borderRadius: 12, fontSize: 12 }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="Sales" fill="var(--primary)" radius={[6, 6, 0, 0]} />
              <Bar dataKey="Purchases" fill="var(--accent)" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <ListCard title="Best sellers · 30 days" empty="No sales in the last 30 days.">
          {d.top.map(({ p, qty, amt }) => (
            <Line key={p.id} p={p} fam={fam} right={`${qty} sold · ${inr(Math.round(amt))}`} />
          ))}
        </ListCard>
        <ListCard title="Reorder now" empty="Nothing at or below its reorder point.">
          {d.low.map((p) => (
            <Line
              key={p.id}
              p={p}
              fam={fam}
              right={
                <Pill tone={p.stock <= 0 ? "bad" : "warn"}>
                  {p.stock} left{p.reorder_point ? ` · reorder at ${p.reorder_point}` : ""}
                </Pill>
              }
            />
          ))}
        </ListCard>
        <ListCard
          title="Slow movers · no sale in 60 days"
          empty="Everything in stock sold recently."
        >
          {d.slow.map(({ p, value }) => (
            <Line
              key={p.id}
              p={p}
              fam={fam}
              right={`${p.stock} in stock · ${inr(Math.round(value))}`}
            />
          ))}
        </ListCard>
        <ListCard title="Stock value by type" empty="No stock yet.">
          {d.types.map(([t, v]) => (
            <div key={t} className="grid gap-1">
              <div className="flex justify-between text-sm">
                <span>{t}</span>
                <span className="tabular-nums">{inr(Math.round(v))}</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary"
                  style={{ width: `${Math.max(3, (v / (d.types[0]?.[1] || 1)) * 100)}%` }}
                />
              </div>
            </div>
          ))}
        </ListCard>
        <ListCard title="Bills due · next 14 days & overdue" empty="No vendor payments due.">
          {d.dueSoon.map((x) => (
            <Link
              key={x.id}
              to="/bills"
              search={{ sel: x.id }}
              className="flex flex-wrap items-center gap-x-3 gap-y-0.5 rounded-lg px-2 py-1.5 text-sm hover:bg-muted"
            >
              <span className="min-w-0 flex-1">
                {x.vendor}
                {x.no ? ` · ${x.no}` : ""}
              </span>
              <span className={cn("text-xs", x.overdue && "text-destructive")}>
                {x.overdue ? "overdue since" : "due"} {x.due}
              </span>
              <b className="tabular-nums">{inr(x.balance)}</b>
            </Link>
          ))}
        </ListCard>
        <ListCard title="Vendors · business & rating" empty="No vendor bills yet.">
          {d.vendorRows.map(({ v, b }) => (
            <Link
              key={v.id}
              to="/vendors"
              search={{ sel: v.id }}
              className="flex flex-wrap items-center gap-x-3 gap-y-0.5 rounded-lg px-2 py-1.5 text-sm hover:bg-muted"
            >
              <span className="min-w-0 flex-1 font-medium">{v.display_name}</span>
              <span className="tabular-nums">{inr(b.total)}</span>
              {b.owed > 0.5 && (
                <span className="text-xs text-warning-foreground dark:text-warning">
                  owe {inr(b.owed)}
                </span>
              )}
              <span className="text-xs text-warning">
                {b.rating != null ? `★ ${b.rating}` : ""}
              </span>
            </Link>
          ))}
        </ListCard>
      </div>
    </>
  );
}

function Kpi({
  k,
  v,
  sub,
  tone,
  to,
}: {
  k: string;
  v: string;
  sub?: string;
  tone?: "ok" | "bad" | "warn" | undefined;
  to?: "/bills" | "/enquiries" | "/products";
}) {
  const body = (
    <>
      <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {k}
      </span>
      <b className="wrap-any text-xl tabular-nums sm:text-2xl">{v}</b>
      {sub && (
        <span
          className={cn(
            "text-[11.5px]",
            tone === "bad"
              ? "text-destructive"
              : tone === "ok"
                ? "text-success"
                : tone === "warn"
                  ? "text-warning-foreground dark:text-warning"
                  : "text-muted-foreground",
          )}
        >
          {sub}
        </span>
      )}
    </>
  );
  const cls = cn(
    "panel grid min-w-0 content-start gap-0.5 p-3 sm:p-4",
    to && "hover:border-primary",
  );
  return to ? (
    <Link to={to} className={cls}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

function ListCard({
  title,
  empty,
  children,
}: {
  title: string;
  empty: string;
  children: React.ReactNode;
}) {
  const has = Array.isArray(children) ? children.length > 0 : !!children;
  return (
    <Card>
      <CardTitle>{title}</CardTitle>
      {has ? (
        <div className="grid gap-1">{children}</div>
      ) : (
        <p className="text-sm text-muted-foreground">{empty}</p>
      )}
    </Card>
  );
}

function Line({
  p,
  fam,
  right,
}: {
  p: Product;
  fam: { id: string; code: string | null }[];
  right: React.ReactNode;
}) {
  return (
    <Link
      to="/products"
      search={{ sel: p.id }}
      className="flex flex-wrap items-center gap-x-3 gap-y-0.5 rounded-lg px-2 py-1.5 text-sm hover:bg-muted"
    >
      <Code>{designCode(p, fam as never)}</Code>
      <span className="wrap-any min-w-0 flex-1">{p.friendly_name}</span>
      <span className="text-xs tabular-nums">{right}</span>
    </Link>
  );
}
