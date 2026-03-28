-- Polls
CREATE TABLE IF NOT EXISTS polls (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add FK from posts.poll_id now that polls table exists
ALTER TABLE posts ADD CONSTRAINT fk_posts_poll FOREIGN KEY (poll_id) REFERENCES polls (id) ON DELETE SET NULL;

-- Poll options
CREATE TABLE IF NOT EXISTS poll_options (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_id   UUID NOT NULL REFERENCES polls (id) ON DELETE CASCADE,
  label     TEXT NOT NULL,
  position  SMALLINT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_poll_options_poll ON poll_options (poll_id);

-- Poll votes: one vote per user per poll, stores voter balance for weighted results
CREATE TABLE IF NOT EXISTS poll_votes (
  poll_id          UUID NOT NULL REFERENCES polls (id) ON DELETE CASCADE,
  option_id        UUID NOT NULL REFERENCES poll_options (id) ON DELETE CASCADE,
  voter_nullifier  TEXT NOT NULL REFERENCES profiles (nullifier) ON DELETE CASCADE,
  voter_balance    NUMERIC NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (poll_id, voter_nullifier)
);
