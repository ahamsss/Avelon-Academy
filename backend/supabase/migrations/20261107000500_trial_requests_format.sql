-- Class type the parent asked for on the trial form: one-on-one, small group (2-3) or either.
alter table public.trial_requests add column if not exists format text not null default 'One-on-one' check (char_length(format) <= 40);
