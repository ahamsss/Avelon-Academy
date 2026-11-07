-- =====================================================================
-- Avelon Academy portal: automatic jobs
-- Run this AFTER the backend functions are deployed (setup guide, step 6).
-- Before running, replace the two placeholders:
--   YOUR-PROJECT-REF   -> the letters in your Supabase URL (https://YOUR-PROJECT-REF.supabase.co)
--   YOUR-CRON-SECRET   -> the same CRON_SECRET you saved in Edge Function secrets
-- =====================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Every hour: classes nobody confirmed or flagged within 24 hours become approved.
select cron.schedule(
  'avelon-auto-approve',
  '0 * * * *',
  $$
    update public.sessions
       set status = 'approved', approved_by = 'auto', approved_at = now()
     where status = 'pending' and created_at < now() - interval '24 hours';
  $$
);

-- Every Monday at 16:00 UTC (9am Edmonton in winter, 10am in summer):
-- charge each family's saved card for their approved classes.
select cron.schedule(
  'avelon-weekly-billing',
  '0 16 * * 1',
  $$
    select net.http_post(
      url := 'https://YOUR-PROJECT-REF.supabase.co/functions/v1/weekly-billing',
      headers := jsonb_build_object('Content-Type', 'application/json',
                                    'x-cron-secret', 'YOUR-CRON-SECRET'),
      body := '{}'::jsonb,
      timeout_milliseconds := 60000
    );
  $$
);

-- To see the jobs:   select * from cron.job;
-- To see past runs:  select * from cron.job_run_details order by start_time desc limit 20;
-- To remove a job:   select cron.unschedule('avelon-weekly-billing');
