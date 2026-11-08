-- 24-hour sign-in codes sent in "your account is ready" emails. Only backend functions (service role) touch this table.
create table if not exists public.invite_codes (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  code_hash text not null,
  expires_at timestamptz not null,
  attempts int not null default 0,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists invite_codes_email_idx on public.invite_codes (lower(email), created_at desc);
alter table public.invite_codes enable row level security;
revoke all on public.invite_codes from anon, authenticated;
