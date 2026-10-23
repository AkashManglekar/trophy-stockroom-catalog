-- 0009: vendor payables & feedback, Zoho sales → stock out, catalogue quote requests. Idempotent.

-- ---------- PAYABLES ----------
alter table public.receipts add column if not exists due_date date;

-- "Net 30" → 30, "Due on receipt" → 0, "Due end of month" → days to month end. Unknown → 30.
create or replace function public.terms_days(p_terms text, p_from date) returns int
language sql immutable as $$
  select case
    when p_terms is null then 30
    when p_terms ~* 'receipt' then 0
    when p_terms ~* 'end of next month' then ((date_trunc('month', p_from) + interval '2 month - 1 day')::date - p_from)
    when p_terms ~* 'end of (the )?month' then ((date_trunc('month', p_from) + interval '1 month - 1 day')::date - p_from)
    when p_terms ~ '\d+' then (substring(p_terms from '\d+'))::int
    else 30 end $$;

create or replace function public.receipt_due_default() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.receipt_type = 'bill' and new.due_date is null then
    new.due_date := coalesce(new.bill_date, current_date) +
      public.terms_days((select payment_terms from vendors where id = new.vendor_id), coalesce(new.bill_date, current_date));
  end if;
  return new;
end $$;
drop trigger if exists receipts_due_default on public.receipts;
create trigger receipts_due_default before insert on public.receipts for each row execute function public.receipt_due_default();
update public.receipts r set due_date = coalesce(r.bill_date, r.created_at::date) +
  public.terms_days((select payment_terms from vendors v where v.id = r.vendor_id), coalesce(r.bill_date, r.created_at::date))
where r.receipt_type = 'bill' and r.due_date is null;

create table if not exists public.bill_payments (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references public.receipts(id) on delete cascade,
  paid_on date not null default current_date,
  amount numeric not null check (amount > 0),
  mode text, reference text, note text,
  created_by_email text, created_at timestamptz not null default now()
);
create index if not exists bill_payments_receipt on public.bill_payments(receipt_id);
grant select, insert, update, delete on public.bill_payments to authenticated;
grant all on public.bill_payments to service_role;
alter table public.bill_payments enable row level security;
drop policy if exists "members read" on public.bill_payments;
drop policy if exists "editors write" on public.bill_payments;
create policy "members read" on public.bill_payments for select to authenticated using (public.is_member());
create policy "editors write" on public.bill_payments for all to authenticated using (public.can_edit()) with check (public.can_edit());

-- Owner/editors can set a bill's due date.
create or replace function public.set_bill_due(p_receipt uuid, p_due date) returns void
language plpgsql security definer set search_path=public as $$
begin
  if not public.can_edit() then raise exception 'Only editors can change due dates'; end if;
  update receipts set due_date = p_due where id = p_receipt;
end $$;
grant execute on function public.set_bill_due(uuid, date) to authenticated;

-- ---------- VENDOR FEEDBACK ----------
create table if not exists public.vendor_reviews (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.vendors(id) on delete cascade,
  receipt_id uuid references public.receipts(id) on delete set null,
  quality int check (quality between 1 and 5),
  delivery int check (delivery between 1 and 5),
  pricing int check (pricing between 1 and 5),
  comment text,
  created_by uuid default auth.uid(), created_by_email text, created_at timestamptz not null default now()
);
create index if not exists vendor_reviews_vendor on public.vendor_reviews(vendor_id);
grant select, insert, update, delete on public.vendor_reviews to authenticated;
grant all on public.vendor_reviews to service_role;
alter table public.vendor_reviews enable row level security;
drop policy if exists "members read" on public.vendor_reviews;
drop policy if exists "contrib add" on public.vendor_reviews;
drop policy if exists "own or editor change" on public.vendor_reviews;
create policy "members read" on public.vendor_reviews for select to authenticated using (public.is_member());
create policy "contrib add" on public.vendor_reviews for insert to authenticated with check (public.can_contribute());
create policy "own or editor change" on public.vendor_reviews for delete to authenticated
  using (public.can_edit() or created_by = auth.uid());

