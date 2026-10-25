-- Vendors: archive (status 'Archived', kept with all history) or delete.
-- Delete goes through delete_vendor only: the owner, and only for vendors with no bills or
-- submitted bills (bill history must never lose its vendor). Its code map and ratings go with it;
-- products that preferred it simply lose the preferred vendor.
drop policy if exists "editor delete" on public.vendors;

create or replace function public.delete_vendor(p_vendor uuid)
 returns text language plpgsql security definer set search_path to 'public'
as $function$
declare v_code text; v_bills int; v_subs int;
begin
  if not exists (select 1 from user_roles where user_id = auth.uid() and role = 'owner') then
    raise exception 'Only the owner can delete vendors';
  end if;
  select code into v_code from vendors where id = p_vendor;
  if v_code is null then raise exception 'Vendor not found'; end if;
  select count(*) into v_bills from receipts where vendor_id = p_vendor;
  select count(*) into v_subs from bill_submissions where vendor_id = p_vendor and status <> 'withdrawn';
  if v_bills + v_subs > 0 then
    raise exception '% has % bill(s) on record — archive it instead so the bill history keeps its vendor', v_code, v_bills + v_subs;
  end if;
  delete from vendors where id = p_vendor;
  return v_code;
end $function$;
revoke all on function public.delete_vendor(uuid) from public, anon;
grant execute on function public.delete_vendor(uuid) to authenticated;
