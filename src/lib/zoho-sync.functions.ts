import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { lineKey } from "@/lib/sales";
import { STATES } from "@/lib/gst";

/**
 * Zoho Books → Stockroom sales sync. Reads invoices and credit notes changed since the last run,
 * and lets the database reconcile stock (idempotent: re-running never double-counts).
 *
 * Credentials come from the owner's "Connect Zoho Books" form (stored in public.zoho_connection,
 * readable only by the server), or — if set — these server secrets:
 *   ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN, ZOHO_ORG_ID, ZOHO_DC
 * Scopes: ZohoBooks.invoices.ALL, ZohoBooks.creditnotes.READ, ZohoBooks.contacts.ALL,
 *         ZohoBooks.settings.ALL (items and taxes — sales recorded in the app become Zoho invoices)
 */

type Doc = {
  kind: "invoice" | "credit";
  doc_id: string;
  doc_no: string;
  date: string;
  status: string;
  customer: string;
  lines: {
    line_key: string;
    item_id: string;
    name: string;
    sku: string;
    qty: number;
    rate: number;
    amount: number;
  }[];
};
export type SyncResult = {
  configured: boolean;
  ran: boolean;
  docs: number;
  lines: number;
  unitsApplied: number;
  unmatched: number;
  since: string | null;
  at: string | null;
  error?: string | undefined;
  /** Where the connection comes from: the in-app form or server secrets. */
  source?: "app" | "secrets" | null | undefined;
  orgName?: string | null | undefined;
  connectedAt?: string | null | undefined;
  connectedBy?: string | null | undefined;
};

const env = (k: string) => process.env[k];
const DEFAULT_ORG = "60089715531";
let token: { value: string; exp: number; refresh: string } | null = null;

type Cfg = {
  ok: boolean;
  id?: string | undefined;
  secret?: string | undefined;
  refresh?: string | undefined;
  org: string;
  accounts: string;
  api: string;
  source: "app" | "secrets" | null;
  orgName?: string | null | undefined;
  connectedAt?: string | null | undefined;
  connectedBy?: string | null | undefined;
};
const urls = (dc: string) => {
  const d = (dc || "in").replace(/^\./, "");
  return { accounts: `https://accounts.zoho.${d}`, api: `https://www.zohoapis.${d}/books/v3` };
};

async function cfg(): Promise<Cfg> {
  // The connection made in the app wins; server secrets are only a fallback.
  const db = await admin();
  const { data: row } = await db.from("zoho_connection").select("*").eq("id", 1).maybeSingle();
  if (row)
    return {
      ok: true,
      id: row.client_id,
      secret: row.client_secret,
      refresh: row.refresh_token,
      org: row.org_id || DEFAULT_ORG,
      ...urls(row.dc),
      source: "app",
      orgName: row.org_name,
      connectedAt: row.connected_at,
      connectedBy: row.connected_by_email,
    };
  const id = env("ZOHO_CLIENT_ID");
  const secret = env("ZOHO_CLIENT_SECRET");
  const refresh = env("ZOHO_REFRESH_TOKEN");
  if (id && secret && refresh)
    return {
      ok: true,
      id,
      secret,
      refresh,
      org: env("ZOHO_ORG_ID") || DEFAULT_ORG,
      ...urls(env("ZOHO_DC") || "in"),
      source: "secrets",
    };
  return { ok: false, org: DEFAULT_ORG, ...urls("in"), source: null };
}

async function accessToken(c: Cfg) {
  if (token && token.refresh === c.refresh && token.exp > Date.now() + 60_000) return token.value;
  const body = new URLSearchParams({
    refresh_token: c.refresh!,
    client_id: c.id!,
    client_secret: c.secret!,
    grant_type: "refresh_token",
  });
  const r = await fetch(`${c.accounts}/oauth/v2/token`, { method: "POST", body });
  const j = (await r.json()) as { access_token?: string; expires_in?: number; error?: string };
  if (!j.access_token)
    throw new Error(
      `Zoho sign-in failed (${j.error ?? r.status}). Reconnect Zoho Books on the Sales page.`,
    );
  token = {
    value: j.access_token,
    exp: Date.now() + (j.expires_in ?? 3600) * 1000,
    refresh: c.refresh!,
  };
  return token.value;
}

