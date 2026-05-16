CREATE TABLE IF NOT EXISTS full_sync_jobs (
  id            uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  account_id    uuid        NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  exchange      text        NOT NULL,
  status        text        NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  current_step  integer     NOT NULL DEFAULT 0,
  total_steps   integer     NOT NULL DEFAULT 0,
  failed_items  jsonb       NOT NULL DEFAULT '[]'::jsonb,
  error_message text,
  created_at    timestamptz DEFAULT now(),
  started_at    timestamptz,
  completed_at  timestamptz
);

CREATE INDEX full_sync_jobs_status_idx
  ON full_sync_jobs (status, created_at)
  WHERE status IN ('pending', 'processing');

CREATE INDEX full_sync_jobs_account_idx
  ON full_sync_jobs (account_id, created_at DESC);
