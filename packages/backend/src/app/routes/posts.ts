import type { RouteConfig } from "../../server/router.js";
import type { QueryFn } from "../../db/pool.js";
import {
  parseQueryParams,
  parseCursor,
  cursorResponse,
  blockFilterSql,
  attachAttachmentsToRows,
} from "../helpers.js";

export function createPostRoutes(config: {
  postMaxLength: number;
  maxPollOptions: number;
}): RouteConfig[] {
  return [
    // Create a post
    {
      method: "POST",
      path: "/posts",
      auth: { strategy: "session" },
      rateLimit: { windowMs: 60_000, max: 20 },
      handler: async (ctx) => {
        const { body, attachments, parent_id, repost_of_id, poll } = ctx.body as {
          body?: string;
          attachments?: string[];
          parent_id?: string;
          repost_of_id?: string;
          poll?: { options: string[]; expires_in_hours: number };
        };

        if (!body?.trim() && !repost_of_id && (!attachments || attachments.length === 0)) {
          return { status: 400, json: { error: "body, attachments, or repost_of_id is required" } };
        }

        if (body && body.length > config.postMaxLength) {
          return { status: 400, json: { error: "body exceeds maximum length" } };
        }

        if (parent_id && repost_of_id) {
          return { status: 400, json: { error: "a post cannot be both a reply and a repost" } };
        }

        if (poll) {
          if (!Array.isArray(poll.options) || poll.options.length < 2) {
            return { status: 400, json: { error: "poll must have at least 2 options" } };
          }
          if (poll.options.length > config.maxPollOptions) {
            return { status: 400, json: { error: "too many poll options" } };
          }
          if (typeof poll.expires_in_hours !== "number" || poll.expires_in_hours < 1) {
            return { status: 400, json: { error: "poll.expires_in_hours must be at least 1" } };
          }
        }

        const author = ctx.auth.userId;

        const post = await ctx.db.transaction(async (query: QueryFn) => {
          let rootId: string | null = null;

          // Resolve parent for threaded replies
          if (parent_id) {
            const parentResult = await query(
              "SELECT id, root_id, author_nullifier FROM posts WHERE id = $1",
              [parent_id]
            );
            if (parentResult.rows.length === 0) {
              throw Object.assign(new Error("Parent post not found"), { statusCode: 404 });
            }
            const parent = parentResult.rows[0] as { id: string; root_id: string | null; author_nullifier: string };
            rootId = parent.root_id ?? parent.id;
          }

          // Verify repost target exists
          if (repost_of_id) {
            const repostTarget = await query(
              "SELECT id, author_nullifier FROM posts WHERE id = $1",
              [repost_of_id]
            );
            if (repostTarget.rows.length === 0) {
              throw Object.assign(new Error("Repost target not found"), { statusCode: 404 });
            }
          }

          // Create poll if present
          let pollId: string | null = null;
          if (poll) {
            const pollResult = await query(
              `INSERT INTO polls (id, expires_at)
               VALUES (gen_random_uuid(), NOW() + ($1 || ' hours')::interval)
               RETURNING id`,
              [poll.expires_in_hours]
            );
            pollId = (pollResult.rows[0] as { id: string }).id;

            for (let i = 0; i < poll.options.length; i++) {
              await query(
                `INSERT INTO poll_options (id, poll_id, label, position)
                 VALUES (gen_random_uuid(), $1, $2, $3)`,
                [pollId, poll.options[i], i]
              );
            }
          }

          // Insert the post
          const postResult = await query(
            `INSERT INTO posts (id, author_nullifier, body, parent_id, root_id, repost_of_id, poll_id)
             VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6)
             RETURNING *`,
            [author, body?.trim() || null, parent_id || null, rootId, repost_of_id || null, pollId]
          );
          const createdPost = postResult.rows[0] as Record<string, unknown>;

          // Increment parent reply count
          if (parent_id) {
            await query(
              "UPDATE posts SET reply_count = reply_count + 1 WHERE id = $1",
              [parent_id]
            );
          }

          // Increment repost count
          if (repost_of_id) {
            await query(
              "UPDATE posts SET repost_count = repost_count + 1 WHERE id = $1",
              [repost_of_id]
            );
          }

          // Increment author post count
          await query(
            "UPDATE profiles SET post_count = post_count + 1 WHERE nullifier = $1",
            [author]
          );

          // Attach media
          if (attachments && attachments.length > 0) {
            for (let i = 0; i < attachments.length; i++) {
              await query(
                `INSERT INTO post_attachments (id, post_id, upload_key, position)
                 VALUES (gen_random_uuid(), $1, $2, $3)`,
                [createdPost.id, attachments[i], i]
              );
            }
          }

          return createdPost;
        });

        // Fire-and-forget notifications
        if (parent_id) {
          ctx.db
            .query("SELECT author_nullifier FROM posts WHERE id = $1", [parent_id])
            .then((r) => {
              const parentAuthor = (r.rows[0] as { author_nullifier: string } | undefined)
                ?.author_nullifier;
              if (parentAuthor && parentAuthor !== author) {
                return ctx.db.query(
                  `INSERT INTO notifications (id, recipient_nullifier, type, actor_nullifier, post_id)
                   VALUES (gen_random_uuid(), $1, 'reply', $2, $3)`,
                  [parentAuthor, author, (post as Record<string, unknown>).id]
                );
              }
            })
            .catch(() => {});
        }

        if (repost_of_id) {
          ctx.db
            .query("SELECT author_nullifier FROM posts WHERE id = $1", [repost_of_id])
            .then((r) => {
              const originalAuthor = (r.rows[0] as { author_nullifier: string } | undefined)
                ?.author_nullifier;
              if (originalAuthor && originalAuthor !== author) {
                return ctx.db.query(
                  `INSERT INTO notifications (id, recipient_nullifier, type, actor_nullifier, post_id)
                   VALUES (gen_random_uuid(), $1, 'repost', $2, $3)`,
                  [originalAuthor, author, (post as Record<string, unknown>).id]
                );
              }
            })
            .catch(() => {});
        }

        return { status: 201, json: post };
      },
    },

    // List posts (feed)
    {
      method: "GET",
      path: "/posts",
      auth: { strategy: "session", optional: true },
      handler: async (ctx) => {
        const params = parseQueryParams(ctx.req);
        const type = params.get("type") || "latest";
        const author = params.get("author") || null;
        const minBalance = params.get("min_balance") || null;
        const me = ctx.auth.userId || null;
        const { cursor, limit } = parseCursor(params);

        const queryParams: unknown[] = [];
        let paramIdx = 1;

        // --- Build dynamic query parts ---
        const joins: string[] = [];
        const conditions: string[] = [];

        // Cursor clause (applies to non-trending feeds)
        if (cursor && type !== "trending") {
          conditions.push(`p.created_at < $${paramIdx++}`);
          queryParams.push(cursor);
        }

        // Block filter for authenticated users
        if (me) {
          const bf = blockFilterSql(me, paramIdx);
          // blockFilterSql returns clause starting with "AND " — strip it for our conditions array
          conditions.push(bf.clause.replace(/^AND\s+/, ""));
          queryParams.push(...bf.params);
          paramIdx += bf.params.length;
        }

        // Author filter (profile posts tab)
        if (author) {
          conditions.push(`p.author_nullifier = $${paramIdx++}`);
          queryParams.push(author);
        }

        // Type-based conditions
        if (type === "replies" && author) {
          // Profile "Replies" tab — only posts that are replies
          conditions.push("p.parent_id IS NOT NULL");
        } else if (type === "media" && author) {
          // Profile "Media" tab — only posts with attachments
          conditions.push(
            "EXISTS (SELECT 1 FROM post_attachments pa WHERE pa.post_id = p.id)"
          );
        } else if (type === "following") {
          // Following feed — requires auth
          if (!me) {
            return { status: 401, json: { error: "Authentication required for following feed" } };
          }
          joins.push(
            `JOIN follows f ON f.following_nullifier = p.author_nullifier AND f.follower_nullifier = $${paramIdx++}`
          );
          queryParams.push(me);
          conditions.push("p.parent_id IS NULL");
        } else if (!author) {
          // latest (default) — top-level posts only (unless browsing an author profile)
          conditions.push("p.parent_id IS NULL");
        }

        // Min balance filter (works with all feed types)
        if (minBalance) {
          conditions.push(`pr.public_balance >= $${paramIdx++}`);
          queryParams.push(minBalance);
        }

        // Viewer flags (liked / bookmarked)
        let viewerSelect = "";
        if (me) {
          joins.push(
            `LEFT JOIN likes l2 ON l2.post_id = p.id AND l2.nullifier = $${paramIdx++}`
          );
          queryParams.push(me);
          joins.push(
            `LEFT JOIN bookmarks b2 ON b2.post_id = p.id AND b2.nullifier = $${paramIdx++}`
          );
          queryParams.push(me);
          viewerSelect =
            ", (l2.nullifier IS NOT NULL) AS viewer_liked, (b2.nullifier IS NOT NULL) AS viewer_bookmarked";
        }

        // --- Assemble SQL ---
        const whereClause =
          conditions.length > 0 ? "WHERE " + conditions.join("\n                   AND ") : "";
        const joinClause = joins.join("\n               ");

        // Cursor-based pagination for latest, following, author, replies, media
        queryParams.push(limit + 1);
        const limitParam = paramIdx++;

        const sql = `SELECT p.*, pr.public_balance, pr.avatar_key${viewerSelect}
               FROM posts p
               JOIN profiles pr ON p.author_nullifier = pr.nullifier
               ${joinClause}
               ${whereClause}
               ORDER BY p.created_at DESC
               LIMIT $${limitParam}`;

        const result = await ctx.db.query(sql, queryParams);
        const rows = result.rows as Array<Record<string, unknown>>;

        await attachAttachmentsToRows(ctx.db, rows);
        const response = cursorResponse(rows, limit, (row) => String(row.created_at));

        return { status: 200, json: response };
      },
    },

    // Get single post
    {
      method: "GET",
      path: "/posts/:id",
      auth: { strategy: "session", optional: true },
      handler: async (ctx) => {
        const postId = ctx.params.id;
        const me = ctx.auth.userId || null;

        const queryParams: unknown[] = [postId];
        let viewerJoins = "";
        let viewerSelect = "";

        if (me) {
          queryParams.push(me, me);
          viewerJoins = `LEFT JOIN likes vl ON vl.post_id = p.id AND vl.nullifier = $2
           LEFT JOIN bookmarks vb ON vb.post_id = p.id AND vb.nullifier = $3`;
          viewerSelect = ", (vl.nullifier IS NOT NULL) AS viewer_liked, (vb.nullifier IS NOT NULL) AS viewer_bookmarked";
        }

        const postResult = await ctx.db.query(
          `SELECT p.*, pr.public_balance, pr.avatar_key${viewerSelect}
           FROM posts p
           JOIN profiles pr ON p.author_nullifier = pr.nullifier
           ${viewerJoins}
           WHERE p.id = $1`,
          queryParams
        );

        if (postResult.rows.length === 0) {
          return { status: 404, json: { error: "Post not found" } };
        }

        const post = postResult.rows[0] as Record<string, unknown>;

        // Fetch attachments
        const attachResult = await ctx.db.query(
          `SELECT id, upload_key, position FROM post_attachments
           WHERE post_id = $1
           ORDER BY position ASC`,
          [postId]
        );
        post.attachments = attachResult.rows;

        // Fetch poll data if present
        if (post.poll_id) {
          const pollResult = await ctx.db.query(
            `SELECT pl.id, pl.expires_at, pl.created_at AS poll_created_at,
                    po.id AS option_id, po.label, po.position,
                    COUNT(pv.voter_nullifier)::int AS vote_count,
                    COALESCE(SUM(pv.voter_balance), 0)::numeric AS weighted_votes
             FROM polls pl
             JOIN poll_options po ON po.poll_id = pl.id
             LEFT JOIN poll_votes pv ON pv.option_id = po.id
             WHERE pl.id = $1
             GROUP BY pl.id, pl.expires_at, pl.created_at, po.id, po.label, po.position
             ORDER BY po.position ASC`,
            [post.poll_id]
          );

          if (pollResult.rows.length > 0) {
            const first = pollResult.rows[0] as Record<string, unknown>;
            post.poll = {
              id: first.id,
              expires_at: first.expires_at,
              created_at: first.poll_created_at,
              options: pollResult.rows.map((r) => {
                const row = r as Record<string, unknown>;
                return {
                  id: row.option_id,
                  label: row.label,
                  position: row.position,
                  vote_count: row.vote_count,
                  weighted_votes: row.weighted_votes,
                };
              }),
            };
          }
        }

        return { status: 200, json: post };
      },
    },

    // Get thread for a post
    {
      method: "GET",
      path: "/posts/:id/thread",
      auth: { strategy: "session", optional: true },
      handler: async (ctx) => {
        const postId = ctx.params.id;
        const me = ctx.auth.userId || null;

        const queryParams: unknown[] = [postId];
        let viewerJoins = "";
        let viewerSelect = "";

        if (me) {
          queryParams.push(me, me);
          viewerJoins = `LEFT JOIN likes vl ON vl.post_id = th.id AND vl.nullifier = $2
           LEFT JOIN bookmarks vb ON vb.post_id = th.id AND vb.nullifier = $3`;
          viewerSelect = ", (vl.nullifier IS NOT NULL) AS viewer_liked, (vb.nullifier IS NOT NULL) AS viewer_bookmarked";
        }

        const result = await ctx.db.query(
          `WITH RECURSIVE thread AS (
             SELECT p.*, 0 AS depth
             FROM posts p
             WHERE p.id = $1
             UNION ALL
             SELECT c.*, t.depth + 1
             FROM posts c
             INNER JOIN thread t ON c.parent_id = t.id
           )
           SELECT th.*, pr.public_balance, pr.avatar_key${viewerSelect}
           FROM thread th
           JOIN profiles pr ON th.author_nullifier = pr.nullifier
           ${viewerJoins}
           ORDER BY th.created_at ASC`,
          queryParams
        );

        if (result.rows.length === 0) {
          return { status: 404, json: { error: "Post not found" } };
        }

        return { status: 200, json: result.rows };
      },
    },

    // Record a view (one per user per post)
    {
      method: "POST",
      path: "/posts/:id/view",
      auth: { strategy: "session", optional: true },
      rateLimit: { windowMs: 60_000, max: 120 },
      handler: async (ctx) => {
        const postId = ctx.params.id;
        const viewerNullifier = ctx.auth.userId;

        // Only count views from authenticated users (deduped)
        if (!viewerNullifier) {
          return { status: 200, json: { ok: true } };
        }

        const result = await ctx.db.query(
          `INSERT INTO post_views (post_id, viewer_nullifier)
           VALUES ($1, $2)
           ON CONFLICT (post_id, viewer_nullifier) DO NOTHING`,
          [postId, viewerNullifier]
        );

        // Only increment count if a new row was actually inserted
        if (result.rowCount && result.rowCount > 0) {
          await ctx.db.query(
            "UPDATE posts SET view_count = view_count + 1 WHERE id = $1",
            [postId]
          );
        }

        return { status: 200, json: { ok: true } };
      },
    },

    // Delete a post
    {
      method: "DELETE",
      path: "/posts/:id",
      auth: { strategy: "session" },
      rateLimit: { windowMs: 60_000, max: 20 },
      handler: async (ctx) => {
        const postId = ctx.params.id;

        const postResult = await ctx.db.query(
          "SELECT id, author_nullifier, parent_id, repost_of_id FROM posts WHERE id = $1",
          [postId]
        );

        if (postResult.rows.length === 0) {
          return { status: 404, json: { error: "Post not found" } };
        }

        const post = postResult.rows[0] as {
          id: string;
          author_nullifier: string;
          parent_id: string | null;
          repost_of_id: string | null;
        };

        if (post.author_nullifier !== ctx.auth.userId) {
          return { status: 403, json: { error: "You can only delete your own posts" } };
        }

        await ctx.db.transaction(async (query: QueryFn) => {
          // Decrement parent reply count
          if (post.parent_id) {
            await query(
              "UPDATE posts SET reply_count = reply_count - 1 WHERE id = $1",
              [post.parent_id]
            );
          }

          // Decrement repost count on original
          if (post.repost_of_id) {
            await query(
              "UPDATE posts SET repost_count = repost_count - 1 WHERE id = $1",
              [post.repost_of_id]
            );
          }

          // Decrement author post count
          await query(
            "UPDATE profiles SET post_count = post_count - 1 WHERE nullifier = $1",
            [post.author_nullifier]
          );

          // Delete the post (CASCADE handles likes, bookmarks, attachments, views)
          await query("DELETE FROM posts WHERE id = $1", [postId]);
        });

        return { status: 200, json: { ok: true } };
      },
    },
  ];
}