async function zget<T>(c: Cfg, path: string, q: Record<string, string>) {
  const url = new URL(`${c.api}${path}`);
  url.searchParams.set("organization_id", c.org);
  for (const [k, v] of Object.entries(q)) url.searchParams.set(k, v);
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetch(url, {
      headers: { Authorization: `Zoho-oauthtoken ${await accessToken(c)}` },
    });
    if (r.status === 429) {
      await new Promise((res) => setTimeout(res, 1500 * (attempt + 1)));
      continue;
    }
    const j = (await r.json()) as T & { code?: number; message?: string };
    if (!r.ok || (j.code != null && j.code !== 0))
      throw new Error(`Zoho: ${j.message ?? r.status}`);
    return j;
  }
  throw new Error("Zoho is rate-limiting — try again in a minute");
}

/** Zoho wants e.g. 2026-10-23T09:15:00+0530 */
const zohoTime = (iso: string) => {
  const d = new Date(new Date(iso).getTime() + 330 * 60_000);
  return d.toISOString().slice(0, 19) + "+0530";
};

type ZLine = {
  line_item_id?: string;
  item_id?: string;
  name?: string;
  sku?: string;
  quantity?: number;
  rate?: number;
  item_total?: number;
};

async function fetchDocs(c: Cfg, kind: "invoice" | "credit", since: string) {
  const list = kind === "invoice" ? "/invoices" : "/creditnotes";
  const key = kind === "invoice" ? "invoices" : "creditnotes";
  const one = kind === "invoice" ? "invoice" : "creditnote";
  const ids: string[] = [];
  for (let page = 1; page < 50; page++) {
    const j = await zget<Record<string, unknown>>(c, list, {
      last_modified_time: zohoTime(since),
      per_page: "200",
      page: String(page),
    });
    const rows = (j[key] as Record<string, string>[] | undefined) ?? [];
    for (const r of rows) ids.push(String(r[kind === "invoice" ? "invoice_id" : "creditnote_id"]));
    if (!(j["page_context"] as { has_more_page?: boolean } | undefined)?.has_more_page) break;
  }
  const docs: Doc[] = [];
  for (const id of ids) {
    const j = await zget<Record<string, Record<string, unknown>>>(c, `${list}/${id}`, {});
    docs.push(docFrom(kind, j[one]!, id));
  }
  return docs;
}

/** A Zoho invoice / credit note as the stockroom stores it. Same keys for sync, imports and
 *  invoices made from the app, so the same document is never counted twice. */
function docFrom(kind: "invoice" | "credit", d: Record<string, unknown>, id: string): Doc {
  const seen = new Map<string, number>();
  const lines = ((d["line_items"] as ZLine[] | undefined) ?? []).map((l) => ({
    line_key: lineKey(String(l.name ?? l.item_id ?? ""), seen),
    item_id: String(l.item_id ?? ""),
    name: String(l.name ?? ""),
    sku: String(l.sku ?? ""),
    qty: Number(l.quantity ?? 0),
    rate: Number(l.rate ?? 0),
    amount: Number(l.item_total ?? 0),
  }));
  const no = String(d[kind === "invoice" ? "invoice_number" : "creditnote_number"] ?? id);
  return {
    kind,
    // keyed by document number so API sync and file imports never double-count
    doc_id: no,
    doc_no: no,
    date: String(d["date"] ?? ""),
    status: String(d["status"] ?? ""),
    customer: String(d["customer_name"] ?? ""),
    lines,
  };
}

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

async function syncState(db: Awaited<ReturnType<typeof admin>>) {
  const { data } = await db.from("app_settings").select("data").eq("id", 1).maybeSingle();
  const all = (data?.data ?? {}) as Record<string, unknown>;
  return { all, s: (all["zoho_sync"] ?? {}) as { last_run?: string; cursor?: string } };
}

