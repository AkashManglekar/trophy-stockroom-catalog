-- Public catalogue: exclude sample and unpriced products; keep only public fields.
create or replace function public.get_catalogue() returns table(code text, name text, price numeric, description text, type_name text, photos text[])
language sql stable security definer set search_path=public as $$
  select p.code, p.friendly_name, p.mrp,
    nullif(trim(regexp_replace(coalesce(p.description,''), '(HSN|SAC|GST|IGST|CGST|SGST)[^.,;\n]*', '', 'gi')),''),
    t.name,
    coalesce((select array_agg(ph.url order by ph.is_main desc, ph.sort, ph.created_at) from product_photos ph where ph.product_id=p.id), '{}')
  from products p join types t on t.div=p.div and t.code=p.type
  where p.status='Active'
    and not p.is_sample
    and p.mrp is not null and p.mrp > 0
    and p.div in (select jsonb_array_elements_text(coalesce((select data->'catalogue_divisions' from app_settings where id=1),'["TR"]'::jsonb)))
  order by t.name, p.code
$$;
grant execute on function public.get_catalogue() to anon, authenticated;
