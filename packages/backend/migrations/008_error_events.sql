-- Optional: errorping error tracking (ENABLE_ERRORPING=true)
CREATE TABLE IF NOT EXISTS error_events (
  id            UUID PRIMARY KEY,
  timestamp     TIMESTAMPTZ NOT NULL,
  severity      INTEGER NOT NULL,
  name          TEXT NOT NULL,
  message       TEXT NOT NULL,
  stack         TEXT,
  fingerprint   TEXT NOT NULL,
  context       JSONB NOT NULL DEFAULT '{}',
  occurrences   INTEGER NOT NULL DEFAULT 1,
  first_seen    TIMESTAMPTZ NOT NULL,
  resolved      BOOLEAN NOT NULL DEFAULT FALSE,
  resolved_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_error_events_timestamp ON error_events(timestamp);
CREATE INDEX IF NOT EXISTS idx_error_events_fingerprint ON error_events(fingerprint);
CREATE INDEX IF NOT EXISTS idx_error_events_severity ON error_events(severity);
CREATE INDEX IF NOT EXISTS idx_error_events_resolved ON error_events(resolved);