export const zohoSyncStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<SyncResult> => {
    const c = await cfg();
    const db = await admin();
    const { s } = await syncState(db);
    return {
      configured: c.ok,
      source: c.source,
      orgName: c.orgName ?? null,
      connectedAt: c.connectedAt ?? null,
      connectedBy: c.connectedBy ?? null,
      ran: false,
      docs: 0,
      lines: 0,
      unitsApplied: 0,
      unmatched: 0,
      since: s.cursor ?? null,
      at: s.last_run ?? null,
    };
  });

export const syncZohoSales = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { force?: boolean; fromDate?: string | undefined }) => d)
  .handler(async ({ data, context }): Promise<SyncResult> => {
    const c = await cfg();
    const db = await admin();
    const { data: me } = await db
      .from("user_roles")
      .select("role,can_publish")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!me || !(me.role === "owner" || (me.can_publish && me.role !== "viewer")))
      throw new Error("Only people who can publish bills can sync sales");
    const { all, s } = await syncState(db);
    const base: SyncResult = {
      configured: c.ok,
      ran: false,
      docs: 0,
      lines: 0,
      unitsApplied: 0,
      unmatched: 0,
      since: s.cursor ?? null,
      at: s.last_run ?? null,
    };
    if (!c.ok) return base;
    // Automatic runs at most every 15 minutes; "Sync now" always runs.
    if (!data.force && s.last_run && Date.now() - Date.parse(s.last_run) < 15 * 60_000) return base;

    const startedAt = new Date().toISOString();
    // First run: from the chosen date (default 30 days back). Later: 10 minutes before the last run.
    const since =
      data.fromDate ??
      (s.cursor
        ? new Date(Date.parse(s.cursor) - 10 * 60_000).toISOString()
        : new Date(Date.now() - 30 * 86_400_000).toISOString());
    try {
      const docs = [
        ...(await fetchDocs(c, "invoice", since)),
        ...(await fetchDocs(c, "credit", since)),
      ];
      let lines = 0;
      let units = 0;
      let unmatched = 0;
      for (let i = 0; i < docs.length; i += 25) {
        const { data: r, error } = await db.rpc("apply_sales", {
          p_docs: docs.slice(i, i + 25),
          p_source: "zoho",
        });
        if (error) throw new Error(error.message);
        const res = r as { lines: number; units_applied: number; unmatched: number };
        lines += res.lines;
        units += res.units_applied;
        unmatched = res.unmatched;
      }
      await db
        .from("app_settings")
        .update({
          data: { ...all, zoho_sync: { last_run: startedAt, cursor: startedAt } } as never,
        })
        .eq("id", 1);
      return {
        ...base,
        ran: true,
        docs: docs.length,
        lines,
        unitsApplied: units,
        unmatched,
        since,
        at: startedAt,
      };
    } catch (e) {
      return { ...base, error: e instanceof Error ? e.message : String(e) };
    }
  });

async function requireOwner(userId: string) {
  const db = await admin();
  const { data: me } = await db
    .from("user_roles")
    .select("role,email")
    .eq("user_id", userId)
    .maybeSingle();
  if (me?.role !== "owner") throw new Error("Only the owner can connect Zoho Books");
  return { db, email: (me.email as string | null) ?? null };
}

/**
 * Owner pastes the Self Client's Client ID, Client Secret and a freshly generated code; the server
 * exchanges the code for a refresh token, checks it can read invoices, and stores it privately.
 */
