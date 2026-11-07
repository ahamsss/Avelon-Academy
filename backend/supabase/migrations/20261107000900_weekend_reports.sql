-- Weekend report: one email per student every Saturday, summarising that week's classes.
-- This table records what was sent so a student never gets the same week twice.
create table if not exists public.weekend_reports (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  week_start date not null,
  sent_to text not null,
  class_count integer not null,
  sent_at timestamptz not null default now(),
  unique (student_id, week_start)
);
alter table public.weekend_reports enable row level security;
create policy weekend_reports_admin_read on public.weekend_reports for select using (public.my_role() = 'admin');
grant select on public.weekend_reports to authenticated;
grant all on public.weekend_reports to service_role;

-- Saturdays at 16:00 UTC (9am Edmonton in winter, 10am in summer).
select cron.schedule('avelon-weekend-report', '0 16 * * 6', $job$
  select net.http_post(
    url := 'https://roqrfckvwsnghifetrld.supabase.co/functions/v1/weekend-report',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'avelon_cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000);
$job$);
