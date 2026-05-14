-- retry_count and retry_after on full_sync_jobs
alter table full_sync_jobs
  add column if not exists retry_count  int         not null default 0;
alter table full_sync_jobs
  add column if not exists retry_after  timestamptz;

-- Singleton table for worker health tracking
create table if not exists worker_status (
  id                int primary key default 1 check (id = 1),
  last_heartbeat    timestamptz not null default now(),
  started_at        timestamptz not null default now(),
  binance_ban_until timestamptz
);
insert into worker_status (id) values (1) on conflict do nothing;

-- Add binance_ban_until to existing deployments that already ran this migration
alter table worker_status
  add column if not exists binance_ban_until timestamptz;

-- RPC: latest fill timestamp per account (DISTINCT ON avoids data-skew blind spots)
create or replace function latest_fill_per_account(account_ids uuid[])
returns table(account_id uuid, exec_time timestamptz)
language sql stable as $$
  select distinct on (rf.account_id) rf.account_id, rf.exec_time
  from raw_fills rf
  where rf.account_id = any(account_ids)
  order by rf.account_id, rf.exec_time desc;
$$;

-- Enable pg_cron and pg_net for scheduled watchdog
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Schedule watchdog every 30 minutes (idempotent: unschedule first if already exists)
-- NOTE: app.supabase_url and app.supabase_service_role_key must be set
-- via Supabase SQL editor (not in this migration, as keys must not be committed):
--   alter database postgres set app.supabase_url = 'https://<project>.supabase.co';
--   alter database postgres set app.supabase_service_role_key = '<key>';
do $$ begin
  perform cron.unschedule('watchdog-check');
exception when others then null;
end $$;

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
