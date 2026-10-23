-- 0007: bill history — owner can correct, reverse or delete a bill. Idempotent.
alter table public.receipts add column if not exists edited_at timestamptz;
alter table public.receipts add column if not exists edited_by_email text;

-- Correct a bill: header (vendor, number, date, totals, charges, GST) and its lines (cost, quantities,
-- share of charges). Quantity changes move stock and are logged. Products whose latest bill this is take
-- the new cost/charges; returns their ids so the app can re-price them.
create or replace function public.update_bill(p_receipt uuid, p_header jsonb, p_lines jsonb) returns uuid[]
language plpgsql security definer set search_path=public as $$
declare r record; l record; ln jsonb; v_email text; v_vendor uuid; v_bill text; v_qty int; v_delta int;
        v_stock int; v_code text; v_cost numeric; v_extra numeric; touched uuid[] := '{}';
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
      billed_qty = case when ln ? 'billed_qty' then nullif(ln->>'billed_qty','')::numeric else billed_qty end
    where id = l.id;
    -- the product's cost follows its most recent bill
    if r.receipt_type = 'bill' and l.product_id is not null and not exists (
      select 1 from receipt_lines l2 join receipts r2 on r2.id = l2.receipt_id
      where l2.product_id = l.product_id and r2.receipt_type = 'bill' and r2.reversed_at is null
        and r2.id <> r.id and r2.created_at > r.created_at) then
      update products set unit_cost = coalesce(v_cost, unit_cost), extra_cost = v_extra,
        preferred_vendor_id = v_vendor, updated_at = now() where id = l.product_id;
      touched := touched || l.product_id;
    end if;
  end loop;
  return touched;
end $$;
grant execute on function public.update_bill(uuid, jsonb, jsonb) to authenticated;

-- Reversal for the owner even without publish rights (the wrapper already allows publishers).
create or replace function public.reverse_receipt(p_receipt uuid) returns void language plpgsql security definer set search_path=public as $$
begin
  if not (public.can_publish() or public.my_role() = 'owner') then raise exception 'Only people who can publish bills can reverse them'; end if;
  perform public.reverse_receipt_core(p_receipt);
end $$;

-- Delete a bill for good (owner). Its stock is reversed first if needed; products it created that have
-- no other bill and no stock are removed with it. Returns photo paths to clear from storage.
create or replace function public.delete_bill(p_receipt uuid) returns text[]
language plpgsql security definer set search_path=public as $$
declare r record; v_paths text[] := '{}'; v_ids uuid[];
begin
  if public.my_role() is distinct from 'owner' then raise exception 'Only the owner can delete bills'; end if;
  select * into r from receipts where id = p_receipt for update;
  if r.id is null then raise exception 'Bill not found'; end if;
  if r.reversed_at is null then perform public.reverse_receipt_core(p_receipt); end if;
  select coalesce(array_agg(distinct l.product_id), '{}') into v_ids
  from receipt_lines l join products p on p.id = l.product_id
  where l.receipt_id = r.id and l.created_new and p.stock = 0
    and not exists (select 1 from receipt_lines l2 where l2.product_id = l.product_id and l2.receipt_id <> r.id)
    and not exists (select 1 from bill_submissions s where s.status = 'pending' and s.payload::text like '%' || l.product_id::text || '%');
  select coalesce(array_agg(path) filter (where path is not null), '{}') into v_paths
    from product_photos where product_id = any(v_ids);
  update bill_submissions set receipt_id = null where receipt_id = r.id;
  delete from receipts where id = r.id;
  delete from products where id = any(v_ids);
  delete from design_families f where not exists (select 1 from products x where x.family_id = f.id);
  return v_paths;
end $$;
grant execute on function public.delete_bill(uuid) to authenticated;
