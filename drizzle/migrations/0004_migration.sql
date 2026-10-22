-- 0004: owner-managed accounts, per-user bill approval, archive/delete products. Idempotent.

-- ---------- ACCOUNTS ----------
alter table public.user_roles add column if not exists can_publish boolean not null default false;
alter table public.user_roles add column if not exists full_name text;

create or replace function public.owner_email() returns text language sql immutable as $$ select 'akash@sportagon.in'::text $$;

-- No self-service access: only the owner's own email gets a role on sign-up. Everyone else is added by the owner.
create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if lower(coalesce(new.email,'')) = public.owner_email() then
    insert into public.user_roles(user_id,email,role,can_publish) values (new.id, lower(new.email), 'owner', true)
    on conflict (user_id) do update set role='owner', can_publish=true, email=excluded.email;
  end if;
  return new;
end $$;

-- Only akash@sportagon.in can ever be owner, and the owner can't be demoted.
create or replace function public.guard_owner_role() returns trigger language plpgsql security definer set search_path=public as $$
declare v_email text;
begin
  select lower(email) into v_email from auth.users where id = new.user_id;
  if new.role = 'owner' and coalesce(v_email,'') <> public.owner_email() then
    raise exception 'Only % can be the owner', public.owner_email();
  end if;
  if tg_op = 'UPDATE' and old.role = 'owner' and new.role <> 'owner' then
    raise exception 'The owner role cannot be changed';
  end if;
  if new.role = 'owner' then new.can_publish := true; end if;
  if new.role = 'viewer' then new.can_publish := false; end if;
  return new;
end $$;
drop trigger if exists user_roles_guard on public.user_roles;
create trigger user_roles_guard before insert or update on public.user_roles for each row execute function public.guard_owner_role();

-- Make sure the owner row is right.
insert into public.user_roles(user_id,email,role,can_publish)
select id, lower(email), 'owner', true from auth.users where lower(email) = public.owner_email()
on conflict (user_id) do update set role='owner', can_publish=true;

-- Role changes go through the owner's server functions only.
drop policy if exists "owners update roles" on public.user_roles;

create or replace function public.can_publish() returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.user_roles where user_id = auth.uid()
    and (role = 'owner' or (role in ('editor','contributor') and can_publish))) $$;
create or replace function public.can_approve() returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.user_roles where user_id = auth.uid()
    and (role = 'owner' or (role = 'editor' and can_publish))) $$;

-- ---------- STOCK CHANGES NEED PUBLISH RIGHTS ----------
do $$ begin
  if not exists (select 1 from pg_proc where proname='receive_stock_core' and pronamespace='public'::regnamespace) then
    alter function public.receive_stock(jsonb) rename to receive_stock_core;
  end if;
  if not exists (select 1 from pg_proc where proname='reverse_receipt_core' and pronamespace='public'::regnamespace) then
    alter function public.reverse_receipt(uuid) rename to reverse_receipt_core;
  end if;
  if not exists (select 1 from pg_proc where proname='adjust_stock_core' and pronamespace='public'::regnamespace) then
    alter function public.adjust_stock(uuid,int,text,text) rename to adjust_stock_core;
  end if;
end $$;
revoke execute on function public.receive_stock_core(jsonb) from public, anon, authenticated;
revoke execute on function public.reverse_receipt_core(uuid) from public, anon, authenticated;
revoke execute on function public.adjust_stock_core(uuid,int,text,text) from public, anon, authenticated;

