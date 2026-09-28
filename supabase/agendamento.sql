-- =====================================================================
-- Agendamento da limpeza diária (rode UMA vez no SQL Editor do Supabase,
-- depois de fazer o deploy da Edge Function "limpeza").
--
-- Troque os dois valores marcados com <<< >>> antes de rodar.
-- =====================================================================
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

select vault.create_secret('https://<<<SEU-PROJETO>>>.supabase.co', 'project_url');
select vault.create_secret('<<<MESMO-VALOR-DO-LIMPEZA_SECRET>>>', 'limpeza_secret');

-- Todo dia às 06:00 UTC (03:00 em Brasília)
select cron.schedule(
  'limpeza-diaria',
  '0 6 * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
           || '/functions/v1/limpeza',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-limpeza-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'limpeza_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);

-- Conferir:        select * from cron.job;
-- Ver execuções:   select * from cron.job_run_details order by start_time desc limit 10;
-- Respostas HTTP:  select * from net._http_response order by created desc limit 10;
-- Remover:         select cron.unschedule('limpeza-diaria');
