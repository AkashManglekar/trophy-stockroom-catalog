-- Speed: indexes for the lookups the app makes on every screen, and access checks that run
-- once per request instead of once per row (wrapping the check in a sub-select lets Postgres
-- evaluate it a single time).
create index if not exists receipt_lines_receipt on public.receipt_lines (receipt_id, line_no);
create index if not exists product_photos_product on public.product_photos (product_id);
create index if not exists adjustments_product on public.adjustments (product_id, created_at desc);
create index if not exists receipts_created on public.receipts (created_at desc);
create index if not exists products_family on public.products (family_id);
create index if not exists quote_requests_created on public.quote_requests (created_at desc);

do $$
declare r record; q text; c text;
begin
  for r in
    select tablename, policyname, qual, with_check from pg_policies
    where schemaname = 'public'
      and (qual ~ '^(is_member|can_edit|can_approve|can_contribute|can_publish)\(\)$'
        or with_check ~ '^(is_member|can_edit|can_approve|can_contribute|can_publish)\(\)$')
  loop
    q := case when r.qual ~ '^[a-z_]+\(\)$' then format(' using ((select %s))', r.qual) else '' end;
    c := case when r.with_check ~ '^[a-z_]+\(\)$' then format(' with check ((select %s))', r.with_check) else '' end;
    execute format('alter policy %I on public.%I%s%s', r.policyname, r.tablename, q, c);
  end loop;
end $$;
