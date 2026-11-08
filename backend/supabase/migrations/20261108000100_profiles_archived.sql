-- Archived (removed) families keep their records; their login is blocked.
alter table public.profiles add column if not exists archived_at timestamptz;
