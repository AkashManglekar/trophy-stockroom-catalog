-- Vendor workspace: notes, links (online catalogue, price list…) and uploaded documents, all in one
-- place on the vendor. Files live in the private 'media' bucket under vendors/<vendor id>/…, read
-- through short-lived signed links (members only); the public /media route never serves them.
create table if not exists public.vendor_notes (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.vendors(id) on delete cascade,
  kind text not null check (kind in ('note','link','file')),
  title text,
  body text,
  url text,
  file_path text,
  file_name text,
  mime text,
  size_bytes bigint,
  pinned boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  created_by_email text default (auth.jwt() ->> 'email'),
  constraint vendor_notes_content check (
    (kind = 'note' and coalesce(trim(body),'') <> '') or
    (kind = 'link' and url ~* '^https?://') or
    (kind = 'file' and file_path like 'vendors/%')
  )
);
create index if not exists vendor_notes_vendor on public.vendor_notes (vendor_id, created_at desc);
alter table public.vendor_notes enable row level security;
drop policy if exists "members read" on public.vendor_notes;
create policy "members read" on public.vendor_notes for select using ((select is_member()));
drop policy if exists "contrib add" on public.vendor_notes;
create policy "contrib add" on public.vendor_notes for insert with check ((select can_contribute()));
drop policy if exists "author or editor change" on public.vendor_notes;
create policy "author or editor change" on public.vendor_notes for update
  using ((select can_edit()) or created_by = auth.uid())
  with check ((select can_edit()) or created_by = auth.uid());
drop policy if exists "author or editor delete" on public.vendor_notes;
create policy "author or editor delete" on public.vendor_notes for delete
  using ((select can_edit()) or created_by = auth.uid());

-- Vendor catalogues are often large PDFs.
update storage.buckets set file_size_limit = 26214400 where id = 'media';
