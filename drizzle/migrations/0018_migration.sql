-- 0018: one product, many vendors · low-stock reminders · saved bill drafts.

-- ---------------------------------------------------------------------------------------------
-- One product from several vendors. Each vendor's latest bill price is kept per product; the
-- lowest price from a vendor we still buy from becomes the product's cost (and so its price).
-- ---------------------------------------------------------------------------------------------
alter table public.products add column if not exists alias_codes text[] not null default '{}';
create index if not exists products_alias_codes_idx on public.products using gin (alias_codes);

create or replace view public.product_sources with (security_invoker = true) as
with l as (
  select rl.product_id, r.vendor_id, r.id as receipt_id, rl.unit_cost, rl.extra_cost,
         rl.vendor_item_code, rl.received_qty, rl.line_no, r.created_at,
         coalesce(r.bill_date, r.created_at::date) as bill_date
  from public.receipt_lines rl
  join public.receipts r on r.id = rl.receipt_id
  where r.receipt_type = 'bill' and r.reversed_at is null
    and r.vendor_id is not null and rl.product_id is not null
), latest as (
  select distinct on (product_id, vendor_id)
         product_id, vendor_id, unit_cost as last_cost, extra_cost as last_extra, bill_date as last_date
  from l where unit_cost is not null
  order by product_id, vendor_id, bill_date desc, created_at desc, line_no desc
), stats as (
  select product_id, vendor_id,
         count(distinct receipt_id)::int as bills,
         coalesce(sum(received_qty), 0)::int as units,
         round(sum(unit_cost * received_qty) filter (where unit_cost is not null)
               / nullif(sum(received_qty) filter (where unit_cost is not null), 0), 2) as avg_cost,
         min(unit_cost) as min_cost,
         max(bill_date) as last_bill,
         (array_agg(vendor_item_code order by bill_date desc, created_at desc)
            filter (where vendor_item_code is not null))[1] as vendor_code,
         max(created_at) as received_at
  from l group by product_id, vendor_id
)
select s.product_id, s.vendor_id, s.bills, s.units, s.avg_cost, s.min_cost, s.last_bill, s.vendor_code,
       la.last_cost, la.last_extra, la.last_date, s.received_at
from stats s left join latest la using (product_id, vendor_id);
grant select on public.product_sources to authenticated;

/** Vendors we no longer buy from don't set prices. */
create or replace function public.vendor_buys_from(p_status text) returns boolean
language sql immutable as $$ select coalesce(p_status, '') not in ('Archived', 'Exited', 'Paused') $$;

create or replace function public.refresh_product_cost(p_product uuid) returns void
language plpgsql security definer set search_path = public as $$
declare b record;
begin
  if p_product is null then return; end if;
  select s.vendor_id, s.last_cost, s.last_extra into b
  from public.product_sources s join public.vendors v on v.id = s.vendor_id
  where s.product_id = p_product and s.last_cost is not null and public.vendor_buys_from(v.status)
  order by s.last_cost asc, coalesce(s.last_extra, 0) asc, s.last_date desc
  limit 1;
  if not found then return; end if;
  update public.products
     set unit_cost = b.last_cost, extra_cost = b.last_extra, preferred_vendor_id = b.vendor_id, updated_at = now()
   where id = p_product
     and (unit_cost is distinct from b.last_cost or extra_cost is distinct from b.last_extra
          or preferred_vendor_id is distinct from b.vendor_id);
end $$;
revoke execute on function public.refresh_product_cost(uuid) from public, anon;

create or replace function public.trg_receipt_lines_cost() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then perform public.refresh_product_cost(old.product_id); end if;
  if tg_op = 'INSERT' or (tg_op = 'UPDATE' and new.product_id is distinct from old.product_id) then
    perform public.refresh_product_cost(new.product_id);
  end if;
  return null;
end $$;
drop trigger if exists receipt_lines_cost on public.receipt_lines;
create trigger receipt_lines_cost
  after insert or update of unit_cost, extra_cost, product_id or delete on public.receipt_lines
  for each row execute function public.trg_receipt_lines_cost();

