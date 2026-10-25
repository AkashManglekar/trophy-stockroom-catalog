-- Medals are sized in inches, often fractional (2.5in, 2.75in). Sizes keep up to 2 decimals
-- ("002.5"); tags and labels read 2.5 / 2.5in, and 0.5 rather than .5.
update public.types set size_unit = 'in' where div = 'TR' and code = 'MED';

create or replace function public.size_tag(p_size text, p_unit text)
 returns text language sql stable security definer set search_path to 'public'
as $function$
  select case
    when coalesce(p_unit,'none') = 'none' or coalesce(p_size,'') in ('', '000') then ''
    when p_unit = 'size' then upper(regexp_replace(coalesce(
      (select name from code_lists where kind='apparel_size' and code=p_size), p_size), '[^A-Za-z0-9]', '', 'g'))
    else regexp_replace(coalesce(nullif(ltrim(p_size,'0'),''),'0'), '^\.', '0.')
  end $function$;

create or replace function public.size_label(p_size text, p_unit text)
 returns text language sql stable security definer set search_path to 'public'
as $function$
  select case
    when coalesce(p_unit,'none') = 'none' or coalesce(p_size,'') in ('', '000') then ''
    when p_unit = 'size' then coalesce((select name from code_lists where kind='apparel_size' and code=p_size), p_size)
    else regexp_replace(coalesce(nullif(ltrim(p_size,'0'),''),'0'), '^\.', '0.') || p_unit
  end $function$;