export const connectZoho = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    (d: { clientId: string; clientSecret: string; code: string; dc?: string | undefined }) => d,
  )
  .handler(async ({ data, context }): Promise<{ orgName: string | null }> => {
    const { db, email } = await requireOwner(context.userId);
    const clientId = String(data.clientId ?? "").trim();
    const clientSecret = String(data.clientSecret ?? "").trim();
    const code = String(data.code ?? "").trim();
    const dc = /^[a-z.]{2,8}$/.test(String(data.dc ?? "in")) ? String(data.dc ?? "in") : "in";
    if (!clientId || !clientSecret || !code)
      throw new Error("Paste the Client ID, Client Secret and the generated code");
    const u = urls(dc);
    const r = await fetch(`${u.accounts}/oauth/v2/token`, {
      method: "POST",
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "authorization_code",
      }),
    });
    const j = (await r.json().catch(() => ({}))) as {
      refresh_token?: string;
      access_token?: string;
      error?: string;
    };
    if (!j.refresh_token) {
      const why =
        j.error === "invalid_code"
          ? "The code has expired or was already used — generate a new one (it lasts 10 minutes) and paste it straight away."
          : j.error === "invalid_client"
            ? "Client ID or Client Secret is wrong — copy them again from the Self Client."
            : `Zoho didn't accept it (${j.error ?? r.status}).`;
      throw new Error(why);
    }
    // Check the token can actually read this organisation's invoices before saving it.
    const c: Cfg = {
      ok: true,
      id: clientId,
      secret: clientSecret,
      refresh: j.refresh_token,
      org: DEFAULT_ORG,
      ...u,
      source: "app",
    };
    token = null;
    let orgName: string | null = null;
    try {
      await zget(c, "/invoices", { per_page: "1" });
      await zget(c, "/creditnotes", { per_page: "1" });
      try {
        const o = await zget<{ organization?: { name?: string } }>(
          c,
          `/organizations/${DEFAULT_ORG}`,
          {},
        );
        orgName = o.organization?.name ?? null;
      } catch {
        /* organisation name needs an extra scope; not required */
      }
    } catch (e) {
      throw new Error(
        `Connected to Zoho, but it can't read invoices and credit notes yet. Make sure the code was generated with the scope shown on the Sales page. (${e instanceof Error ? e.message : e})`,
      );
    }
    const { error } = await db.from("zoho_connection").upsert({
      id: 1,
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: j.refresh_token,
      dc,
      org_id: DEFAULT_ORG,
      org_name: orgName,
      connected_at: new Date().toISOString(),
      connected_by_email: email,
    });
    if (error) throw new Error(error.message);
    return { orgName };
  });

/** Owner removes the in-app Zoho connection (the token is also revoked at Zoho). */
export const disconnectZoho = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ ok: true }> => {
    const { db } = await requireOwner(context.userId);
    const { data: row } = await db
      .from("zoho_connection")
      .select("refresh_token,dc")
      .eq("id", 1)
      .maybeSingle();
    if (row?.refresh_token)
      await fetch(
        `${urls(row.dc).accounts}/oauth/v2/token/revoke?token=${encodeURIComponent(row.refresh_token)}`,
        { method: "POST" },
      ).catch(() => undefined);
    await db.from("zoho_connection").delete().eq("id", 1);
    token = null;
    return { ok: true };
  });

// ---------------------------------------------------------------------------------------------
// Sales recorded in the app. With Zoho connected each sale becomes a Zoho invoice (customer and
// item created if needed) and is stored exactly as the sync would store it, so the next sync
// finds the same invoice and never counts it twice. Without Zoho (or if Zoho refuses) it is kept
// here as a local sale and can be sent to Zoho later.
// ---------------------------------------------------------------------------------------------

export type SaleInput = {
  date: string;
  customer: string;
  phone?: string | undefined;
  email?: string | undefined;
  gstin?: string | undefined;
  note?: string | undefined;
  /** price = selling price per unit including GST (what the customer pays). */
  lines: { productId: string; qty: number; price: number }[];
  /** false = keep it here only, even when Zoho is connected. */
  zoho?: boolean | undefined;
};
export type SaleResult = {
  docNo: string;
  inZoho: boolean;
  zohoError?: string | undefined;
  units: number;
};

