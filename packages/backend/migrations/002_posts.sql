-- Posts: unified table for posts, replies, reposts, quote reposts
CREATE TABLE IF NOT EXISTS posts (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  author_nullifier   TEXT NOT NULL REFERENCES profiles (nullifier) ON DELETE CASCADE,
  body               TEXT,
  parent_id          UUID REFERENCES posts (id) ON DELETE CASCADE,
  root_id            UUID REFERENCES posts (id) ON DELETE CASCADE,
  repost_of_id       UUID REFERENCES posts (id) ON DELETE SET NULL,
  poll_id            UUID,
  like_count         INT NOT NULL DEFAULT 0,
  repost_count       INT NOT NULL DEFAULT 0,
  reply_count        INT NOT NULL DEFAULT 0,
  view_count         INT NOT NULL DEFAULT 0,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_posts_author ON posts (author_nullifier, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_parent ON posts (parent_id) WHERE parent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_posts_root ON posts (root_id) WHERE root_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_posts_created ON posts (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_repost ON posts (repost_of_id) WHERE repost_of_id IS NOT NULL;

-- Post attachments: images/files linked to posts via S3 uploads
CREATE TABLE IF NOT EXISTS post_attachments (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id      UUID NOT NULL REFERENCES posts (id) ON DELETE CASCADE,
  upload_key   TEXT NOT NULL,
  position     SMALLINT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_post_attachments_post ON post_attachments (post_id);

-- Post views: click-to-expand tracking for trending (one view per user per post)
CREATE TABLE IF NOT EXISTS post_views (
  post_id           UUID NOT NULL REFERENCES posts (id) ON DELETE CASCADE,
  viewer_nullifier  TEXT NOT NULL,
  viewed_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (post_id, viewer_nullifier)
);

CREATE INDEX IF NOT EXISTS idx_post_views_post ON post_views (post_id, viewed_at);