create or replace function public.trg_receipts_cost() returns trigger
language plpgsql security definer set search_path = public as $$
declare x uuid;
begin
  for x in select distinct product_id from public.receipt_lines where receipt_id = new.id and product_id is not null loop
    perform public.refresh_product_cost(x);
  end loop;
  return null;
end $$;
drop trigger if exists receipts_cost on public.receipts;
create trigger receipts_cost
  after update of reversed_at, vendor_id, bill_date on public.receipts
  for each row when (old.reversed_at is distinct from new.reversed_at or old.vendor_id is distinct from new.vendor_id
                     or old.bill_date is distinct from new.bill_date)
  execute function public.trg_receipts_cost();

create or replace function public.trg_vendors_cost() returns trigger
language plpgsql security definer set search_path = public as $$
declare x uuid;
begin
  for x in select distinct rl.product_id from public.receipt_lines rl join public.receipts r on r.id = rl.receipt_id
           where r.vendor_id = new.id and rl.product_id is not null loop
    perform public.refresh_product_cost(x);
  end loop;
  return null;
end $$;
drop trigger if exists vendors_cost on public.vendors;
create trigger vendors_cost
  after update of status on public.vendors
  for each row when (public.vendor_buys_from(old.status) is distinct from public.vendor_buys_from(new.status))
  execute function public.trg_vendors_cost();

-- Bill edits: cost now follows the lowest vendor price, so every touched product is refreshed.
create or replace function public.update_bill(p_receipt uuid, p_header jsonb, p_lines jsonb)
 returns uuid[]
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare r record; l record; ln jsonb; v_email text; v_vendor uuid; v_bill text; v_qty int; v_delta int;
        v_stock int; v_code text; v_cost numeric; v_extra numeric; touched uuid[] := '{}'; x uuid;