-- ---------- SALES (Zoho invoices / credit notes → stock out / back) ----------
create table if not exists public.sales_lines (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'zoho',
  doc_kind text not null check (doc_kind in ('invoice','credit')),
  doc_id text not null, doc_no text, doc_date date, doc_status text, customer text,
  line_key text not null,
  zoho_item_id text, item_name text, sku text,
  product_id uuid references public.products(id) on delete set null,
  qty numeric not null default 0, rate numeric, amount numeric,
  applied_qty int not null default 0, -- stock change already applied (sale = negative)
  updated_at timestamptz not null default now(),
  unique (source, doc_kind, doc_id, line_key)
);
create index if not exists sales_lines_date on public.sales_lines(doc_date desc);
create index if not exists sales_lines_product on public.sales_lines(product_id);
create table if not exists public.zoho_item_map (
  zoho_key text primary key, -- 'i:<item_id>' or 'n:<lower item name>'
  product_id uuid not null references public.products(id) on delete cascade,
  created_at timestamptz not null default now()
);
do $$ declare t text; begin
  foreach t in array array['sales_lines','zoho_item_map'] loop
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "members read" on public.%I', t);
    execute format('create policy "members read" on public.%I for select to authenticated using (public.is_member())', t);
  end loop;
end $$;

create or replace function public.resolve_sale_product(p_item_id text, p_sku text, p_name text) returns uuid
language sql stable security definer set search_path=public as $$
  select coalesce(
    (select product_id from zoho_item_map where zoho_key = 'i:' || p_item_id and p_item_id is not null),
    (select id from products where p_sku is not null and p_sku <> '' and upper(code) = upper(trim(p_sku))),
    (select product_id from zoho_item_map where zoho_key = 'n:' || lower(trim(p_name)) and p_name is not null),
    (select id from products where p_name is not null and (lower(friendly_name) = lower(trim(p_name)) or upper(code) = upper(trim(p_name))) limit 1)
  ) $$;

-- Applies one sales line: makes the stock effect match what the document says now (idempotent).
create or replace function public.apply_sale_line(p_line uuid) returns int
language plpgsql security definer set search_path=public as $$
declare s record; v_want int; v_delta int; v_active boolean;
begin
  select * into s from sales_lines where id = p_line for update;
  if s.id is null then return 0; end if;
  if s.product_id is null then
    update sales_lines set product_id = public.resolve_sale_product(s.zoho_item_id, s.sku, s.item_name) where id = s.id
      returning * into s;
  end if;
  v_active := case when s.doc_kind = 'invoice' then coalesce(s.doc_status,'') not in ('draft','void')
                   else coalesce(s.doc_status,'') not in ('draft','void') end;
  v_want := case when not v_active or s.product_id is null then 0
                 when s.doc_kind = 'invoice' then -round(s.qty)::int else round(s.qty)::int end;
  if s.product_id is null then return 0; end if;
  v_delta := v_want - s.applied_qty;
  if v_delta <> 0 then
    update products set stock = stock + v_delta, updated_at = now() where id = s.product_id;
    insert into adjustments(product_id, qty, reason, note, created_by_email)
    values (s.product_id, v_delta,
      case when s.doc_kind = 'invoice' and v_delta < 0 then 'Sale (Zoho)'
           when s.doc_kind = 'credit' and v_delta > 0 then 'Return (Zoho credit note)'
           else 'Zoho correction' end,
      coalesce(s.doc_no, s.doc_id) || coalesce(' · ' || s.customer, ''), 'zoho-sync');
    update sales_lines set applied_qty = v_want, updated_at = now() where id = s.id;
  end if;
  return v_delta;
end $$;

