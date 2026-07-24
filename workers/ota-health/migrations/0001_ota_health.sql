CREATE TABLE IF NOT EXISTS ota_health_events (
  id INTEGER PRIMARY KEY,
  event_key TEXT NOT NULL UNIQUE,
  attempt_id TEXT NOT NULL,
  current_version TEXT NOT NULL,
  target_version TEXT,
  platform TEXT NOT NULL CHECK (platform IN ('darwin', 'linux')),
  arch TEXT NOT NULL CHECK (arch IN ('arm64', 'x64')),
  cohort INTEGER NOT NULL CHECK (cohort >= 0 AND cohort < 100),
  lifecycle TEXT NOT NULL,
  error_code TEXT,
  occurred_at TEXT NOT NULL,
  received_at TEXT NOT NULL,
  duration_ms INTEGER
);

CREATE INDEX IF NOT EXISTS idx_ota_health_events_received_at
ON ota_health_events(received_at);

CREATE TABLE IF NOT EXISTS ota_health_daily_aggregates (
  observed_day TEXT NOT NULL,
  current_version TEXT NOT NULL,
  target_version TEXT NOT NULL,
  platform TEXT NOT NULL,
  arch TEXT NOT NULL,
  cohort INTEGER NOT NULL,
  lifecycle TEXT NOT NULL,
  error_code TEXT NOT NULL,
  event_count INTEGER NOT NULL DEFAULT 0,
  duration_count INTEGER NOT NULL DEFAULT 0,
  duration_sum_ms INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (
    observed_day, current_version, target_version, platform, arch, cohort,
    lifecycle, error_code
  )
);

CREATE TRIGGER IF NOT EXISTS ota_health_rollup_after_insert
AFTER INSERT ON ota_health_events
BEGIN
  INSERT INTO ota_health_daily_aggregates (
    observed_day, current_version, target_version, platform, arch, cohort,
    lifecycle, error_code, event_count, duration_count, duration_sum_ms
  ) VALUES (
    substr(NEW.received_at, 1, 10) || 'T00:00:00.000Z', NEW.current_version, COALESCE(NEW.target_version, ''),
    NEW.platform, NEW.arch, NEW.cohort, NEW.lifecycle, COALESCE(NEW.error_code, ''), 1,
    CASE WHEN NEW.duration_ms IS NULL THEN 0 ELSE 1 END,
    COALESCE(NEW.duration_ms, 0)
  ) ON CONFLICT(
    observed_day, current_version, target_version, platform, arch, cohort,
    lifecycle, error_code
  ) DO UPDATE SET
    event_count = event_count + 1,
    duration_count = duration_count + CASE WHEN NEW.duration_ms IS NULL THEN 0 ELSE 1 END,
    duration_sum_ms = duration_sum_ms + COALESCE(NEW.duration_ms, 0);
END;
