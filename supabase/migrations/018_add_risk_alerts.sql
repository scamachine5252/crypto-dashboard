CREATE TABLE risk_alerts (
  id              uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      uuid    NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  rule_type       text    NOT NULL,
  current_value   numeric NOT NULL,
  alert_threshold numeric NOT NULL,
  kill_threshold  numeric,
  severity        text    NOT NULL CHECK (severity IN ('warning', 'critical')),
  acknowledged    boolean NOT NULL DEFAULT false,
  fired_at        timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE risk_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service role full access" ON risk_alerts
  FOR ALL TO service_role USING (true) WITH CHECK (true);
