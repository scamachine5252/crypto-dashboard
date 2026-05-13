-- retry_count on full_sync_jobs
alter table full_sync_jobs
  add column if not exists retry_count int not null default 0;
