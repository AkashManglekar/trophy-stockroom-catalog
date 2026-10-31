-- 0020: issue register — internal stock (officials' T-shirts, marketing caps…) handed to a person.
-- Issuing deducts stock and keeps a record: who, what, size, quantity, cost, purpose, note.
-- Items that come back are returned to stock against the same record.

create table if not exists public.stock_issues (
  id uuid primary key default gen_random_uuid(),
  ref text not null,                      -- one hand-over (several items/sizes) shares a ref, e.g. ISS-1001
  product_id uuid not null references public.products(id) on delete cascade,
  qty int not null check (qty > 0),
  returned_qty int not null default 0 check (returned_qty >= 0),
  unit_cost numeric,                      -- landed cost per unit at the time of issue
  issued_to text not null,
  phone text,
  purpose text not null,
  note text,
  issued_on date not null default current_date,
  issued_by uuid default auth.uid(),
  issued_by_email text,
  created_at timestamptz not null default now(),
  constraint returned_le_qty check (returned_qty <= qty)
);
create index if not exists stock_issues_product_idx on public.stock_issues (product_id);
create index if not exists stock_issues_date_idx on public.stock_issues (issued_on desc, created_at desc);
alter table public.stock_issues enable row level security;
create policy "members read" on public.stock_issues for select using ((select is_member()));
-- Writes only through the functions below (they move stock too).

create or replace function public.issue_stock(p_lines jsonb, p_to text, p_phone text, p_purpose text,
                                              p_note text, p_date date default current_date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare ln jsonb; v_email text; v_ref text; v_no int; p record; v_qty int; n int := 0; units int := 0;
begin
  if not public.can_publish() then raise exception 'Only people who can publish bills can issue stock'; end if;
  if coalesce(trim(p_to), '') = '' then raise exception 'Who is it issued to?'; end if;
  if coalesce(trim(p_purpose), '') = '' then raise exception 'Pick the purpose'; end if;
  if jsonb_array_length(coalesce(p_lines, '[]'::jsonb)) = 0 then raise exception 'Add at least one item'; end if;
  select email into v_email from user_roles where user_id = auth.uid();
  insert into code_counters(prefix, next_no) values ('ISS', 1001) on conflict (prefix) do nothing;
  update code_counters set next_no = next_no + 1 where prefix = 'ISS' returning next_no - 1 into v_no;
  v_ref := 'ISS-' || v_no;
  for ln in select * from jsonb_array_elements(p_lines) loop
    v_qty := (ln->>'qty')::int;
    if v_qty is null or v_qty <= 0 then raise exception 'Each item needs a quantity'; end if;
    select * into p from products where id = (ln->>'product_id')::uuid for update;
    if p.id is null then raise exception 'Product not found'; end if;
    if p.stock < v_qty then raise exception '% has only % in stock', p.code, p.stock; end if;
    update products set stock = stock - v_qty, updated_at = now() where id = p.id;
    insert into stock_issues(ref, product_id, qty, unit_cost, issued_to, phone, purpose, note, issued_on, issued_by_email)
    values (v_ref, p.id, v_qty, coalesce(p.landed, p.unit_cost), trim(p_to), nullif(trim(p_phone), ''),
            trim(p_purpose), nullif(trim(p_note), ''), coalesce(p_date, current_date), v_email);
    insert into adjustments(product_id, qty, reason, note, created_by, created_by_email)
    values (p.id, -v_qty, 'Issued · ' || trim(p_purpose),
            v_ref || ' to ' || trim(p_to) || coalesce(' · ' || nullif(trim(p_note), ''), ''), auth.uid(), v_email);
    n := n + 1; units := units + v_qty;
  end loop;
  return jsonb_build_object('ref', v_ref, 'lines', n, 'units', units);
end $$;
revoke execute on function public.issue_stock(jsonb, text, text, text, text, date) from public, anon;
grant execute on function public.issue_stock(jsonb, text, text, text, text, date) to authenticated;

create or replace function public.return_issue(p_issue uuid, p_qty int, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare s record; v_email text;
begin
  if not public.can_publish() then raise exception 'Only people who can publish bills can take items back'; end if;
  select * into s from stock_issues where id = p_issue for update;
  if s.id is null then raise exception 'Issue not found'; end if;
  if p_qty is null or p_qty <= 0 then raise exception 'Quantity must be more than 0'; end if;
  if s.returned_qty + p_qty > s.qty then
    raise exception 'Only % of % are still out', s.qty - s.returned_qty, s.qty;
  end if;
  select email into v_email from user_roles where user_id = auth.uid();
  update stock_issues set returned_qty = returned_qty + p_qty where id = s.id;
  update products set stock = stock + p_qty, updated_at = now() where id = s.product_id;
  insert into adjustments(product_id, qty, reason, note, created_by, created_by_email)
  values (s.product_id, p_qty, 'Returned (issued)',
          s.ref || ' from ' || s.issued_to || coalesce(' · ' || nullif(trim(p_note), ''), ''), auth.uid(), v_email);
end $$;
revoke execute on function public.return_issue(uuid, int, text) from public, anon;
grant execute on function public.return_issue(uuid, int, text) to authenticated;
