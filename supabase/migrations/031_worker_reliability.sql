-- retry_count on full_sync_jobs
alter table full_sync_jobs
  add column if not exists retry_count int not null default 0;

-- Singleton table for worker health tracking
create table if not exists worker_status (
  id             int primary key default 1 check (id = 1),
  last_heartbeat timestamptz not null default now(),
  started_at     timestamptz not null default now()
);
insert into worker_status (id) values (1) on conflict do nothing;

-- Enable pg_cron and pg_net for scheduled watchdog
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Schedule watchdog every 30 minutes
-- NOTE: app.supabase_url and app.supabase_service_role_key must be set
-- via Supabase SQL editor (not in this migration, as keys must not be committed):
--   alter database postgres set app.supabase_url = 'https://<project>.supabase.co';
--   alter database postgres set app.supabase_service_role_key = '<key>';
select cron.schedule(
  'watchdog-check',
  '*/30 * * * *',
  $$
  select net.http_post(
    url     := current_setting('app.supabase_url', true) || '/functions/v1/watchdog',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.supabase_service_role_key', true),
      'Content-Type',  'application/json'
    ),
    body    := '{}'::jsonb
  )
  $$
);
