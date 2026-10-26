import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { lineKey } from "@/lib/sales";

/**
 * Zoho Books → Stockroom sales sync. Reads invoices and credit notes changed since the last run,
 * and lets the database reconcile stock (idempotent: re-running never double-counts).
 *
 * Credentials come from the owner's "Connect Zoho Books" form (stored in public.zoho_connection,
 * readable only by the server), or — if set — these server secrets:
 *   ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN, ZOHO_ORG_ID, ZOHO_DC
 * Scopes: ZohoBooks.invoices.READ, ZohoBooks.creditnotes.READ
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
  if (!j.access_token) throw new Error(`Zoho sign-in failed: ${j.error ?? r.status}`);
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
    const d = j[one]!;
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
    docs.push({
      kind,
      // keyed by document number so API sync and file imports never double-count
      doc_id: no,
      doc_no: no,
      date: String(d["date"] ?? ""),
      status: String(d["status"] ?? ""),
      customer: String(d["customer_name"] ?? ""),
      lines,
    });
  }
  return docs;
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
        `Connected to Zoho, but it can't read invoices and credit notes yet. Make sure the code was generated with the scope ZohoBooks.invoices.READ,ZohoBooks.creditnotes.READ. (${e instanceof Error ? e.message : e})`,
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