-- Takes whole documents (invoice / credit note with all lines) and reconciles stock.
-- Lines removed from a document are zeroed. Callable by the server (service role) or publishers.
create or replace function public.apply_sales(p_docs jsonb, p_source text default 'zoho') returns jsonb
language plpgsql security definer set search_path=public as $$
declare d jsonb; ln jsonb; v_id uuid; keys text[]; applied int := 0; lines int := 0; x record;
begin
  if not (coalesce(auth.role(),'') = 'service_role' or public.can_publish()) then
    raise exception 'Only people who can publish bills can import sales';
  end if;
  for d in select * from jsonb_array_elements(coalesce(p_docs,'[]'::jsonb)) loop
    keys := '{}';
    for ln in select * from jsonb_array_elements(coalesce(d->'lines','[]'::jsonb)) loop
      lines := lines + 1;
      keys := keys || (ln->>'line_key');
      insert into sales_lines(source, doc_kind, doc_id, doc_no, doc_date, doc_status, customer, line_key,
                              zoho_item_id, item_name, sku, qty, rate, amount, updated_at)
      values (p_source, d->>'kind', d->>'doc_id', d->>'doc_no', nullif(d->>'date','')::date, d->>'status', d->>'customer',
              ln->>'line_key', nullif(ln->>'item_id',''), ln->>'name', nullif(ln->>'sku',''),
              coalesce((ln->>'qty')::numeric,0), nullif(ln->>'rate','')::numeric, nullif(ln->>'amount','')::numeric, now())
      on conflict (source, doc_kind, doc_id, line_key) do update set
        doc_no = excluded.doc_no, doc_date = excluded.doc_date, doc_status = excluded.doc_status, customer = excluded.customer,
        zoho_item_id = excluded.zoho_item_id, item_name = excluded.item_name, sku = excluded.sku,
        qty = excluded.qty, rate = excluded.rate, amount = excluded.amount, updated_at = now()
      returning id into v_id;
      applied := applied + abs(public.apply_sale_line(v_id));
    end loop;
    -- lines no longer on the document
    for x in select id from sales_lines where source = p_source and doc_kind = d->>'kind' and doc_id = d->>'doc_id'
             and not (line_key = any(keys)) loop
      update sales_lines set qty = 0, updated_at = now() where id = x.id;
      applied := applied + abs(public.apply_sale_line(x.id));
    end loop;
  end loop;
  return jsonb_build_object('lines', lines, 'units_applied', applied,
    'unmatched', (select count(*) from sales_lines where product_id is null and qty <> 0));
end $$;

-- Map a Zoho item (or item name) to a product, then apply any waiting lines for it.
create or replace function public.map_sale_item(p_key text, p_product uuid) returns int
language plpgsql security definer set search_path=public as $$
declare x record; n int := 0;
begin
  if not public.can_publish() then raise exception 'Only people who can publish bills can map items'; end if;
  insert into zoho_item_map(zoho_key, product_id) values (p_key, p_product)
  on conflict (zoho_key) do update set product_id = excluded.product_id;
  for x in select id from sales_lines where product_id is null
           and (('i:' || zoho_item_id) = p_key or ('n:' || lower(trim(item_name))) = p_key) loop
    perform public.apply_sale_line(x.id); n := n + 1;
  end loop;
  return n;
end $$;
grant execute on function public.apply_sales(jsonb, text), public.map_sale_item(text, uuid) to authenticated;
revoke execute on function public.apply_sale_line(uuid) from public, anon, authenticated;

-- ---------- QUOTE REQUESTS (public catalogue) ----------
create sequence if not exists public.quote_ref_seq start 1001;
create table if not exists public.quote_requests (
  id uuid primary key default gen_random_uuid(),
  ref text not null unique default ('Q-' || nextval('public.quote_ref_seq')),
  name text not null, phone text not null, email text, organisation text, city text,
  needed_by date, notes text,
  items jsonb not null default '[]', est_total numeric,
  status text not null default 'new' check (status in ('new','contacted','quoted','won','lost')),
  internal_notes text, handled_by_email text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists quote_requests_created on public.quote_requests(created_at desc);
grant select, update on public.quote_requests to authenticated;
grant all on public.quote_requests to service_role;
grant usage on sequence public.quote_ref_seq to service_role;
alter table public.quote_requests enable row level security;
drop policy if exists "members read" on public.quote_requests;
drop policy if exists "contrib update" on public.quote_requests;
create policy "members read" on public.quote_requests for select to authenticated using (public.is_member());
create policy "contrib update" on public.quote_requests for update to authenticated
  using (public.can_contribute()) with check (public.can_contribute());
