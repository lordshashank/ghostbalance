-- Likes
CREATE TABLE IF NOT EXISTS likes (
  post_id    UUID NOT NULL REFERENCES posts (id) ON DELETE CASCADE,
  nullifier  TEXT NOT NULL REFERENCES profiles (nullifier) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (post_id, nullifier)
);

-- Bookmarks
CREATE TABLE IF NOT EXISTS bookmarks (
  post_id    UUID NOT NULL REFERENCES posts (id) ON DELETE CASCADE,
  nullifier  TEXT NOT NULL REFERENCES profiles (nullifier) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (post_id, nullifier)
);

CREATE INDEX IF NOT EXISTS idx_bookmarks_user ON bookmarks (nullifier, created_at DESC);

-- Follows
CREATE TABLE IF NOT EXISTS follows (
  follower_nullifier   TEXT NOT NULL REFERENCES profiles (nullifier) ON DELETE CASCADE,
  following_nullifier  TEXT NOT NULL REFERENCES profiles (nullifier) ON DELETE CASCADE,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (follower_nullifier, following_nullifier),
  CHECK (follower_nullifier != following_nullifier)
);

CREATE INDEX IF NOT EXISTS idx_follows_following ON follows (following_nullifier);

-- Blocks
CREATE TABLE IF NOT EXISTS blocks (
  blocker_nullifier  TEXT NOT NULL REFERENCES profiles (nullifier) ON DELETE CASCADE,
  blocked_nullifier  TEXT NOT NULL REFERENCES profiles (nullifier) ON DELETE CASCADE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (blocker_nullifier, blocked_nullifier),
  CHECK (blocker_nullifier != blocked_nullifier)
);
