-- Selling GST follows the GST % on the product's bill line by default. An owner/editor can set it
-- by hand (gst_manual = true); then later bills leave it alone.
alter table public.products add column if not exists gst_manual boolean not null default false;

do $$ declare d text; begin
  d := pg_get_functiondef('public.receive_stock_core'::regproc);
  if position('and not gst_manual' in d) = 0 then
    d := replace(d,
      'gst = case when v_type=''bill'' and pr is not null and pr->>''gst'' is not null then (pr->>''gst'')::numeric else gst end',
      'gst = case when v_type=''bill'' and pr is not null and pr->>''gst'' is not null and not gst_manual then (pr->>''gst'')::numeric else gst end');
    if position('and not gst_manual' in d) = 0 then raise exception 'receive_stock_core patch did not apply'; end if;
    execute d;
  end if;
end $$;

-- One-off: products whose latest bill line had a GST % different from their selling GST take the
-- bill's rate (pre-GST basis: selling unchanged, tag price = selling + GST rounded up to ₹10).
with last_line as (
  select distinct on (rl.product_id) rl.product_id, rl.gst_rate
  from receipt_lines rl join receipts r on r.id = rl.receipt_id
  where r.receipt_type = 'bill' and r.reversed_at is null and rl.gst_rate is not null
  order by rl.product_id, r.created_at desc
)
update products p set gst = l.gst_rate,
       mrp = case when p.selling is null then p.mrp else ceil(p.selling * (1 + l.gst_rate/100) / 10 - 1e-9) * 10 end,
       updated_at = now()
  from last_line l
 where l.product_id = p.id and not p.gst_manual and p.gst is distinct from l.gst_rate;

-- A changed GST on a bill keeps the product's tag price: the app sends prices.lock_mrp and the
-- product switches to Fixed MRP (price before GST worked back from the MRP).
do $$ declare d text; begin
  d := pg_get_functiondef('public.receive_stock_core'::regproc);
  if position('pr ? ''lock_mrp''' in d) = 0 then
    d := replace(d,
      'gst = case when v_type=''bill'' and pr is not null and pr->>''gst'' is not null and not gst_manual then (pr->>''gst'')::numeric else gst end,',
      'gst = case when v_type=''bill'' and pr is not null and pr->>''gst'' is not null and not gst_manual then (pr->>''gst'')::numeric else gst end,
      price_mode = case when v_type=''bill'' and pr is not null and pr ? ''lock_mrp'' and nullif(pr->>''lock_mrp'','''') is not null then ''mrp'' else price_mode end,
      price_value = case when v_type=''bill'' and pr is not null and pr ? ''lock_mrp'' and nullif(pr->>''lock_mrp'','''') is not null then (pr->>''lock_mrp'')::numeric else price_value end,');
    if position('pr ? ''lock_mrp''' in d) = 0 then raise exception 'lock_mrp patch did not apply'; end if;
    execute d;
  end if;
end $$;

-- One-off: products whose latest bill GST differed from their selling GST take the bill's rate,
-- keeping their MRP (tag price); price before GST, floor and bulk recalculated from it.
with last_line as (
  select distinct on (rl.product_id) rl.product_id, rl.gst_rate
  from receipt_lines rl join receipts r on r.id = rl.receipt_id
  where r.receipt_type = 'bill' and r.reversed_at is null and rl.gst_rate is not null
  order by rl.product_id, r.created_at desc
), t as (
  select p.id, l.gst_rate g, p.mrp m, d.rounding rd, d.floor_margin fm, d.bulk_pct bp, p.landed,
         round(p.mrp / (1 + l.gst_rate/100), 2) sell
  from products p join last_line l on l.product_id = p.id join divisions d on d.code = p.div
  where not p.gst_manual and p.gst is distinct from l.gst_rate and p.mrp is not null
), f as (
  select *, least(case when landed is null then null else ceil(landed / (1 - fm/100) / rd - 1e-9) * rd end, sell) fl from t
)
update products p set
  gst = f.g, price_mode = 'mrp', price_value = f.m, selling = f.sell, mrp = f.m,
  floor_price = f.fl,
  bulk_price = greatest(coalesce(f.fl, 0), ceil(f.sell * (1 - f.bp/100) / f.rd - 1e-9) * f.rd),
  price_rule = 'Fixed MRP', updated_at = now()
from f where f.id = p.id;