type SaleDocExtra = Doc & {
  recorded_by?: string | null;
  phone?: string | null;
  note?: string | null;
  zoho_id?: string | null;
};
type Db = Awaited<ReturnType<typeof admin>>;
type SellLine = {
  productId: string;
  code: string;
  name: string;
  qty: number;
  /** before GST */
  rate: number;
  gst: number;
  hsn: string | null;
};

const r2 = (x: number) => Math.round(x * 100) / 100;

async function zsend<T>(c: Cfg, method: "POST" | "PUT", path: string, body?: unknown) {
  const url = new URL(`${c.api}${path}`);
  url.searchParams.set("organization_id", c.org);
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetch(url, {
      method,
      headers: {
        Authorization: `Zoho-oauthtoken ${await accessToken(c)}`,
        "Content-Type": "application/json",
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    if (r.status === 429) {
      await new Promise((res) => setTimeout(res, 1500 * (attempt + 1)));
      continue;
    }
    const j = (await r.json().catch(() => ({}))) as T & { code?: number; message?: string };
    if (!r.ok || (j.code != null && j.code !== 0)) {
      const msg = j.message ?? String(r.status);
      throw new Error(
        r.status === 401 || /not authori[sz]ed|scope/i.test(msg)
          ? `Zoho: ${msg} — reconnect Zoho Books on the Sales page with the scope shown there`
          : `Zoho: ${msg}`,
      );
    }
    return j;
  }
  throw new Error("Zoho is rate-limiting — try again in a minute");
}

async function requirePublisher(userId: string) {
  const db = await admin();
  const { data: me } = await db
    .from("user_roles")
    .select("role,can_publish,email")
    .eq("user_id", userId)
    .maybeSingle();
  if (!me || !(me.role === "owner" || (me.can_publish && me.role !== "viewer")))
    throw new Error("Only people who can publish bills can record sales");
  return { db, email: (me.email as string | null) ?? null };
}

async function companyState(db: Db) {
  const { all } = await syncState(db);
  return String(all["company_state"] ?? "MH");
}

const stateOfGstin = (gstin: string | undefined) => {
  const g = (gstin ?? "").trim().slice(0, 2);
  return g ? (STATES.find((s) => s.gst === g)?.code ?? null) : null;
};

let taxCache: { at: number; rows: Record<string, unknown>[] } | null = null;
async function taxIds(c: Cfg, pct: number) {
  if (!taxCache || Date.now() - taxCache.at > 3_600_000) {
    const j = await zget<{ taxes?: Record<string, unknown>[] }>(c, "/settings/taxes", {
      per_page: "200",
    });
    taxCache = { at: Date.now(), rows: j.taxes ?? [] };
  }
  const of = (spec: string) =>
    taxCache!.rows.find(
      (t) => Number(t["tax_percentage"]) === pct && t["tax_specification"] === spec,
    )?.["tax_id"] as string | undefined;
  return { intra: of("intra"), inter: of("inter") };
}

/** Zoho item for a product: known link → search by SKU → create it (with its GST). */
async function itemIdFor(c: Cfg, db: Db, l: SellLine): Promise<string> {
  const { data: known } = await db
    .from("zoho_item_map")
    .select("zoho_key")
    .eq("product_id", l.productId)
    .like("zoho_key", "i:%")
    .limit(1);
  const k = known?.[0]?.zoho_key;
  if (k) return k.slice(2);
  // Zoho's item list can't filter by SKU — page through and match it.
  let id: string | undefined;
  for (let page = 1; page <= 10 && !id; page++) {
    const j = await zget<{
      items?: { item_id: string; sku?: string }[];
      page_context?: { has_more_page?: boolean };
    }>(c, "/items", { per_page: "200", page: String(page) });
    id = j.items?.find((i) => (i.sku ?? "").toUpperCase() === l.code.toUpperCase())?.item_id;
    if (!j.page_context?.has_more_page) break;
  }
  if (!id) {
    const t = await taxIds(c, l.gst);
    const prefs = [
      t.intra ? { tax_id: t.intra, tax_specification: "intra" } : null,
      t.inter ? { tax_id: t.inter, tax_specification: "inter" } : null,
    ].filter(Boolean);
    const body = {
      name: l.name,
      sku: l.code,
      rate: l.rate,
      product_type: "goods",
      item_type: "sales",
      ...(l.hsn ? { hsn_or_sac: l.hsn } : {}),
      ...(prefs.length ? { item_tax_preferences: prefs } : {}),
    };
    let j: { item?: { item_id: string } };
    try {
      j = await zsend(c, "POST", "/items", body);
    } catch (e) {
      // Item names are unique in Zoho — retry with the code in the name.
      if (!/already exists/i.test(String(e))) throw e;
      j = await zsend(c, "POST", "/items", { ...body, name: `${l.name} (${l.code})` });
    }
    id = j.item!.item_id;
  }
  await db.from("zoho_item_map").upsert({ zoho_key: `i:${id}`, product_id: l.productId });
  return id;
}

async function customerIdFor(c: Cfg, inp: SaleInput, pos: string): Promise<string> {
  const name = inp.customer.trim();
  const found = await zget<{ contacts?: { contact_id: string; contact_name: string }[] }>(
    c,
    "/contacts",
    { contact_name: name, contact_type: "customer" },
  );
  const hit = found.contacts?.find(
    (x) => x.contact_name.trim().toLowerCase() === name.toLowerCase(),
  );
  if (hit) return hit.contact_id;
  const gstin = (inp.gstin ?? "").trim().toUpperCase();
  const j = await zsend<{ contact?: { contact_id: string } }>(c, "POST", "/contacts", {
    contact_name: name,
    contact_type: "customer",
    gst_treatment: gstin ? "business_gst" : "consumer",
    ...(gstin ? { gst_no: gstin } : {}),
    place_of_supply: pos,
    ...(inp.phone || inp.email
      ? {
          contact_persons: [
            {
              first_name: name.slice(0, 100),
              ...(inp.phone ? { mobile: inp.phone } : {}),
              ...(inp.email ? { email: inp.email } : {}),
              is_primary_contact: true,
            },
          ],
        }
      : {}),
  });
  return j.contact!.contact_id;
}

async function zohoInvoice(c: Cfg, db: Db, inp: SaleInput, lines: SellLine[]) {
  const pos = stateOfGstin(inp.gstin) ?? (await companyState(db));
  const customer_id = await customerIdFor(c, inp, pos);
  const line_items = [];
  for (const l of lines)
    line_items.push({ item_id: await itemIdFor(c, db, l), quantity: l.qty, rate: l.rate });
  const j = await zsend<{ invoice?: Record<string, unknown> }>(c, "POST", "/invoices", {
    customer_id,
    date: inp.date,
    place_of_supply: pos,
    is_inclusive_tax: false,
    reference_number: "Stockroom",
    ...(inp.note ? { notes: inp.note } : {}),
    line_items,
  });
  const inv = j.invoice!;
  const id = String(inv["invoice_id"]);
  // A new invoice is a draft; mark it sent so it counts as a sale (here and in Zoho).
  await zsend(c, "POST", `/invoices/${id}/status/sent`).catch(() => undefined);
  const doc = docFrom("invoice", { ...inv, status: "sent" }, id);
  return { doc, zohoId: id };
}

async function nextLocalNo(db: Db): Promise<string> {
  for (let i = 0; i < 5; i++) {
    const { data } = await db
      .from("code_counters")
      .select("next_no")
      .eq("prefix", "SALE")
      .maybeSingle();
    if (!data) {
      const { error } = await db.from("code_counters").insert({ prefix: "SALE", next_no: 1002 });
      if (!error) return "SGN-S-1001";
      continue;
    }
    const n = data.next_no;
    const { data: upd } = await db
      .from("code_counters")
      .update({ next_no: n + 1 })
      .eq("prefix", "SALE")
      .eq("next_no", n)
      .select("next_no");
    if (upd?.length) return `SGN-S-${n}`;
  }
  return `SGN-S-${Date.now().toString().slice(-6)}`;
}

function localDoc(no: string, inp: SaleInput, lines: SellLine[], status = "sent"): Doc {
  const seen = new Map<string, number>();
  return {
    kind: "invoice",
    doc_id: no,
    doc_no: no,
    date: inp.date,
    status,
    customer: inp.customer.trim(),
    lines: lines.map((l) => ({
      line_key: lineKey(l.name, seen),
      item_id: "",
      name: l.name,
      sku: l.code,
      qty: l.qty,
      rate: l.rate,
      amount: r2(l.rate * l.qty),
    })),
  };
}

async function applyDocs(db: Db, docs: SaleDocExtra[], source: "zoho" | "app") {
  const { data, error } = await db.rpc("apply_sales", { p_docs: docs as never, p_source: source });
  if (error) throw new Error(error.message);
  return (data as { units_applied: number }).units_applied;
}

async function sellLines(db: Db, rows: { productId: string; qty: number; rate: number }[]) {
  const ids = [...new Set(rows.map((r) => r.productId))];
  const { data: prods, error } = await db
    .from("products")
    .select("id,code,friendly_name,gst,div,type")
    .in("id", ids);
  if (error) throw new Error(error.message);
  const { data: types } = await db.from("types").select("div,code,gst,hsn");
  return rows.map((r) => {
    const p = prods?.find((x) => x.id === r.productId);
    if (!p) throw new Error("A product on this sale no longer exists");
    const t = types?.find((x) => x.div === p.div && x.code === p.type);
    return {
      productId: p.id,
      code: p.code,
      name: p.friendly_name,
      qty: r.qty,
      rate: r.rate,
      gst: Number(p.gst ?? t?.gst ?? 18),
      hsn: t?.hsn ?? null,
    } satisfies SellLine;
  });
}

export const recordSale = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: SaleInput) => d)
  .handler(async ({ data, context }): Promise<SaleResult> => {
    const { db, email } = await requirePublisher(context.userId);
    const customer = String(data.customer ?? "").trim() || "Walk-in customer";
    const inp: SaleInput = { ...data, customer };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(data.date))) throw new Error("Pick the sale date");
    const rows = (data.lines ?? []).filter((l) => l.productId);
    if (!rows.length) throw new Error("Add at least one product");
    for (const l of rows)
      if (!Number.isInteger(l.qty) || l.qty <= 0 || !(l.price >= 0))
        throw new Error("Each line needs a whole quantity and a price");
    const base = await sellLines(
      db,
      rows.map((l) => ({ productId: l.productId, qty: l.qty, rate: 0 })),
    );
    const lines = base.map((b, i) => ({ ...b, rate: r2(rows[i]!.price / (1 + b.gst / 100)) }));
    const extra = {
      recorded_by: email,
      phone: inp.phone?.trim() || null,
      note: inp.note?.trim() || null,
    };

    const c = await cfg();
    let zohoError: string | undefined;
    if (c.ok && data.zoho !== false) {
      try {
        const { doc, zohoId } = await zohoInvoice(c, db, inp, lines);
        const units = await applyDocs(db, [{ ...doc, ...extra, zoho_id: zohoId }], "zoho");
        return { docNo: doc.doc_no, inZoho: true, units };
      } catch (e) {
        zohoError = e instanceof Error ? e.message : String(e);
      }
    }
    const no = await nextLocalNo(db);
    const units = await applyDocs(db, [{ ...localDoc(no, inp, lines), ...extra }], "app");
    return {
      docNo: no,
      inZoho: false,
      units,
      zohoError: zohoError ?? (c.ok ? undefined : "Zoho Books isn't connected"),
    };
  });

