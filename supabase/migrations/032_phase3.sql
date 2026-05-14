-- last_reconstructed_at: allows PositionReconstructor to skip when no new fills exist since last run
alter table accounts
  add column if not exists last_reconstructed_at timestamptz;
