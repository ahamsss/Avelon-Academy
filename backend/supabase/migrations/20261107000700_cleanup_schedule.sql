-- Every day at 09:30 UTC: delete class files older than 90 days; on Mondays, warn if storage is past 75%.
select cron.schedule('avelon-cleanup-files', '30 9 * * *', $job$
  select net.http_post(
    url := 'https://roqrfckvwsnghifetrld.supabase.co/functions/v1/cleanup-files',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'avelon_cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000);
$job$);
