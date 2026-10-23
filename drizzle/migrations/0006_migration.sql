-- 0006: one product code per design. Sizes (and finishes) are variants under that code with their own
-- SKU (e.g. TC-1005-11, TC-1005-14), price, cost and stock. New sizes of a design never use a new number.
-- Idempotent.

alter table public.design_families add column if not exists code text;
-- bill charges (shipping, packaging…) spread over the lines; kept per unit on the product for re-pricing
alter table public.products add column if not exists extra_cost numeric;
alter table public.receipt_lines add column if not exists extra_cost numeric;
alter table public.receipts add column if not exists charges jsonb;
alter table public.receipts add column if not exists goods_value numeric;
alter table public.receipts add column if not exists charges_total numeric;
alter table public.receipts add column if not exists gst_total numeric;
alter table public.receipts add column if not exists total_cost numeric;
create unique index if not exists design_families_code_uq on public.design_families (code) where code is not null;

-- Size part of a SKU: 011 (in) → 11, apparel LRG → L, no size → ''.
create or replace function public.size_tag(p_size text, p_unit text) returns text
language sql stable security definer set search_path=public as $$
  select case
    when coalesce(p_unit,'none') = 'none' or coalesce(p_size,'') in ('', '000') then ''
    when p_unit = 'size' then upper(regexp_replace(coalesce(
      (select name from code_lists where kind='apparel_size' and code=p_size), p_size), '[^A-Za-z0-9]', '', 'g'))
    else coalesce(nullif(ltrim(p_size,'0'),''),'0')
  end $$;

-- Human size label for the catalogue: 11in, 250mm, L.
create or replace function public.size_label(p_size text, p_unit text) returns text
language sql stable security definer set search_path=public as $$
  select case
    when coalesce(p_unit,'none') = 'none' or coalesce(p_size,'') in ('', '000') then ''
    when p_unit = 'size' then coalesce((select name from code_lists where kind='apparel_size' and code=p_size), p_size)
    else coalesce(nullif(ltrim(p_size,'0'),''),'0') || p_unit
  end $$;

-- SKU for a variant: design code + size tag; finish is added only when that size already exists in another finish.
create or replace function public.variant_sku(p_base text, p_size text, p_finish text, p_unit text, p_self uuid default null)
returns text language plpgsql stable security definer set search_path=public as $$
declare t text := public.size_tag(p_size, p_unit); v text;
begin
  v := p_base || case when t <> '' then '-' || t else '' end;
  if exists (select 1 from products where code = v and id is distinct from p_self) then
    v := v || '-' || coalesce(nullif(p_finish,''),'NA');
  end if;
  if exists (select 1 from products where code = v and id is distinct from p_self) then
    raise exception 'Code % is already used', v;
  end if;
  return v;
end $$;

-- ---------- one-time data move: give each design a code and re-code its sizes ----------
do $$
declare f record; p record; v_new text;
begin
  -- the design's code is the code its first size got
  for f in select df.id from design_families df where df.code is null loop
    update design_families set code = (
      select pr.code from products pr where pr.family_id = f.id
      order by pr.created_at, (regexp_replace(pr.code,'\D','','g'))::bigint limit 1)
    where id = f.id;
  end loop;
  for p in
    select pr.id, pr.code, pr.size, pr.finish, df.code fcode, t.size_unit
    from products pr join design_families df on df.id = pr.family_id
    join types t on t.div = pr.div and t.code = pr.type
    where df.code is not null
      and (pr.code !~ ('^' || df.code || '(-|$)') or (pr.code = df.code and public.size_tag(pr.size, t.size_unit) <> ''))
    order by df.code, pr.size, pr.finish
  loop
    v_new := public.variant_sku(p.fcode, p.size, p.finish, p.size_unit, p.id);
    update products set code = v_new, updated_at = now() where id = p.id;
  end loop;
end $$;

