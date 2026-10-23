-- 0005: inventory adjustments (opening stock, customer returns, recounts, damage…) for one or many products,
-- applied atomically. mode: add | remove | set (set = counted quantity). Idempotent.
create or replace function public.adjust_stock_bulk(p_lines jsonb, p_reason text, p_note text default null) returns int
language plpgsql security definer set search_path=public as $$
declare ln jsonb; v_pid uuid; v_mode text; v_qty int; v_stock int; v_delta int; v_reason text; v_code text; n int := 0;
begin
  if not public.can_publish() then raise exception 'Only people who can publish bills can adjust stock'; end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'Add at least one product'; end if;
  if coalesce(trim(p_reason),'') = '' then raise exception 'Pick a reason'; end if;
  for ln in select * from jsonb_array_elements(p_lines) loop
    v_pid := nullif(ln->>'product_id','')::uuid;
    v_mode := coalesce(ln->>'mode','add');
    v_qty := (ln->>'qty')::int;
    v_reason := coalesce(nullif(trim(ln->>'reason'),''), trim(p_reason));
    if v_pid is null then raise exception 'A line has no product'; end if;
    if v_qty is null or v_qty < 0 then raise exception 'Quantities must be whole numbers, 0 or more'; end if;
    select stock, code into v_stock, v_code from products where id = v_pid for update;
    if v_code is null then raise exception 'Product not found'; end if;
    v_delta := case v_mode when 'add' then v_qty when 'remove' then -v_qty when 'set' then v_qty - v_stock
               else null end;
    if v_delta is null then raise exception 'Unknown adjustment type %', v_mode; end if;
    if v_stock + v_delta < 0 then raise exception '% has only % in stock', v_code, v_stock; end if;
    if v_delta = 0 then continue; end if;
    perform public.adjust_stock_core(v_pid, v_delta, v_reason,
      nullif(trim(concat_ws(' · ', nullif(trim(p_note),''), case when v_mode='set' then 'counted '||v_qty||' (was '||v_stock||')' end)),''));
    n := n + 1;
  end loop;
  return n;
end $$;
grant execute on function public.adjust_stock_bulk(jsonb, text, text) to authenticated;
