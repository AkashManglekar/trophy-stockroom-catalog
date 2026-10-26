-- Zoho Books connection kept in the database (set from the app by the owner), so nobody has to
-- add server secrets by hand. No RLS policies: only the server (service role) can read or write it.
create table if not exists public.zoho_connection (
  id int primary key default 1 check (id = 1),
  client_id text not null,
  client_secret text not null,
  refresh_token text not null,
  dc text not null default 'in',
  org_id text not null default '60089715531',
  org_name text,
  connected_at timestamptz not null default now(),
  connected_by_email text
);
alter table public.zoho_connection enable row level security;
revoke all on public.zoho_connection from anon, authenticated;
