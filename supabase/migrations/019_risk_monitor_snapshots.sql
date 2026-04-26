-- Stores the last computed metric value per account per rule_type.
-- Updated by runRiskEvaluation(); enables fast Monitor page load.
CREATE TABLE risk_metric_snapshots (
  account_id    uuid        NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  rule_type     text        NOT NULL,
  current_value numeric     NOT NULL,
  evaluated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, rule_type)
);
ALTER TABLE risk_metric_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service role full access" ON risk_metric_snapshots
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Per-account kill switch toggle (independent of per-rule kill_threshold values).
-- When false: account is never suspended even when kill_threshold is breached.
ALTER TABLE accounts ADD COLUMN kill_switch_enabled boolean NOT NULL DEFAULT true;
