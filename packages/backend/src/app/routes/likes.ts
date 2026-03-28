import type { RouteConfig } from "../../server/router.js";
import type { QueryFn } from "../../db/pool.js";
import { parseQueryParams, parseCursor, cursorResponse } from "../../app/helpers.js";

export const likeRoutes: RouteConfig[] = [
  {
    method: "POST",
    path: "/posts/:id/like",
    auth: { strategy: "session" },
    rateLimit: { windowMs: 60_000, max: 60 },
    handler: async (ctx) => {
      const postId = ctx.params.id;
      const nullifier = ctx.auth.userId;

      const { liked, like_count } = await ctx.db.transaction(async (query: QueryFn) => {
        const existing = await query(
          "SELECT 1 FROM likes WHERE post_id = $1 AND nullifier = $2",
          [postId, nullifier]
        );

        let toggled: boolean;

        if (existing.rows.length > 0) {
          await query(
            "DELETE FROM likes WHERE post_id = $1 AND nullifier = $2",
            [postId, nullifier]
          );
          await query(
            "UPDATE posts SET like_count = like_count - 1 WHERE id = $1",
            [postId]
          );
          toggled = false;
        } else {
          await query(
            "INSERT INTO likes (post_id, nullifier) VALUES ($1, $2)",
            [postId, nullifier]
          );
          await query(
            "UPDATE posts SET like_count = like_count + 1 WHERE id = $1",
            [postId]
          );
          toggled = true;
        }

        const updated = await query(
          "SELECT like_count FROM posts WHERE id = $1",
          [postId]
        );

        return { liked: toggled, like_count: updated.rows[0].like_count };
      });

      // Fire-and-forget notification on like (not unlike) — outside transaction
      if (liked) {
        try {
          const postResult = await ctx.db.query(
            "SELECT author_nullifier FROM posts WHERE id = $1",
            [postId]
          );
          if (postResult.rows.length > 0) {
            const authorNullifier = postResult.rows[0].author_nullifier;
            if (authorNullifier !== nullifier) {
              ctx.db.query(
                `INSERT INTO notifications (recipient_nullifier, type, actor_nullifier, post_id)
                 SELECT $1, $2, $3, $4
                 WHERE NOT EXISTS (
                   SELECT 1 FROM notifications
                   WHERE recipient_nullifier = $1 AND type = $2 AND actor_nullifier = $3 AND post_id = $4
                 )`,
                [authorNullifier, "like", nullifier, postId]
              ).catch(() => {});
            }
          }
        } catch {
          // notification is fire-and-forget, never fail parent operation
        }
      }

      return {
        status: 200,
        json: { liked, like_count },
      };
    },
  },
  {
    method: "GET",
    path: "/posts/:id/likes",
    auth: "public",
    handler: async (ctx) => {
      const postId = ctx.params.id;
      const params = parseQueryParams(ctx.req);
      const { cursor, limit } = parseCursor(params);

      const queryParams: unknown[] = [postId, limit + 1];
      let cursorClause = "";

      if (cursor) {
        cursorClause = "AND l.created_at < $3";
        queryParams.push(cursor);
      }

      const result = await ctx.db.query(
        `SELECT l.nullifier, l.created_at, pr.public_balance, pr.avatar_key
         FROM likes l
         JOIN profiles pr ON l.nullifier = pr.nullifier
         WHERE l.post_id = $1 ${cursorClause}
         ORDER BY l.created_at DESC
         LIMIT $2`,
        queryParams
      );

      return {
        status: 200,
        json: cursorResponse(result.rows, limit, (row: any) => row.created_at),
      };
    },
  },
];