-- ---------- receiving: new size of an existing design reuses the design code ----------
create or replace function public.receive_stock_core(payload jsonb)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid(); v_email text; v_rid uuid; v_type text := payload->>'receipt_type';
  v_vendor uuid := nullif(payload->>'vendor_id','')::uuid;
  ln jsonb; nw jsonb; v_pid uuid; v_fid uuid; v_dno int; v_prefix text; v_no int; v_code text; v_base text; v_unit text;
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
  insert into receipts(receipt_type,vendor_id,bill_no,bill_date,bill_total,notes,created_by,created_by_email,
                       charges,goods_value,charges_total,gst_total,total_cost)
  values (v_type, v_vendor, nullif(trim(payload->>'bill_no'),''), nullif(payload->>'bill_date','')::date,
          nullif(payload->>'bill_total','')::numeric, payload->>'notes', v_uid, v_email,
          case when jsonb_typeof(payload->'charges')='array' then payload->'charges' end,
          nullif(payload->>'goods_value','')::numeric, nullif(payload->>'charges_total','')::numeric,
          nullif(payload->>'gst_total','')::numeric, nullif(payload->>'total_cost','')::numeric)
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
      select d.letter||t.letter, t.size_unit into v_prefix, v_unit from divisions d join types t on t.div=d.code and t.code=nw->>'type' where d.code=nw->>'div';
      if v_prefix is null then raise exception 'Line %: unknown division/type', ln->>'line_no'; end if;
      -- one code per design: only a brand-new design takes the next number
      select code into v_base from design_families where id=v_fid for update;
      if v_base is null then
        insert into code_counters(prefix,next_no) values (v_prefix,1001) on conflict (prefix) do nothing;
        update code_counters set next_no = next_no + 1 where prefix=v_prefix returning next_no - 1 into v_no;
        v_base := v_prefix || '-' || v_no;
        update design_families set code = v_base where id = v_fid;
      end if;
      v_size := coalesce(nullif(nw->>'size',''),'000');
      v_code := public.variant_sku(v_base, v_size, coalesce(nullif(nw->>'finish',''),'NA'), v_unit);
      v_spec := (nw->>'div')||'-'||(nw->>'type')||'-'||(nw->>'mat')||'-'||(nw->>'sport')||'-'||lpad(v_dno::text,3,'0')||'-'||v_size||'-'||coalesce(nullif(nw->>'finish',''),'NA');
      if exists(select 1 from products where spec_code=v_spec) then raise exception 'Line %: a product with spec % already exists — link to it instead', ln->>'line_no', v_spec; end if;
      if exists(select 1 from products where lower(friendly_name)=lower(nw->>'friendly_name')) then raise exception 'Line %: "%" already exists — link to existing instead', ln->>'line_no', nw->>'friendly_name'; end if;
      insert into products(code,prefix,family_id,div,type,mat,sport,size,finish,spec_code,friendly_name,status,unit_cost,
        preferred_vendor_id,location,description,stock,landed,selling,mrp,floor_price,bulk_price,bulk_min_qty,gst,price_rule)
      values (v_code,v_prefix,v_fid,nw->>'div',nw->>'type',nw->>'mat',nw->>'sport',v_size,coalesce(nullif(nw->>'finish',''),'NA'),v_spec,
        nw->>'friendly_name','Active',v_cost,v_vendor,nullif(ln->>'location',''),nullif(nw->>'description',''),0,
        (pr->>'landed')::numeric,(pr->>'selling')::numeric,(pr->>'mrp')::numeric,(pr->>'floor')::numeric,(pr->>'bulk')::numeric,(pr->>'bulk_min')::int,(pr->>'gst')::numeric,pr->>'rule')
      returning id into v_pid;
      created := created || jsonb_build_object('product_id',v_pid,'code',v_code,'design_code',v_base,'friendly_name',nw->>'friendly_name','qty',v_qty,'line_no',(ln->>'line_no')::int);
    end if;

    update products set stock = stock + v_qty,
      location = coalesce(nullif(ln->>'location',''), location),
      unit_cost = case when v_type='bill' and v_cost is not null then v_cost else unit_cost end,
      extra_cost = case when v_type='bill' and v_cost is not null then nullif(ln->>'extra_cost','')::numeric else extra_cost end,
      preferred_vendor_id = case when v_type='bill' then v_vendor else preferred_vendor_id end,
      landed = case when v_type='bill' and pr is not null and pr->>'landed' is not null then (pr->>'landed')::numeric else landed end,
      selling = case when v_type='bill' and pr is not null and pr->>'selling' is not null then (pr->>'selling')::numeric else selling end,
      mrp = case when v_type='bill' and pr is not null and pr->>'mrp' is not null then (pr->>'mrp')::numeric else mrp end,
      floor_price = case when v_type='bill' and pr is not null and pr->>'floor' is not null then (pr->>'floor')::numeric else floor_price end,
      bulk_price = case when v_type='bill' and pr is not null and pr->>'bulk' is not null then (pr->>'bulk')::numeric else bulk_price end,
      gst = case when v_type='bill' and pr is not null and pr->>'gst' is not null then (pr->>'gst')::numeric else gst end,
      price_rule = case when v_type='bill' and pr is not null and pr->>'rule' is not null then pr->>'rule' else price_rule end,
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

    insert into receipt_lines(receipt_id,line_no,product_id,vendor_item_code,description,billed_qty,received_qty,unit_cost,location,created_new,extra_cost)
    values (v_rid,(ln->>'line_no')::int,v_pid,nullif(ln->>'vendor_item_code',''),ln->>'description',nullif(ln->>'billed_qty','')::numeric,v_qty,v_cost,nullif(ln->>'location',''),v_new,
            nullif(ln->>'extra_cost','')::numeric);
  end loop;
  return jsonb_build_object('receipt_id',v_rid,'created',created);