create or replace function public.receive_stock(payload jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
begin
  if not public.can_publish() then raise exception 'Your bills need approval — use Submit for approval'; end if;
  return public.receive_stock_core(payload);
end $$;
create or replace function public.reverse_receipt(p_receipt uuid) returns void language plpgsql security definer set search_path=public as $$
begin
  if not public.can_publish() then raise exception 'Only people who can publish bills can reverse them'; end if;
  perform public.reverse_receipt_core(p_receipt);
end $$;
create or replace function public.adjust_stock(p_product uuid, p_qty int, p_reason text, p_note text) returns void language plpgsql security definer set search_path=public as $$
begin
  if not public.can_publish() then raise exception 'Only people who can publish bills can adjust stock'; end if;
  perform public.adjust_stock_core(p_product, p_qty, p_reason, p_note);
end $$;
grant execute on function public.receive_stock(jsonb), public.reverse_receipt(uuid), public.adjust_stock(uuid,int,text,text) to authenticated;

-- ---------- BILL APPROVALS ----------
alter table public.receipts add column if not exists approved_by_email text;

create table if not exists public.bill_submissions (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'pending' check (status in ('pending','approved','rejected','withdrawn')),
  receipt_type text not null,
  vendor_id uuid references public.vendors(id) on delete set null,
  vendor_name text, bill_no text, bill_date date, bill_total numeric,
  line_count int, units int, value numeric, new_codes int,
  payload jsonb not null, draft jsonb not null,
  submitted_by uuid, submitted_by_email text, created_at timestamptz not null default now(),
  reviewed_by_email text, reviewed_at timestamptz, review_note text,
  receipt_id uuid references public.receipts(id) on delete set null
);
grant select on public.bill_submissions to authenticated;
grant all on public.bill_submissions to service_role;
alter table public.bill_submissions enable row level security;
drop policy if exists "read own or approver" on public.bill_submissions;
create policy "read own or approver" on public.bill_submissions for select to authenticated
  using (public.is_member() and (public.can_approve() or submitted_by = auth.uid()));
create index if not exists bill_submissions_status on public.bill_submissions(status, created_at desc);

create or replace function public.submit_bill(p_payload jsonb, p_draft jsonb, p_meta jsonb, p_replaces uuid default null) returns uuid
language plpgsql security definer set search_path=public as $$
declare v_email text; v_id uuid; v_vendor uuid := nullif(p_payload->>'vendor_id','')::uuid; v_bill text := nullif(trim(p_payload->>'bill_no'),'');
begin
  if not public.can_contribute() then raise exception 'You do not have permission to add bills'; end if;
  select email into v_email from user_roles where user_id = auth.uid();
  if p_replaces is not null then
    update bill_submissions set status='withdrawn', reviewed_at=coalesce(reviewed_at, now())
    where id=p_replaces and submitted_by=auth.uid() and status in ('pending','rejected');
  end if;
  if p_payload->>'receipt_type' = 'bill' and v_bill is not null then
    if exists (select 1 from receipts where vendor_id=v_vendor and receipt_type='bill' and reversed_at is null and lower(bill_no)=lower(v_bill)) then
      raise exception 'Bill % from this vendor was already received', v_bill;
    end if;
    if exists (select 1 from bill_submissions where vendor_id=v_vendor and status='pending' and lower(bill_no)=lower(v_bill)) then
      raise exception 'Bill % from this vendor is already waiting for approval', v_bill;
    end if;
  end if;
  insert into bill_submissions(receipt_type,vendor_id,vendor_name,bill_no,bill_date,bill_total,line_count,units,value,new_codes,payload,draft,submitted_by,submitted_by_email)
  values (p_payload->>'receipt_type', v_vendor, p_meta->>'vendor_name', v_bill, nullif(p_payload->>'bill_date','')::date,
    nullif(p_payload->>'bill_total','')::numeric, (p_meta->>'line_count')::int, (p_meta->>'units')::int,
    (p_meta->>'value')::numeric, (p_meta->>'new_codes')::int, p_payload, p_draft, auth.uid(), v_email)
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.approve_bill(p_id uuid, p_payload jsonb default null, p_draft jsonb default null) returns jsonb
language plpgsql security definer set search_path=public as $$
declare s record; v_email text; v_res jsonb; v_rid uuid;
begin
  if not public.can_approve() then raise exception 'You cannot approve bills'; end if;
  select email into v_email from user_roles where user_id = auth.uid();
  select * into s from bill_submissions where id=p_id for update;
  if s.id is null then raise exception 'Submission not found'; end if;
  if s.status <> 'pending' then raise exception 'This bill is already %', s.status; end if;
  v_res := public.receive_stock_core(coalesce(p_payload, s.payload));
  v_rid := (v_res->>'receipt_id')::uuid;
  update receipts set created_by=s.submitted_by, created_by_email=s.submitted_by_email, approved_by_email=v_email where id=v_rid;
  update bill_submissions set status='approved', reviewed_by_email=v_email, reviewed_at=now(), receipt_id=v_rid,
    payload=coalesce(p_payload,payload), draft=coalesce(p_draft,draft) where id=p_id;
  return v_res;
end $$;

create or replace function public.reject_bill(p_id uuid, p_note text) returns void
language plpgsql security definer set search_path=public as $$
declare v_email text;
begin
  if not public.can_approve() then raise exception 'You cannot review bills'; end if;
  if coalesce(trim(p_note),'') = '' then raise exception 'Say what needs fixing'; end if;
  select email into v_email from user_roles where user_id = auth.uid();
  update bill_submissions set status='rejected', review_note=trim(p_note), reviewed_by_email=v_email, reviewed_at=now()
  where id=p_id and status='pending';
  if not found then raise exception 'This bill is no longer pending'; end if;
end $$;

create or replace function public.withdraw_bill(p_id uuid) returns void
language plpgsql security definer set search_path=public as $$
begin
  update bill_submissions set status='withdrawn', reviewed_at=now()
  where id=p_id and submitted_by=auth.uid() and status in ('pending','rejected');
  if not found then raise exception 'Only your own pending or returned bills can be withdrawn'; end if;
end $$;
grant execute on function public.submit_bill(jsonb,jsonb,jsonb,uuid), public.approve_bill(uuid,jsonb,jsonb),
  public.reject_bill(uuid,text), public.withdraw_bill(uuid), public.can_publish(), public.can_approve() to authenticated;

-- ---------- ARCHIVE / DELETE PRODUCTS ----------
-- Direct deletes would cascade away bill history, so deletes go through a checked function only.
drop policy if exists "editor delete" on public.products;

create or replace function public.delete_product(p_product uuid) returns text[]
language plpgsql security definer set search_path=public as $$
declare p record; v_paths text[];
begin
  if not public.can_edit() then raise exception 'Only editors can delete products'; end if;
  select * into p from products where id=p_product for update;
  if p.id is null then raise exception 'Product not found'; end if;
  if exists (select 1 from receipt_lines l join receipts r on r.id=l.receipt_id where l.product_id=p_product and r.reversed_at is null) then
    raise exception '% is on a received bill — archive it instead, so the bill history stays intact', p.code;
  end if;
  if p.stock <> 0 then raise exception '% still has % in stock — archive it, or adjust stock to zero first', p.code, p.stock; end if;
  if exists (select 1 from bill_submissions s where s.status='pending' and s.payload::text like '%' || p_product::text || '%') then
    raise exception '% is on a bill waiting for approval', p.code;
  end if;
  select coalesce(array_agg(path) filter (where path is not null), '{}') into v_paths from product_photos where product_id=p_product;
  delete from products where id=p_product;
  delete from design_families f where f.id = p.family_id and not exists (select 1 from products x where x.family_id = f.id);
  return v_paths;
end $$;
grant execute on function public.delete_product(uuid) to authenticated;

-- Removes the seeded sample products/vendors (and only those). Returns photo paths to delete from storage.
create or replace function public.clear_samples() returns text[]
language plpgsql security definer set search_path=public as $$
declare v_paths text[]; v_fams uuid[];
begin
  if not public.can_edit() then raise exception 'Only editors can clear sample data'; end if;
  select coalesce(array_agg(path) filter (where path is not null), '{}') into v_paths
    from product_photos where product_id in (select id from products where is_sample);
  select coalesce(array_agg(distinct family_id), '{}') into v_fams from products where is_sample;
  delete from products where is_sample;
  delete from design_families f where f.id = any(v_fams) and not exists (select 1 from products x where x.family_id = f.id);
  delete from vendors v where v.is_sample and not exists (select 1 from receipts r where r.vendor_id = v.id);
  return v_paths;
end $$;
grant execute on function public.clear_samples() to authenticated;