begin
  if public.my_role() is distinct from 'owner' then raise exception 'Only the owner can edit bills'; end if;
  select email into v_email from user_roles where user_id = auth.uid();
  select * into r from receipts where id = p_receipt for update;
  if r.id is null then raise exception 'Bill not found'; end if;
  if r.reversed_at is not null then raise exception 'This bill was reversed — it can no longer be edited'; end if;

  v_vendor := case when p_header ? 'vendor_id' then nullif(p_header->>'vendor_id','')::uuid else r.vendor_id end;
  v_bill := case when p_header ? 'bill_no' then nullif(trim(p_header->>'bill_no'),'') else r.bill_no end;
  if r.receipt_type = 'bill' then
    if v_vendor is null then raise exception 'A vendor bill needs a vendor'; end if;
    if v_bill is null then raise exception 'A vendor bill needs a bill number'; end if;
    if exists (select 1 from receipts x where x.id <> r.id and x.receipt_type='bill' and x.reversed_at is null
               and x.vendor_id = v_vendor and lower(x.bill_no) = lower(v_bill)) then
      raise exception 'Bill % from this vendor already exists', v_bill;
    end if;
  end if;

  update receipts set
    vendor_id = v_vendor, bill_no = v_bill,
    bill_date = case when p_header ? 'bill_date' then nullif(p_header->>'bill_date','')::date else bill_date end,
    bill_total = case when p_header ? 'bill_total' then nullif(p_header->>'bill_total','')::numeric else bill_total end,
    notes = case when p_header ? 'notes' then nullif(trim(p_header->>'notes'),'') else notes end,
    charges = case when p_header ? 'charges' then p_header->'charges' else charges end,
    goods_value = case when p_header ? 'goods_value' then nullif(p_header->>'goods_value','')::numeric else goods_value end,
    charges_total = case when p_header ? 'charges_total' then nullif(p_header->>'charges_total','')::numeric else charges_total end,
    gst_total = case when p_header ? 'gst_total' then nullif(p_header->>'gst_total','')::numeric else gst_total end,
    total_cost = case when p_header ? 'total_cost' then nullif(p_header->>'total_cost','')::numeric else total_cost end,
    gst_type = case when p_header ? 'gst_type' then nullif(p_header->>'gst_type','') else gst_type end,
    gst_breakup = case when p_header ? 'gst_breakup' then p_header->'gst_breakup' else gst_breakup end,
    edited_at = now(), edited_by_email = v_email
  where id = r.id;

  for ln in select * from jsonb_array_elements(coalesce(p_lines,'[]'::jsonb)) loop
    select * into l from receipt_lines where id = (ln->>'id')::uuid and receipt_id = r.id for update;
    if l.id is null then raise exception 'Bill line not found'; end if;
    v_qty := case when ln ? 'received_qty' then (ln->>'received_qty')::int else l.received_qty end;
    if v_qty is null or v_qty < 0 then raise exception 'Received quantity must be 0 or more'; end if;
    v_cost := case when ln ? 'unit_cost' then nullif(ln->>'unit_cost','')::numeric else l.unit_cost end;
    v_extra := case when ln ? 'extra_cost' then nullif(ln->>'extra_cost','')::numeric else l.extra_cost end;
    v_delta := v_qty - l.received_qty;
    if v_delta <> 0 and l.product_id is not null then
      select stock, code into v_stock, v_code from products where id = l.product_id for update;
      if v_stock + v_delta < 0 then raise exception '% has only % in stock — can''t lower this line by %', v_code, v_stock, -v_delta; end if;
      update products set stock = stock + v_delta, updated_at = now() where id = l.product_id;
      insert into adjustments(product_id, qty, reason, note, receipt_id, created_by, created_by_email)
      values (l.product_id, v_delta, 'Bill correction',
              coalesce('Bill ' || v_bill, r.receipt_type) || ': received ' || l.received_qty || ' → ' || v_qty, r.id, auth.uid(), v_email);
    end if;
    update receipt_lines set
      received_qty = v_qty, unit_cost = v_cost, extra_cost = v_extra,
      gst_rate = case when ln ? 'gst_rate' then nullif(ln->>'gst_rate','')::numeric else gst_rate end,
      billed_qty = case when ln ? 'billed_qty' then nullif(ln->>'billed_qty','')::numeric else billed_qty end
    where id = l.id;
    if r.receipt_type = 'bill' and l.product_id is not null and not (l.product_id = any(touched)) then
      touched := touched || l.product_id;
    end if;
  end loop;
  foreach x in array touched loop perform public.refresh_product_cost(x); end loop;
  return touched;
end $function$;

-- Old product codes that were merged into another product (so Zoho sales by the old SKU still land).
create or replace function public.resolve_sale_product(p_item_id text, p_sku text, p_name text)
 returns uuid language sql stable security definer set search_path to 'public' as $function$
  select coalesce(
    (select product_id from zoho_item_map where zoho_key = 'i:' || p_item_id and p_item_id is not null),
    (select id from products where p_sku is not null and p_sku <> '' and upper(code) = upper(trim(p_sku))),
    (select id from products where p_sku is not null and p_sku <> '' and upper(trim(p_sku)) = any(alias_codes) limit 1),
    (select product_id from zoho_item_map where zoho_key = 'n:' || lower(trim(p_name)) and p_name is not null),
    (select id from products where p_name is not null and (lower(friendly_name) = lower(trim(p_name)) or upper(code) = upper(trim(p_name))) limit 1)
  ) $function$;

