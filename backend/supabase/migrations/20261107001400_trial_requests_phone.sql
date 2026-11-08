-- Phone number from the homepage trial form.
alter table public.trial_requests add column if not exists phone text check (phone is null or char_length(phone) <= 30);
