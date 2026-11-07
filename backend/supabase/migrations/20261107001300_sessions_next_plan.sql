-- Tutor's plan for next week, shown under "Next week" in the weekend report.
alter table public.sessions add column if not exists next_plan text check (next_plan is null or char_length(next_plan) <= 1000);
