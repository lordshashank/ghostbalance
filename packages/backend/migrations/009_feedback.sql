-- Optional: feedback forum (ENABLE_FEEDBACK=true)
CREATE TABLE IF NOT EXISTS feedback_posts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       TEXT NOT NULL,
  type          TEXT NOT NULL CHECK (type IN ('bug', 'feature', 'improvement', 'question')),
  title         TEXT NOT NULL,
  description   TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'under_review', 'planned', 'in_progress', 'done', 'rejected', 'duplicate')),
  priority      TEXT CHECK (priority IN ('low', 'medium', 'high', 'critical')),
  admin_note    TEXT,
  duplicate_of  UUID REFERENCES feedback_posts(id) ON DELETE SET NULL,
  vote_count    INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_feedback_posts_status ON feedback_posts(status);
CREATE INDEX IF NOT EXISTS idx_feedback_posts_type ON feedback_posts(type);
CREATE INDEX IF NOT EXISTS idx_feedback_posts_user_id ON feedback_posts(user_id);
CREATE INDEX IF NOT EXISTS idx_feedback_posts_vote_count ON feedback_posts(vote_count DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_posts_created_at ON feedback_posts(created_at DESC);

CREATE TABLE IF NOT EXISTS feedback_votes (
  post_id    UUID NOT NULL REFERENCES feedback_posts(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (post_id, user_id)
);

CREATE TABLE IF NOT EXISTS feedback_comments (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id    UUID NOT NULL REFERENCES feedback_posts(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL,
  body       TEXT NOT NULL,
  is_admin   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_feedback_comments_post_id ON feedback_comments(post_id);
