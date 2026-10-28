-- 0019: record sales in the app (pushed to Zoho as invoices; kept locally when Zoho isn't reachable).

alter table public.sales_lines add column if not exists recorded_by text;
alter table public.sales_lines add column if not exists customer_phone text;
alter table public.sales_lines add column if not exists note text;
-- Zoho's own invoice id, so the app can act on the invoice later.
alter table public.sales_lines add column if not exists zoho_doc_id text;

create or replace function public.apply_sales(p_docs jsonb, p_source text default 'zoho')
 returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare d jsonb; ln jsonb; v_id uuid; keys text[]; applied int := 0; lines int := 0; x record;
begin
  if not (coalesce(auth.role(),'') = 'service_role' or public.can_publish()) then
    raise exception 'Only people who can publish bills can import sales';
  end if;
  for d in select * from jsonb_array_elements(coalesce(p_docs,'[]'::jsonb)) loop
    keys := '{}';
    for ln in select * from jsonb_array_elements(coalesce(d->'lines','[]'::jsonb)) loop
      lines := lines + 1;
      keys := keys || (ln->>'line_key');
      insert into sales_lines(source, doc_kind, doc_id, doc_no, doc_date, doc_status, customer, line_key,
                              zoho_item_id, item_name, sku, qty, rate, amount, updated_at,
                              recorded_by, customer_phone, note, zoho_doc_id)
      values (p_source, d->>'kind', d->>'doc_id', d->>'doc_no', nullif(d->>'date','')::date, d->>'status', d->>'customer',
              ln->>'line_key', nullif(ln->>'item_id',''), ln->>'name', nullif(ln->>'sku',''),
              coalesce((ln->>'qty')::numeric,0), nullif(ln->>'rate','')::numeric, nullif(ln->>'amount','')::numeric, now(),
              nullif(d->>'recorded_by',''), nullif(d->>'phone',''), nullif(d->>'note',''), nullif(d->>'zoho_id',''))
      on conflict (source, doc_kind, doc_id, line_key) do update set
        doc_no = excluded.doc_no, doc_date = excluded.doc_date, doc_status = excluded.doc_status, customer = excluded.customer,
        zoho_item_id = excluded.zoho_item_id, item_name = excluded.item_name, sku = excluded.sku,
        qty = excluded.qty, rate = excluded.rate, amount = excluded.amount, updated_at = now(),
        recorded_by = coalesce(sales_lines.recorded_by, excluded.recorded_by),
        customer_phone = coalesce(excluded.customer_phone, sales_lines.customer_phone),
        note = coalesce(excluded.note, sales_lines.note),
        zoho_doc_id = coalesce(excluded.zoho_doc_id, sales_lines.zoho_doc_id)
      returning id into v_id;
      applied := applied + abs(public.apply_sale_line(v_id));
    end loop;
    for x in select id from sales_lines where source = p_source and doc_kind = d->>'kind' and doc_id = d->>'doc_id'
             and not (line_key = any(keys)) loop
      update sales_lines set qty = 0, updated_at = now() where id = x.id;
      applied := applied + abs(public.apply_sale_line(x.id));
    end loop;
  end loop;
  return jsonb_build_object('lines', lines, 'units_applied', applied,
    'unmatched', (select count(*) from sales_lines where product_id is null and qty <> 0));
end $function$;

create or replace function public.apply_sale_line(p_line uuid)
 returns integer language plpgsql security definer set search_path to 'public' as $function$
declare s record; v_want int; v_delta int; v_active boolean;
begin
  select * into s from sales_lines where id = p_line for update;
  if s.id is null then return 0; end if;
  if s.product_id is null then
    update sales_lines set product_id = public.resolve_sale_product(s.zoho_item_id, s.sku, s.item_name) where id = s.id
      returning * into s;
  end if;
  v_active := coalesce(s.doc_status,'') not in ('draft','void');
  v_want := case when not v_active or s.product_id is null then 0
                 when s.doc_kind = 'invoice' then -round(s.qty)::int else round(s.qty)::int end;
  if s.product_id is null then return 0; end if;
  v_delta := v_want - s.applied_qty;
  if v_delta <> 0 then
    update products set stock = stock + v_delta, updated_at = now() where id = s.product_id;
    insert into adjustments(product_id, qty, reason, note, created_by_email)
    values (s.product_id, v_delta,
      case when s.source = 'app' and v_delta < 0 then 'Sale'
           when s.source = 'app' then 'Sale cancelled / moved to Zoho'
           when s.doc_kind = 'invoice' and v_delta < 0 then 'Sale (Zoho)'
           when s.doc_kind = 'credit' and v_delta > 0 then 'Return (Zoho credit note)'
           else 'Zoho correction' end,
      coalesce(s.doc_no, s.doc_id) || coalesce(' · ' || s.customer, ''), coalesce(s.recorded_by, 'zoho-sync'));
    update sales_lines set applied_qty = v_want, updated_at = now() where id = s.id;
  end if;
  return v_delta;
end $function$;

-- Link the Zoho items created for stockroom products (by SKU) so invoices made from the app use them.
insert into zoho_item_map(zoho_key, product_id) select v.k, p.id from (values ('i:4233177000000122001','TM-1006-2.5-BZ'),('i:4233177000000123001','TM-1006-2.5-GD'),('i:4233177000000120010','TM-1006-2.5-SV'),('i:4233177000000117028','TC-1004-13'),('i:4233177000000122019','TC-1009-16'),('i:4233177000000121001','TM-1005-2.5-BZ'),('i:4233177000000108010','TM-1005-2.5-GD'),('i:4233177000000103011','TM-1005-2.5-SV'),('i:4233177000000104057','TM-1002-2-BZ'),('i:4233177000000110001','TM-1002-2-GD'),('i:4233177000000111001','TM-1002-2-SV'),('i:4233177000000110010','TM-1002-3-BZ'),('i:4233177000000112001','TM-1002-3-GD'),('i:4233177000000113001','TM-1002-3-SV'),('i:4233177000000105001','TM-1001-2-BZ'),('i:4233177000000107001','TM-1001-2-GD'),('i:4233177000000108001','TM-1001-2-SV'),('i:4233177000000109001','TM-1001-3-BZ'),('i:4233177000000103002','TM-1001-3-GD'),('i:4233177000000105010','TM-1001-3-SV'),('i:4233177000000127001','TM-1010-2.5-BZ'),('i:4233177000000117019','TM-1010-2.5-GD'),('i:4233177000000123010','TM-1010-2.5-SV'),('i:4233177000000114019','TF-1001-9'),('i:4233177000000127010','TC-1008-14'),('i:4233177000000120019','TC-1007-8'),('i:4233177000000104066','TM-1003-2-BZ'),('i:4233177000000114001','TM-1003-2-GD'),('i:4233177000000115001','TM-1003-2-SV'),('i:4233177000000104075','TM-1003-3-BZ'),('i:4233177000000116001','TM-1003-3-GD'),('i:4233177000000117001','TM-1003-3-SV'),('i:4233177000000108019','TM-1007-2.5-BZ'),('i:4233177000000111010','TM-1007-2.5-GD'),('i:4233177000000124001','TM-1007-2.5-SV'),('i:4233177000000128010','TC-1005-11'),('i:4233177000000110028','TC-1005-14'),('i:4233177000000128001','TM-1011-2.5-BZ'),('i:4233177000000116019','TM-1011-2.5-GD'),('i:4233177000000122010','TM-1011-2.5-SV'),('i:4233177000000118010','TM-1009-3-BZ'),('i:4233177000000126001','TM-1009-3-GD'),('i:4233177000000124010','TM-1009-3-SV'),('i:4233177000000125001','TM-1008-3.25-BZ'),('i:4233177000000116010','TM-1008-3.25-GD'),('i:4233177000000113010','TM-1008-3.25-SV'),('i:4233177000000114010','TM-1004-2.5-BZ'),('i:4233177000000117010','TM-1004-2.5-GD'),('i:4233177000000120001','TM-1004-2.5-SV'),('i:4233177000000107010','TM-1004-2-BZ'),('i:4233177000000118001','TM-1004-2-GD'),('i:4233177000000119001','TM-1004-2-SV'),('i:4233177000000110019','TC-1003-13')) v(k,sku) join products p on upper(p.code)=upper(v.sku) on conflict (zoho_key) do update set product_id=excluded.product_id;