async function appSale(db: Db, docId: string) {
  const { data, error } = await db
    .from("sales_lines")
    .select("*")
    .eq("source", "app")
    .eq("doc_kind", "invoice")
    .eq("doc_id", docId);
  if (error) throw new Error(error.message);
  const live = (data ?? []).filter((r) => Number(r.qty) > 0);
  if (!live.length) throw new Error("Sale not found");
  return live;
}

/** A sale kept here (Zoho was off or refused) → create its Zoho invoice, then retire the local copy. */
export const pushSaleToZoho = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { docId: string }) => d)
  .handler(async ({ data, context }): Promise<SaleResult> => {
    const { db, email } = await requirePublisher(context.userId);
    const c = await cfg();
    if (!c.ok) throw new Error("Connect Zoho Books first (Sales page)");
    const rows = await appSale(db, data.docId);
    if (rows.some((r) => ["void", "draft"].includes(r.doc_status ?? "")))
      throw new Error("This sale was cancelled");
    if (rows.some((r) => !r.product_id)) throw new Error("Every line needs a product first");
    const first = rows[0]!;
    const inp: SaleInput = {
      date: String(first.doc_date ?? new Date().toISOString().slice(0, 10)),
      customer: first.customer ?? "Walk-in customer",
      phone: first.customer_phone ?? undefined,
      note: first.note ?? undefined,
      lines: [],
    };
    const lines = await sellLines(
      db,
      rows.map((r) => ({
        productId: r.product_id!,
        qty: Number(r.qty),
        rate: Number(r.rate ?? 0),
      })),
    );
    const { doc, zohoId } = await zohoInvoice(c, db, inp, lines);
    // Take the Zoho invoice's stock first, then give back the local copy's: net zero, one sale.
    const units = await applyDocs(
      db,
      [
        {
          ...doc,
          recorded_by: first.recorded_by ?? email,
          phone: inp.phone ?? null,
          note: inp.note ?? null,
          zoho_id: zohoId,
        },
      ],
      "zoho",
    );
    await applyDocs(
      db,
      [
        {
          kind: "invoice",
          doc_id: data.docId,
          doc_no: data.docId,
          date: inp.date,
          status: "sent",
          customer: inp.customer,
          lines: [],
        },
      ],
      "app",
    );
    return { docNo: doc.doc_no, inZoho: true, units };
  });

