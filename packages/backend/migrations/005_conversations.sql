-- Conversations (1:1 DMs and group chats)
CREATE TABLE IF NOT EXISTS conversations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  is_group        BOOLEAN NOT NULL DEFAULT false,
  name            TEXT,
  created_by      TEXT NOT NULL REFERENCES profiles (nullifier) ON DELETE CASCADE,
  last_message_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Conversation members with per-user read cursor
CREATE TABLE IF NOT EXISTS conversation_members (
  conversation_id  UUID NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  nullifier        TEXT NOT NULL REFERENCES profiles (nullifier) ON DELETE CASCADE,
  last_read_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (conversation_id, nullifier)
);

CREATE INDEX IF NOT EXISTS idx_conv_members_user ON conversation_members (nullifier);

-- Direct messages
CREATE TABLE IF NOT EXISTS messages (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id   UUID NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  sender_nullifier  TEXT NOT NULL REFERENCES profiles (nullifier) ON DELETE CASCADE,
  body              TEXT,
  attachment_key    TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages (conversation_id, created_at);
