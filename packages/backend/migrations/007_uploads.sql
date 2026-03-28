CREATE TABLE IF NOT EXISTS uploads (
  key TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed', 'deleting')),
  upload_expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '5 minutes'),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS uploads_user_status_created_idx
  ON uploads (user_id, status, created_at DESC);