/** Cancel a sale made by mistake: a local one is voided here; a Zoho invoice made from the app is
 *  voided in Zoho too. Either way its stock goes back. */
export const cancelSale = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { source: "app" | "zoho"; docId: string }) => d)
  .handler(async ({ data, context }): Promise<{ units: number }> => {
    const { db } = await requirePublisher(context.userId);
    if (data.source === "app") {
      const rows = await appSale(db, data.docId);
      const first = rows[0]!;
      const seen = new Map<string, number>();
      const units = await applyDocs(
        db,
        [
          {
            kind: "invoice",
            doc_id: data.docId,
            doc_no: data.docId,
            date: String(first.doc_date ?? ""),
            status: "void",
            customer: first.customer ?? "",
            lines: rows.map((r) => ({
              line_key: r.line_key ?? lineKey(r.item_name ?? "", seen),
              item_id: r.zoho_item_id ?? "",
              name: r.item_name ?? "",
              sku: r.sku ?? "",
              qty: Number(r.qty),
              rate: Number(r.rate ?? 0),
              amount: Number(r.amount ?? 0),
            })),
          },
        ],
        "app",
      );
      return { units };
    }
    const { data: rows } = await db
      .from("sales_lines")
      .select("zoho_doc_id")
      .eq("source", "zoho")
      .eq("doc_kind", "invoice")
      .eq("doc_id", data.docId)
      .not("zoho_doc_id", "is", null)
      .limit(1);
    const zid = rows?.[0]?.zoho_doc_id;
    if (!zid)
      throw new Error("Void this invoice in Zoho Books — the next sync puts the stock back");
    const c = await cfg();
    if (!c.ok) throw new Error("Connect Zoho Books first (Sales page)");
    await zsend(c, "POST", `/invoices/${zid}/status/void`);
    const j = await zget<{ invoice?: Record<string, unknown> }>(c, `/invoices/${zid}`, {});
    const units = await applyDocs(db, [docFrom("invoice", j.invoice!, zid)], "zoho");
    return { units };
  });
