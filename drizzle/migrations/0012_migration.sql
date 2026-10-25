-- Colour variants (medals): one design code, each size × colour its own SKU, stock and price.
-- Types flagged colour_variants always carry the colour in the SKU (TM-1001-50-GD, TM-1001-50-SV…),
-- and the catalogue gets separate size and colour for each variant so pickers can offer both.
alter table public.types add column if not exists colour_variants boolean not null default false;
update public.types set colour_variants = true where div = 'TR' and code = 'MED';

create or replace function public.variant_sku(p_base text, p_size text, p_finish text, p_unit text, p_self uuid default null)
 returns text language plpgsql stable security definer set search_path to 'public'
as $function$
declare t text := public.size_tag(p_size, p_unit); v text; by_colour boolean;
begin
  -- The design code's prefix (division letter + type letter) identifies the type.
  select coalesce(bool_or(ty.colour_variants), false) into by_colour
    from types ty join divisions d on d.code = ty.div
   where d.letter || ty.letter = split_part(p_base, '-', 1);
  v := p_base || case when t <> '' then '-' || t else '' end;
  if by_colour and coalesce(nullif(p_finish,''),'NA') <> 'NA' then
    v := v || '-' || p_finish;
  elsif exists (select 1 from products where code = v and id is distinct from p_self) then
    v := v || '-' || coalesce(nullif(p_finish,''),'NA');
  end if;
  if exists (select 1 from products where code = v and id is distinct from p_self) then
    raise exception 'Code % is already used', v;
  end if;
  return v;
end $function$;

create or replace function public.get_catalogue()
 returns table(code text, name text, price numeric, description text, type_name text, photos text[], variants jsonb)
 language sql stable security definer set search_path to 'public'
as $function$
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
      'photo', (select ph.url from product_photos ph where ph.product_id = v.id
                order by ph.is_main desc, ph.sort, ph.created_at limit 1),
      'price', v.mrp, 'sku', v.sku) order by v.size, v.finish) as variants
  from v join fam on fam.fid = v.fid
  group by v.fid
  order by min(v.type_name), coalesce(min(v.fcode), min(v.sku))
$function$;
