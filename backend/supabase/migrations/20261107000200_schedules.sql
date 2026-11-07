-- Automatic jobs. The cron secret is generated inside Supabase Vault (never typed anywhere);
-- copy it from Dashboard > Integrations > Vault ("avelon_cron_secret") into the
-- CRON_SECRET Edge Function secret.
create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'avelon_cron_secret') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'avelon_cron_secret',
                                'Shared secret sent to the weekly-billing function by pg_cron');
  end if;
end $$;

-- Every hour: classes nobody confirmed or flagged within 24 hours become approved.
select cron.schedule('avelon-auto-approve', '0 * * * *', $job$
  update public.sessions
     set status = 'approved', approved_by = 'auto', approved_at = now()
   where status = 'pending' and created_at < now() - interval '24 hours';
$job$);

-- Every Monday 16:00 UTC (9am Edmonton in winter, 10am in summer): weekly billing.
select cron.schedule('avelon-weekly-billing', '0 16 * * 1', $job$
  select net.http_post(
    url := 'https://roqrfckvwsnghifetrld.supabase.co/functions/v1/weekly-billing',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'avelon_cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000);
$job$);
