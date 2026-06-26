-- Battery level history for GPS trackers.
-- Polled hourly via gps-battery-monitor.sh cron → POST /internal/gps/battery-sync.
-- Enables discharge-rate calculation and low-battery alerting.

CREATE TABLE gps_battery_log (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID          NOT NULL,
  tracker_id      UUID          NOT NULL REFERENCES gps_trackers(id) ON DELETE CASCADE,
  traccar_device_id INTEGER     NOT NULL,
  battery_level   SMALLINT      NOT NULL CHECK (battery_level BETWEEN 0 AND 100),
  is_charging     BOOLEAN       NOT NULL DEFAULT false,
  recorded_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_gps_battery_log_tracker_time ON gps_battery_log (tracker_id, recorded_at DESC);
CREATE INDEX idx_gps_battery_log_tenant       ON gps_battery_log (tenant_id, recorded_at DESC);

-- RLS: same tenant isolation as gps_trackers
ALTER TABLE gps_battery_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE gps_battery_log FORCE ROW LEVEL SECURITY;

CREATE POLICY gps_battery_log_tenant ON gps_battery_log
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

GRANT SELECT, INSERT ON gps_battery_log TO jag_app;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO jag_app;
