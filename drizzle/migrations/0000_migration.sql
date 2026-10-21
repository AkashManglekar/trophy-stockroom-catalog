
-- ROLES
create type public.app_role as enum ('owner','editor','contributor','viewer');
create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null unique,
  email text,
  role app_role not null default 'viewer',
  created_at timestamptz not null default now()
);
grant select, update on public.user_roles to authenticated;
grant all on public.user_roles to service_role;
alter table public.user_roles enable row level security;

create or replace function public.my_role() returns app_role language sql stable security definer set search_path=public as $$
  select role from public.user_roles where user_id = auth.uid() $$;
create or replace function public.is_member() returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.user_roles where user_id = auth.uid()) $$;
create or replace function public.can_edit() returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.user_roles where user_id = auth.uid() and role in ('owner','editor')) $$;
create or replace function public.can_contribute() returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.user_roles where user_id = auth.uid() and role in ('owner','editor','contributor')) $$;

create policy "members read roles" on public.user_roles for select to authenticated using (public.is_member());
create policy "owners update roles" on public.user_roles for update to authenticated using (public.my_role()='owner') with check (public.my_role()='owner');

create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into public.user_roles(user_id,email,role)
  values (new.id, new.email, case when exists(select 1 from public.user_roles) then 'viewer'::app_role else 'owner'::app_role end)
  on conflict (user_id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- CODE LISTS
create table public.divisions (
  code text primary key, name text not null, letter text not null unique,
  freight_pct numeric not null default 0, packaging numeric not null default 0,
  rounding numeric not null default 10, target_margin numeric not null default 0,
  floor_margin numeric not null default 0, bulk_pct numeric not null default 0,
  bulk_min_qty int not null default 1, pricing_mode text not null default 'bands', sort int not null default 0
);
create table public.types (
  id uuid primary key default gen_random_uuid(),
  div text not null references public.divisions(code) on update cascade,
  code text not null, name text not null, letter text not null,
  size_unit text not null default 'none', uom text not null default 'pcs',
  hsn text, gst numeric, is_service boolean not null default false,
  margin_override numeric,
  unique(div,code), unique(div,letter)
);
create table public.code_lists (
  kind text not null, code text not null, name text not null, sort int not null default 0,
  primary key(kind, code)
);
create table public.app_settings (id int primary key default 1, data jsonb not null default '{}'::jsonb, updated_at timestamptz default now());
create table public.code_counters (prefix text primary key, next_no int not null default 1001);

do $$ declare t text; begin
  foreach t in array array['divisions','types','code_lists','app_settings','code_counters'] loop
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "members read" on public.%I for select to authenticated using (public.is_member())', t);
    execute format('create policy "editors write" on public.%I for all to authenticated using (public.can_edit()) with check (public.can_edit())', t);
  end loop;
end $$;

-- VENDORS
create table public.vendors (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  display_name text not null, company text, salutation text, first_name text, last_name text,
  email text, phone text, mobile text, website text,
  gst_treatment text not null default 'business_registered_regular', gstin text, source_of_supply text,
  pan text, msme text,
  billing_attention text, street1 text, street2 text, city text, state text, pin text, country text default 'India',
  payment_terms text default 'Net 30', currency text default 'INR',
  bank_holder text, bank_name text, bank_account text, ifsc text,
  divisions text[] default '{}', lead_time_days int, moq text, status text not null default 'Prospect',
  quality int, notes text, is_sample boolean not null default false,
  created_at timestamptz default now(), updated_at timestamptz default now()
);
create unique index vendors_name_uq on public.vendors (lower(display_name));
create unique index vendors_gstin_uq on public.vendors (upper(gstin)) where gstin is not null and gstin <> '';
grant select, insert, update, delete on public.vendors to authenticated;
grant all on public.vendors to service_role;
alter table public.vendors enable row level security;
create policy "members read" on public.vendors for select to authenticated using (public.is_member());
create policy "contrib insert" on public.vendors for insert to authenticated with check (public.can_contribute());
create policy "contrib update" on public.vendors for update to authenticated using (public.can_contribute()) with check (public.can_contribute());
create policy "editor delete" on public.vendors for delete to authenticated using (public.can_edit());

create or replace function public.next_vendor_code() returns text language sql security definer set search_path=public as $$
  select 'V' || lpad((coalesce(max(substring(code from 2)::int),0)+1)::text, 3, '0') from public.vendors where code ~ '^V[0-9]+$' $$;
create or replace function public.vendor_code_default() returns trigger language plpgsql security definer set search_path=public as $$
begin
  perform pg_advisory_xact_lock(hashtext('vendor_code'));
  if new.code is null or new.code = '' then new.code := public.next_vendor_code(); end if;
  new.updated_at := now();
  return new;
end $$;
alter table public.vendors alter column code set default '';
create trigger vendors_code before insert on public.vendors for each row execute function public.vendor_code_default();

-- DESIGN FAMILIES & PRODUCTS
create table public.design_families (
  id uuid primary key default gen_random_uuid(),
  div text not null, type text not null, mat text not null, sport text not null,
  design_no int not null, design_name text,
  unique(div,type,mat,sport,design_no)
);
create unique index families_name_uq on public.design_families (lower(design_name)) where design_name is not null and design_name <> '';

create table public.products (
  id uuid primary key default gen_random_uuid(),
  code text not null unique, prefix text not null,
  family_id uuid not null references public.design_families(id),
  div text not null, type text not null, mat text not null, sport text not null,
  size text not null default '000', finish text not null default 'NA',
  spec_code text not null unique, friendly_name text not null,
  status text not null default 'Active',
  unit_cost numeric, preferred_vendor_id uuid references public.vendors(id) on delete set null,
  location text, reorder_point int default 0, award_class text, customisable boolean default false,
  description text, stock int not null default 0,
  price_mode text not null default 'auto', price_value numeric,
  landed numeric, selling numeric, mrp numeric, floor_price numeric, bulk_price numeric, bulk_min_qty int,
  gst numeric, price_rule text,
  is_sample boolean not null default false,
  created_at timestamptz default now(), updated_at timestamptz default now()
);
create unique index products_friendly_uq on public.products (lower(friendly_name));

create table public.product_photos (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  url text not null, path text, is_main boolean not null default false, sort int not null default 0,
  created_at timestamptz default now()
);
create table public.vendor_codes (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.vendors(id) on delete cascade,
  match_key text not null, vendor_item_code text, description text,
  product_id uuid not null references public.products(id) on delete cascade,
  last_cost numeric, updated_at timestamptz default now(),
  unique(vendor_id, match_key)
);
create table public.receipts (
  id uuid primary key default gen_random_uuid(),
  receipt_type text not null, vendor_id uuid references public.vendors(id) on delete set null,
  bill_no text, bill_date date, bill_total numeric, notes text,
  created_by uuid, created_by_email text, created_at timestamptz default now(),
  reversed_at timestamptz, reversed_by_email text
);
create unique index receipts_bill_uq on public.receipts (vendor_id, lower(bill_no)) where receipt_type='bill' and reversed_at is null;
create table public.receipt_lines (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references public.receipts(id) on delete cascade,
  line_no int not null, product_id uuid references public.products(id) on delete cascade,
  vendor_item_code text, description text, billed_qty numeric, received_qty int not null default 0,
  unit_cost numeric, location text, created_new boolean not null default false
);
create table public.adjustments (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  qty int not null, reason text not null, note text, receipt_id uuid references public.receipts(id) on delete set null,
  created_by uuid, created_by_email text, created_at timestamptz default now()
);
create table public.guide_progress (
  user_id uuid not null, lesson_id text not null, done_at timestamptz default now(),
  primary key(user_id, lesson_id)
);
create table public.zoho_exports (
  id uuid primary key default gen_random_uuid(), kind text not null,
  created_at timestamptz default now(), created_by_email text, records int
);

do $$ declare t text; begin
  foreach t in array array['design_families','products','product_photos','vendor_codes','receipts','receipt_lines','adjustments','zoho_exports'] loop
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "members read" on public.%I for select to authenticated using (public.is_member())', t);
    execute format('create policy "editor delete" on public.%I for delete to authenticated using (public.can_edit())', t);
  end loop;
end $$;
create policy "contrib update" on public.products for update to authenticated using (public.can_contribute()) with check (public.can_contribute());
create policy "contrib update" on public.design_families for update to authenticated using (public.can_contribute()) with check (public.can_contribute());
create policy "contrib insert" on public.product_photos for insert to authenticated with check (public.can_contribute());
create policy "contrib update" on public.product_photos for update to authenticated using (public.can_contribute()) with check (public.can_contribute());
create policy "contrib delete" on public.product_photos for delete to authenticated using (public.can_contribute());
create policy "contrib delete" on public.vendor_codes for delete to authenticated using (public.can_contribute());
create policy "member insert" on public.zoho_exports for insert to authenticated with check (public.is_member());

grant select, insert, update, delete on public.guide_progress to authenticated;
grant all on public.guide_progress to service_role;
alter table public.guide_progress enable row level security;
create policy "own progress" on public.guide_progress for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- RECEIVE (atomic)
create or replace function public.receive_stock(payload jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_uid uuid := auth.uid(); v_email text; v_rid uuid; v_type text := payload->>'receipt_type';
  v_vendor uuid := nullif(payload->>'vendor_id','')::uuid;
  ln jsonb; nw jsonb; v_pid uuid; v_fid uuid; v_dno int; v_prefix text; v_no int; v_code text;
  v_size text; v_spec text; fam_map jsonb := '{}'::jsonb; created jsonb := '[]'::jsonb;
  v_key text; v_qty int; v_cost numeric; v_new boolean; pr jsonb;
begin
  if not public.can_contribute() then raise exception 'You do not have permission to receive stock'; end if;
  select email into v_email from public.user_roles where user_id = v_uid;
  if v_type not in ('bill','opening','return') then raise exception 'Invalid receipt type'; end if;
  if v_type='bill' then
    if v_vendor is null then raise exception 'Vendor is required for a vendor bill'; end if;
    if coalesce(trim(payload->>'bill_no'),'')='' then raise exception 'Bill number is required'; end if;
    perform pg_advisory_xact_lock(hashtext('bill:'||v_vendor::text||':'||lower(trim(payload->>'bill_no'))));
    if exists(select 1 from receipts where receipt_type='bill' and reversed_at is null and vendor_id=v_vendor and lower(bill_no)=lower(trim(payload->>'bill_no'))) then
      raise exception 'Bill % from this vendor has already been received', payload->>'bill_no';
    end if;
  end if;
  insert into receipts(receipt_type,vendor_id,bill_no,bill_date,bill_total,notes,created_by,created_by_email)
  values (v_type, v_vendor, nullif(trim(payload->>'bill_no'),''), nullif(payload->>'bill_date','')::date,
          nullif(payload->>'bill_total','')::numeric, payload->>'notes', v_uid, v_email)
  returning id into v_rid;

  for ln in select * from jsonb_array_elements(payload->'lines') loop
    v_qty := coalesce((ln->>'received_qty')::int,0);
    v_cost := nullif(ln->>'unit_cost','')::numeric;
    v_new := false;
    pr := ln->'prices';
    if nullif(ln->>'product_id','') is not null then
      v_pid := (ln->>'product_id')::uuid;
      perform 1 from products where id=v_pid for update;
      if not found then raise exception 'Line %: product not found', ln->>'line_no'; end if;
    else
      nw := ln->'new';
      if nw is null then raise exception 'Line %: no product', ln->>'line_no'; end if;
      v_new := true;
      -- resolve family
      if nw->>'design_mode' = 'existing' then
        v_fid := (nw->>'family_id')::uuid;
        select design_no into v_dno from design_families where id=v_fid;
        if v_dno is null then raise exception 'Line %: design family not found', ln->>'line_no'; end if;
      elsif nw->>'design_mode' = 'same' then
        v_fid := (fam_map->>(nw->>'same_as_line'))::uuid;
        if v_fid is null then raise exception 'Line %: referenced line has no new design', ln->>'line_no'; end if;
        select design_no into v_dno from design_families where id=v_fid;
      else
        perform pg_advisory_xact_lock(hashtext('fam:'||(nw->>'div')||(nw->>'type')||(nw->>'mat')||(nw->>'sport')));
        select coalesce(max(design_no),0)+1 into v_dno from design_families
          where div=nw->>'div' and type=nw->>'type' and mat=nw->>'mat' and sport=nw->>'sport';
        if nullif(trim(nw->>'design_name'),'') is not null and exists(select 1 from design_families where lower(design_name)=lower(trim(nw->>'design_name'))) then
          raise exception 'Line %: design name "%" already belongs to another design family', ln->>'line_no', nw->>'design_name';
        end if;
        insert into design_families(div,type,mat,sport,design_no,design_name)
        values (nw->>'div',nw->>'type',nw->>'mat',nw->>'sport',v_dno,nullif(trim(nw->>'design_name'),''))
        returning id into v_fid;
      end if;
      fam_map := fam_map || jsonb_build_object(ln->>'line_no', v_fid::text);
      select d.letter||t.letter into v_prefix from divisions d join types t on t.div=d.code and t.code=nw->>'type' where d.code=nw->>'div';
      if v_prefix is null then raise exception 'Line %: unknown division/type', ln->>'line_no'; end if;
      insert into code_counters(prefix,next_no) values (v_prefix,1001) on conflict (prefix) do nothing;
      update code_counters set next_no = next_no + 1 where prefix=v_prefix returning next_no - 1 into v_no;
      v_code := v_prefix || '-' || v_no;
      v_size := coalesce(nullif(nw->>'size',''),'000');
      v_spec := (nw->>'div')||'-'||(nw->>'type')||'-'||(nw->>'mat')||'-'||(nw->>'sport')||'-'||lpad(v_dno::text,3,'0')||'-'||v_size||'-'||coalesce(nullif(nw->>'finish',''),'NA');
      if exists(select 1 from products where spec_code=v_spec) then raise exception 'Line %: a product with spec % already exists — link to it instead', ln->>'line_no', v_spec; end if;
      if exists(select 1 from products where lower(friendly_name)=lower(nw->>'friendly_name')) then raise exception 'Line %: "%" already exists — link to existing instead', ln->>'line_no', nw->>'friendly_name'; end if;
      insert into products(code,prefix,family_id,div,type,mat,sport,size,finish,spec_code,friendly_name,status,unit_cost,
        preferred_vendor_id,location,description,stock,landed,selling,mrp,floor_price,bulk_price,bulk_min_qty,gst,price_rule)
      values (v_code,v_prefix,v_fid,nw->>'div',nw->>'type',nw->>'mat',nw->>'sport',v_size,coalesce(nullif(nw->>'finish',''),'NA'),v_spec,
        nw->>'friendly_name','Active',v_cost,v_vendor,nullif(ln->>'location',''),nullif(nw->>'description',''),0,
        (pr->>'landed')::numeric,(pr->>'selling')::numeric,(pr->>'mrp')::numeric,(pr->>'floor')::numeric,(pr->>'bulk')::numeric,(pr->>'bulk_min')::int,(pr->>'gst')::numeric,pr->>'rule')
      returning id into v_pid;
      created := created || jsonb_build_object('product_id',v_pid,'code',v_code,'friendly_name',nw->>'friendly_name','qty',v_qty,'line_no',(ln->>'line_no')::int);
    end if;

    update products set stock = stock + v_qty,
      location = coalesce(nullif(ln->>'location',''), location),
      unit_cost = case when v_type='bill' and v_cost is not null then v_cost else unit_cost end,
      preferred_vendor_id = case when v_type='bill' then v_vendor else preferred_vendor_id end,
      landed = case when v_type='bill' and pr is not null and pr->>'landed' is not null then (pr->>'landed')::numeric else landed end,
      selling = case when v_type='bill' and pr is not null and pr->>'selling' is not null then (pr->>'selling')::numeric else selling end,
      mrp = case when v_type='bill' and pr is not null and pr->>'mrp' is not null then (pr->>'mrp')::numeric else mrp end,
      floor_price = case when v_type='bill' and pr is not null and pr->>'floor' is not null then (pr->>'floor')::numeric else floor_price end,
      bulk_price = case when v_type='bill' and pr is not null and pr->>'bulk' is not null then (pr->>'bulk')::numeric else bulk_price end,
      gst = case when v_type='bill' and pr is not null and pr->>'gst' is not null then (pr->>'gst')::numeric else gst end,
      price_rule = case when v_type='bill' and pr is not null and pr->>'rule' is not null then pr->>'rule' else price_rule end,
      status = case when v_type<>'return' and status='Discontinued' then status else status end,
      updated_at = now()
    where id=v_pid;

    if v_vendor is not null then
      v_key := case when nullif(trim(ln->>'vendor_item_code'),'') is not null then 'c:'||lower(trim(ln->>'vendor_item_code'))
                    when nullif(trim(ln->>'norm_desc'),'') is not null then 'd:'||(ln->>'norm_desc') else null end;
      if v_key is not null then
        insert into vendor_codes(vendor_id,match_key,vendor_item_code,description,product_id,last_cost,updated_at)
        values (v_vendor,v_key,nullif(trim(ln->>'vendor_item_code'),''),ln->>'description',v_pid,v_cost,now())
        on conflict (vendor_id,match_key) do update set product_id=excluded.product_id,
          last_cost=coalesce(excluded.last_cost,vendor_codes.last_cost), description=excluded.description, updated_at=now();
      end if;
    end if;

    insert into receipt_lines(receipt_id,line_no,product_id,vendor_item_code,description,billed_qty,received_qty,unit_cost,location,created_new)
    values (v_rid,(ln->>'line_no')::int,v_pid,nullif(ln->>'vendor_item_code',''),ln->>'description',nullif(ln->>'billed_qty','')::numeric,v_qty,v_cost,nullif(ln->>'location',''),v_new);
  end loop;
  return jsonb_build_object('receipt_id',v_rid,'created',created);
end $$;

create or replace function public.reverse_receipt(p_receipt uuid) returns void
language plpgsql security definer set search_path=public as $$
declare r record; l record; v_email text;
begin
  if not public.can_contribute() then raise exception 'No permission'; end if;
  select email into v_email from user_roles where user_id=auth.uid();
  select * into r from receipts where id=p_receipt for update;
  if r.id is null then raise exception 'Receipt not found'; end if;
  if r.reversed_at is not null then raise exception 'This receipt was already reversed'; end if;
  for l in select * from receipt_lines where receipt_id=p_receipt loop
    if l.product_id is null or l.received_qty = 0 then continue; end if;
    update products set stock = stock - l.received_qty, updated_at=now() where id=l.product_id;
    insert into adjustments(product_id,qty,reason,note,receipt_id,created_by,created_by_email)
    values (l.product_id,-l.received_qty,'Receipt reversal',coalesce('Bill '||r.bill_no,r.receipt_type),p_receipt,auth.uid(),v_email);
    if l.created_new then
      update products set status='Discontinued' where id=l.product_id and stock<=0;
    end if;
  end loop;
  update receipts set reversed_at=now(), reversed_by_email=v_email where id=p_receipt;
end $$;

create or replace function public.adjust_stock(p_product uuid, p_qty int, p_reason text, p_note text) returns void
language plpgsql security definer set search_path=public as $$
declare v_email text;
begin
  if not public.can_contribute() then raise exception 'No permission'; end if;
  if p_qty = 0 then raise exception 'Quantity cannot be zero'; end if;
  select email into v_email from user_roles where user_id=auth.uid();
  update products set stock = stock + p_qty, updated_at=now() where id=p_product;
  if not found then raise exception 'Product not found'; end if;
  insert into adjustments(product_id,qty,reason,note,created_by,created_by_email)
  values (p_product,p_qty,p_reason,p_note,auth.uid(),v_email);
end $$;

create or replace function public.rename_family(p_family uuid, p_name text) returns void
language plpgsql security definer set search_path=public as $$
declare f record;
begin
  if not public.can_contribute() then raise exception 'No permission'; end if;
  if exists(select 1 from design_families where lower(design_name)=lower(trim(p_name)) and id<>p_family) then
    raise exception 'Design name "%" already belongs to another design family', p_name; end if;
  update design_families set design_name=trim(p_name) where id=p_family;
  update products set friendly_name = trim(p_name) || substring(friendly_name from position(' · ' in friendly_name)), updated_at=now()
    where family_id=p_family and position(' · ' in friendly_name) > 0;
  update products set friendly_name = trim(p_name), updated_at=now()
    where family_id=p_family and position(' · ' in friendly_name) = 0;
end $$;

-- PUBLIC CATALOGUE
create or replace function public.get_catalogue() returns table(code text, name text, price numeric, description text, type_name text, photos text[])
language sql stable security definer set search_path=public as $$
  select p.code, p.friendly_name, p.mrp,
    nullif(trim(regexp_replace(coalesce(p.description,''), '(HSN|SAC|GST|IGST|CGST|SGST)[^.,;\n]*', '', 'gi')),''),
    t.name,
    coalesce((select array_agg(ph.url order by ph.is_main desc, ph.sort, ph.created_at) from product_photos ph where ph.product_id=p.id), '{}')
  from products p join types t on t.div=p.div and t.code=p.type
  where p.status='Active'
    and p.div in (select jsonb_array_elements_text(coalesce((select data->'catalogue_divisions' from app_settings where id=1),'["TR"]'::jsonb)))
  order by t.name, p.friendly_name
$$;
create or replace function public.get_catalogue_logo() returns text language sql stable security definer set search_path=public as $$
  select data->>'logo_url' from app_settings where id=1 $$;
grant execute on function public.get_catalogue() to anon, authenticated;
grant execute on function public.get_catalogue_logo() to anon, authenticated;
revoke execute on function public.receive_stock(jsonb) from anon;
revoke execute on function public.reverse_receipt(uuid) from anon;
revoke execute on function public.adjust_stock(uuid,int,text,text) from anon;
revoke execute on function public.rename_family(uuid,text) from anon;