end $function$;
revoke execute on function public.receive_stock_core(jsonb) from public, anon, authenticated;

-- ---------- public catalogue: one listing per design with its sizes and prices ----------
drop function if exists public.get_catalogue();
create function public.get_catalogue()
returns table(code text, name text, price numeric, description text, type_name text, photos text[], variants jsonb)
language sql stable security definer set search_path=public as $$
  with v as (
    select p.id, p.code sku, p.family_id fid, p.friendly_name, p.description, p.mrp, p.size, p.finish,
           t.name type_name, t.size_unit, f.code fcode, f.design_name
    from products p
    join types t on t.div=p.div and t.code=p.type
    join design_families f on f.id=p.family_id
    where p.status='Active' and not p.is_sample and p.mrp is not null and p.mrp > 0
      and p.div in (select jsonb_array_elements_text(coalesce((select data->'catalogue_divisions' from app_settings where id=1),'["TR"]'::jsonb)))
  ), fam as (
    select fid, count(distinct finish) nfin from v group by fid
  )
  select
    coalesce(min(v.fcode), min(v.sku)) as code,
    coalesce(min(v.design_name), min(v.friendly_name)) as name,
    min(v.mrp) as price,
    nullif(trim(regexp_replace(coalesce(min(v.description),''), '(HSN|SAC|GST|IGST|CGST|SGST)[^.,;\n]*', '', 'gi')),'') as description,
    min(v.type_name) as type_name,
    coalesce((select array_agg(ph.url order by x.size, x.finish, ph.is_main desc, ph.sort, ph.created_at)
              from product_photos ph join v x on x.id = ph.product_id where x.fid = v.fid), '{}') as photos,
    jsonb_agg(jsonb_build_object(
      'label', trim(concat_ws(' ', nullif(public.size_label(v.size, v.size_unit),''),
                 case when fam.nfin > 1 then (select cl.name from code_lists cl where cl.kind='finish' and cl.code=v.finish) end)),
      'price', v.mrp, 'sku', v.sku) order by v.size, v.finish) as variants
  from v join fam on fam.fid = v.fid
  group by v.fid
  order by min(v.type_name), coalesce(min(v.fcode), min(v.sku))
$$;
grant execute on function public.get_catalogue() to anon, authenticated, service_role;