-- Two codes that are really the same product: move everything onto one and delete the other.
create or replace function public.merge_products(p_from uuid, p_into uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a record; b record; v_email text;
begin
  if not public.can_edit() then raise exception 'Only editors can link products'; end if;
  if p_from = p_into then raise exception 'Pick a different product'; end if;
  select * into a from products where id = p_from for update;
  select * into b from products where id = p_into for update;
  if a.id is null or b.id is null then raise exception 'Product not found'; end if;
  if exists (select 1 from bill_submissions s where s.status = 'pending' and s.payload::text like '%' || p_from::text || '%') then
    raise exception '% is on a bill waiting for approval — approve or send it back first', a.code;
  end if;
  select email into v_email from user_roles where user_id = auth.uid();

  update receipt_lines set product_id = p_into where product_id = p_from;
  update vendor_codes set product_id = p_into where product_id = p_from;
  update adjustments set product_id = p_into where product_id = p_from;
  update sales_lines set product_id = p_into where product_id = p_from;
  update zoho_item_map set product_id = p_into where product_id = p_from;
  update product_photos set product_id = p_into, is_main = false, sort = coalesce(sort, 0) + 1000
   where product_id = p_from;
  update products set
    stock = stock + a.stock,
    alias_codes = array(select distinct x from unnest(b.alias_codes || a.alias_codes || array[upper(a.code)]) x
                        where x <> upper(b.code)),
    location = coalesce(location, a.location),
    description = coalesce(description, a.description),
    updated_at = now()
  where id = p_into;
  insert into adjustments(product_id, qty, reason, note, created_by, created_by_email)
  values (p_into, 0, 'Linked product',
          a.code || ' (' || a.friendly_name || ') is now this product — its ' || a.stock || ' in stock, bills and sales moved here',
          auth.uid(), v_email);
  delete from products where id = p_from;
  delete from design_families f where f.id = a.family_id and not exists (select 1 from products x where x.family_id = f.id);
  perform public.refresh_product_cost(p_into);
  return jsonb_build_object('into', b.code, 'from', a.code, 'stock', a.stock);
end $$;
revoke execute on function public.merge_products(uuid, uuid) from public, anon;
grant execute on function public.merge_products(uuid, uuid) to authenticated;

-- Bring every product in line with its lowest vendor price now.
do $$ declare x uuid; begin
  for x in select distinct product_id from receipt_lines where product_id is not null loop
    perform public.refresh_product_cost(x);
  end loop;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Low-stock reminders. products.reorder_point: null = use the category's level, 0 = never remind.
-- Category levels live in app_settings.data.reorder. Decisions from the dashboard are kept here.
-- ---------------------------------------------------------------------------------------------
alter table public.products alter column reorder_point drop default;
update public.products set reorder_point = null where reorder_point = 0;

create table if not exists public.reorder_flags (
  product_id uuid primary key references public.products(id) on delete cascade,
  state text not null check (state in ('ordered', 'ignored')),
  until date,
  qty int,
  vendor_id uuid references public.vendors(id) on delete set null,
  note text,
  created_by uuid default auth.uid(),
  created_by_email text,
  created_at timestamptz not null default now()
);
alter table public.reorder_flags enable row level security;
create policy "members read" on public.reorder_flags for select using ((select is_member()));
create policy "contrib add" on public.reorder_flags for insert with check ((select can_contribute()));
create policy "contrib change" on public.reorder_flags for update using ((select can_contribute())) with check ((select can_contribute()));
create policy "contrib delete" on public.reorder_flags for delete using ((select can_contribute()));

-- ---------------------------------------------------------------------------------------------
-- Saved bill drafts: park a bill with a problem, carry on with the next one, reopen it later.
-- ---------------------------------------------------------------------------------------------
create table if not exists public.bill_drafts (
  id uuid primary key default gen_random_uuid(),
  vendor_name text,
  bill_no text,
  bill_date date,
  line_count int not null default 0,
  value numeric,
  note text,
  data jsonb not null,
  created_by uuid not null default auth.uid(),
  created_by_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by_email text
);
create index if not exists bill_drafts_updated_idx on public.bill_drafts (updated_at desc);
alter table public.bill_drafts enable row level security;
create policy "contrib read" on public.bill_drafts for select using ((select can_contribute()));
create policy "contrib add" on public.bill_drafts for insert with check ((select can_contribute()) and created_by = (select auth.uid()));
create policy "contrib change" on public.bill_drafts for update using ((select can_contribute())) with check ((select can_contribute()));
create policy "author or editor delete" on public.bill_drafts for delete using ((select can_edit()) or created_by = (select auth.uid()));
