-- 0021: edit what a product is — category, type, material, sport, size, finish — after it exists.
-- Product codes never change; the internal spec code (and design number where needed) follows.

create or replace function public.reclassify_design(p_family uuid, p_div text, p_type text, p_mat text, p_sport text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare f record; v_no int; v_email text; n int; x record;
begin
  if not public.can_edit() then raise exception 'Only the owner or editors can change what a product is'; end if;
  select * into f from design_families where id = p_family for update;
  if f.id is null then raise exception 'Design not found'; end if;
  if not exists (select 1 from types where div = p_div and code = p_type) then
    raise exception 'That type does not belong to the chosen division';
  end if;
  if not exists (select 1 from code_lists where kind = 'material' and code = p_mat) then raise exception 'Unknown material'; end if;
  if not exists (select 1 from code_lists where kind = 'sport' and code = p_sport) then raise exception 'Unknown sport'; end if;
  if (f.div, f.type, f.mat, f.sport) = (p_div, p_type, p_mat, p_sport) then
    return jsonb_build_object('changed', false);
  end if;
  -- Keep the design number when it is free in the new category, else take the next one there.
  perform pg_advisory_xact_lock(hashtext('fam:' || p_div || p_type || p_mat || p_sport));
  if exists (select 1 from design_families where div = p_div and type = p_type and mat = p_mat and sport = p_sport
             and design_no = f.design_no and id <> f.id) then
    select coalesce(max(design_no), 0) + 1 into v_no from design_families
     where div = p_div and type = p_type and mat = p_mat and sport = p_sport;
  else
    v_no := f.design_no;
  end if;
  update design_families set div = p_div, type = p_type, mat = p_mat, sport = p_sport, design_no = v_no where id = f.id;
  update products set div = p_div, type = p_type, mat = p_mat, sport = p_sport,
         spec_code = p_div || '-' || p_type || '-' || p_mat || '-' || p_sport || '-' || lpad(v_no::text, 3, '0')
                     || '-' || coalesce(nullif(size, ''), '000') || '-' || coalesce(nullif(finish, ''), 'NA'),
         updated_at = now()
   where family_id = f.id;
  get diagnostics n = row_count;
  select email into v_email from user_roles where user_id = auth.uid();
  for x in select id from products where family_id = f.id loop
    insert into adjustments(product_id, qty, reason, note, created_by, created_by_email)
    values (x.id, 0, 'Details changed',
            'Category ' || f.div || '-' || f.type || '-' || f.mat || '-' || f.sport || ' → ' ||
            p_div || '-' || p_type || '-' || p_mat || '-' || p_sport, auth.uid(), v_email);
  end loop;
  return jsonb_build_object('changed', true, 'products', n, 'design_no', v_no);
end $$;
revoke execute on function public.reclassify_design(uuid, text, text, text, text) from public, anon;
grant execute on function public.reclassify_design(uuid, text, text, text, text) to authenticated;

create or replace function public.edit_variant(p_product uuid, p_size text, p_finish text, p_name text)
returns void language plpgsql security definer set search_path = public as $$
declare p record; f record; v_spec text; v_email text; other text;
begin
  if not public.can_edit() then raise exception 'Only the owner or editors can change what a product is'; end if;
  select * into p from products where id = p_product for update;
  if p.id is null then raise exception 'Product not found'; end if;
  select * into f from design_families where id = p.family_id;
  if not exists (select 1 from code_lists where kind = 'finish' and code = coalesce(nullif(p_finish, ''), 'NA')) and coalesce(nullif(p_finish, ''), 'NA') <> 'NA' then
    raise exception 'Unknown finish';
  end if;
  v_spec := p.div || '-' || p.type || '-' || p.mat || '-' || p.sport || '-' || lpad(f.design_no::text, 3, '0')
            || '-' || coalesce(nullif(p_size, ''), '000') || '-' || coalesce(nullif(p_finish, ''), 'NA');
  select code into other from products where spec_code = v_spec and id <> p.id;
  if other is not null then raise exception 'This design already has that size and finish: %', other; end if;
  select code into other from products where lower(friendly_name) = lower(trim(p_name)) and id <> p.id;
  if other is not null then raise exception '"%" is already %', trim(p_name), other; end if;
  update products set size = coalesce(nullif(p_size, ''), '000'), finish = coalesce(nullif(p_finish, ''), 'NA'),
         spec_code = v_spec, friendly_name = trim(p_name), updated_at = now()
   where id = p.id;
  select email into v_email from user_roles where user_id = auth.uid();
  insert into adjustments(product_id, qty, reason, note, created_by, created_by_email)
  values (p.id, 0, 'Details changed', 'Size/finish ' || p.size || '/' || p.finish || ' → ' ||
          coalesce(nullif(p_size, ''), '000') || '/' || coalesce(nullif(p_finish, ''), 'NA'), auth.uid(), v_email);
end $$;
revoke execute on function public.edit_variant(uuid, text, text, text) from public, anon;
grant execute on function public.edit_variant(uuid, text, text, text) to authenticated;

-- Catalogue: a size without its own photo shows its design's — same colour first, then same
-- size, then any size.
CREATE OR REPLACE FUNCTION public.get_catalogue()
 RETURNS TABLE(code text, name text, price numeric, description text, type_name text, photos text[], variants jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with v as (
    select p.id, p.code sku, p.family_id fid, p.friendly_name, p.description, p.mrp, p.size, p.finish,
           t.name type_name, t.size_unit, t.colour_variants, f.code fcode, f.design_name
    from products p
    join types t on t.div=p.div and t.code=p.type
    join design_families f on f.id=p.family_id
    where p.status='Active' and not p.is_sample and not f.internal and p.mrp is not null and p.mrp > 0
      and p.div in (select jsonb_array_elements_text(coalesce((select data->'catalogue_divisions' from app_settings where id=1),'["TR"]'::jsonb)))
  ), fam as (
    select fid, count(distinct finish) nfin, bool_or(colour_variants) bycol from v group by fid
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
                 case when fam.nfin > 1 or fam.bycol then (select cl.name from code_lists cl where cl.kind='finish' and cl.code=v.finish) end)),
      'size', coalesce(public.size_label(v.size, v.size_unit), ''),
      'colour', case when fam.nfin > 1 or fam.bycol then coalesce((select cl.name from code_lists cl where cl.kind='finish' and cl.code=v.finish), '') else '' end,
      'finish', v.finish,
      'photo', (select ph.url from product_photos ph join products s on s.id = ph.product_id
                where s.family_id = v.fid
                order by (s.id = v.id) desc, (s.finish = v.finish) desc, (s.size = v.size) desc,
                         ph.is_main desc, ph.sort, ph.created_at
                limit 1),
      'price', v.mrp, 'sku', v.sku) order by v.size, v.finish) as variants
  from v join fam on fam.fid = v.fid
  group by v.fid
  order by min(v.type_name), coalesce(min(v.fcode), min(v.sku))
$function$;
