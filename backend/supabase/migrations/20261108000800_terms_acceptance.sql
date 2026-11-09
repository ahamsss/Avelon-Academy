-- Record when a parent agreed to the Terms (ticked the box before saving a card), and which version.
alter table public.profiles add column if not exists terms_accepted_at timestamptz;
alter table public.profiles add column if not exists terms_version text;
