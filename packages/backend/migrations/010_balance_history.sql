-- Balance history for tracking balance changes over time
CREATE TABLE IF NOT EXISTS balance_history (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nullifier       TEXT NOT NULL REFERENCES profiles(nullifier) ON DELETE CASCADE,
  public_balance  NUMERIC NOT NULL,
  block_number    BIGINT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_balance_history_user ON balance_history(nullifier, created_at);
