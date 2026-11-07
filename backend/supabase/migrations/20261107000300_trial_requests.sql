-- Trial class requests from the homepage form. Written only by the book-trial function (service role);
-- readable and updatable by admins in the portal.
create table if not exists public.trial_requests (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  parent_name text not null check (char_length(parent_name) between 1 and 120),
  email text not null check (char_length(email) between 3 and 254),
  grade text not null check (char_length(grade) <= 20),
  subject text not null check (char_length(subject) <= 40),
  status text not null default 'new' check (status in ('new', 'contacted', 'booked', 'closed')),
  ip_hash text
);
create index if not exists trial_requests_created_idx on public.trial_requests (created_at desc);
create index if not exists trial_requests_ip_idx on public.trial_requests (ip_hash, created_at desc);

alter table public.trial_requests enable row level security;

create policy trial_requests_admin_read on public.trial_requests for select
  using (public.my_role() = 'admin');
create policy trial_requests_admin_update on public.trial_requests for update
  using (public.my_role() = 'admin') with check (public.my_role() = 'admin');

revoke all on public.trial_requests from anon, authenticated;
grant select, update (status) on public.trial_requests to authenticated;
grant all on public.trial_requests to service_role;
