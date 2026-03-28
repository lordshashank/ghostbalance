-- Notifications
CREATE TABLE IF NOT EXISTS notifications (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_nullifier  TEXT NOT NULL REFERENCES profiles (nullifier) ON DELETE CASCADE,
  type                 TEXT NOT NULL CHECK (type IN (
    'like', 'reply', 'repost', 'follow', 'poll_ended', 'mention', 'dm', 'group_invite'
  )),
  actor_nullifier      TEXT NOT NULL REFERENCES profiles (nullifier) ON DELETE CASCADE,
  post_id              UUID REFERENCES posts (id) ON DELETE CASCADE,
  conversation_id      UUID REFERENCES conversations (id) ON DELETE CASCADE,
  read                 BOOLEAN NOT NULL DEFAULT false,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_recipient
  ON notifications (recipient_nullifier, read, created_at DESC);
