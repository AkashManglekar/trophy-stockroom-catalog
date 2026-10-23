-- 0008: GST per bill line (rates vary) and tax type per bill (IGST, or CGST + SGST). Idempotent.
alter table public.receipts add column if not exists gst_type text;
alter table public.receipts add column if not exists gst_breakup jsonb;
alter table public.receipt_lines add column if not exists gst_rate numeric;

-- Store them when receiving and when the owner edits a bill (patches the existing functions in place).
do $$
declare d text;
begin
  d := pg_get_functiondef('public.receive_stock_core(jsonb)'::regprocedure);
  if position('gst_breakup' in d) = 0 then
    d := replace(d, 'charges,goods_value,charges_total,gst_total,total_cost)',
                    'charges,goods_value,charges_total,gst_total,total_cost,gst_type,gst_breakup)');
    d := replace(d, 'nullif(payload->>''gst_total'','''')::numeric, nullif(payload->>''total_cost'','''')::numeric)',
                    'nullif(payload->>''gst_total'','''')::numeric, nullif(payload->>''total_cost'','''')::numeric,
          nullif(payload->>''gst_type'',''''), case when jsonb_typeof(payload->''gst_breakup'')=''array'' then payload->''gst_breakup'' end)');
    d := replace(d, 'location,created_new,extra_cost)', 'location,created_new,extra_cost,gst_rate)');
    d := replace(d, 'nullif(ln->>''extra_cost'','''')::numeric);', 'nullif(ln->>''extra_cost'','''')::numeric, nullif(ln->>''gst_rate'','''')::numeric);');
    if position('gst_breakup' in d) = 0 or position('gst_rate)' in d) = 0 then
      raise exception 'receive_stock_core did not match the expected shape';
    end if;
    execute d;
  end if;

  d := pg_get_functiondef('public.update_bill(uuid,jsonb,jsonb)'::regprocedure);
  if position('gst_breakup' in d) = 0 then
    d := replace(d, '    edited_at = now(), edited_by_email = v_email',
      '    gst_type = case when p_header ? ''gst_type'' then nullif(p_header->>''gst_type'','''') else gst_type end,
    gst_breakup = case when p_header ? ''gst_breakup'' then p_header->''gst_breakup'' else gst_breakup end,
    edited_at = now(), edited_by_email = v_email');
    d := replace(d, '      received_qty = v_qty, unit_cost = v_cost, extra_cost = v_extra,',
      '      received_qty = v_qty, unit_cost = v_cost, extra_cost = v_extra,
      gst_rate = case when ln ? ''gst_rate'' then nullif(ln->>''gst_rate'','''')::numeric else gst_rate end,');
    if position('gst_breakup' in d) = 0 or position('gst_rate =' in d) = 0 then
      raise exception 'update_bill did not match the expected shape';
    end if;
    execute d;
  end if;
end $$;
revoke execute on function public.receive_stock_core(jsonb) from public, anon, authenticated;
