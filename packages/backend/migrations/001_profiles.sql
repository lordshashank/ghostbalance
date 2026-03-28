-- Profiles: anonymous identity via ZK proof nullifier
CREATE TABLE IF NOT EXISTS profiles (
  nullifier        TEXT PRIMARY KEY,
  bio              TEXT,
  gender           TEXT CHECK (gender IS NULL OR gender IN ('male', 'female', 'other')),
  age              SMALLINT CHECK (age IS NULL OR (age >= 13 AND age <= 150)),
  avatar_key       TEXT,
  banner_key       TEXT,
  public_balance   NUMERIC NOT NULL DEFAULT 0,
  initial_balance  NUMERIC NOT NULL DEFAULT 0,
  block_number     BIGINT NOT NULL,
  block_hash       TEXT NOT NULL,
  post_count       INT NOT NULL DEFAULT 0,
  follower_count   INT NOT NULL DEFAULT 0,
  following_count  INT NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_profiles_balance ON profiles (public_balance DESC);
CREATE INDEX IF NOT EXISTS idx_profiles_post_count ON profiles (post_count DESC);
CREATE INDEX IF NOT EXISTS idx_profiles_follower_count ON profiles (follower_count DESC);

-- Sessions: lightweight cookie auth created after ZK proof verification
CREATE TABLE IF NOT EXISTS sessions (
  token            TEXT PRIMARY KEY,
  nullifier        TEXT NOT NULL REFERENCES profiles (nullifier) ON DELETE CASCADE,
  public_balance   NUMERIC NOT NULL,
  block_number     BIGINT NOT NULL,
  block_hash       TEXT NOT NULL,
  expires_at       TIMESTAMPTZ NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sessions_nullifier ON sessions (nullifier);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions (expires_at);
