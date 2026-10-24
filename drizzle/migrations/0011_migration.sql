-- Internal inventory: designs kept in stock for own use (marketing caps, staff T-shirts…) that must
-- never appear on the public catalogue or in quotes. One switch per design covers every size.
alter table public.design_families add column if not exists internal boolean not null default false;

create or replace function public.get_catalogue()
 returns table(code text, name text, price numeric, description text, type_name text, photos text[], variants jsonb)
 language sql stable security definer set search_path to 'public'
as $function$
  with v as (
    select p.id, p.code sku, p.family_id fid, p.friendly_name, p.description, p.mrp, p.size, p.finish,
           t.name type_name, t.size_unit, f.code fcode, f.design_name
    from products p
    join types t on t.div=p.div and t.code=p.type
    join design_families f on f.id=p.family_id
    where p.status='Active' and not p.is_sample and not f.internal and p.mrp is not null and p.mrp > 0
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
$function$;

-- Receiving can mark a brand-new design as internal straight away (new.internal on the line).
do $$ declare d text; begin
  d := pg_get_functiondef('public.receive_stock_core'::regproc);
  if position('coalesce((nw->>''internal'')::boolean,false)' in d) = 0 then
    d := replace(d,
      E'insert into design_families(div,type,mat,sport,design_no,design_name)\n        values (nw->>''div'',nw->>''type'',nw->>''mat'',nw->>''sport'',v_dno,nullif(trim(nw->>''design_name''),''''))',
      E'insert into design_families(div,type,mat,sport,design_no,design_name,internal)\n        values (nw->>''div'',nw->>''type'',nw->>''mat'',nw->>''sport'',v_dno,nullif(trim(nw->>''design_name''),''''),coalesce((nw->>''internal'')::boolean,false))');
    execute d;
  end if;
end $$;
