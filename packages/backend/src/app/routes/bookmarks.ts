import type { RouteConfig } from "../../server/router.js";
import type { QueryFn } from "../../db/pool.js";
import { parseQueryParams, parseCursor, cursorResponse } from "../../app/helpers.js";

export const bookmarkRoutes: RouteConfig[] = [
  {
    method: "POST",
    path: "/posts/:id/bookmark",
    auth: { strategy: "session" },
    rateLimit: { windowMs: 60_000, max: 60 },
    handler: async (ctx) => {
      const postId = ctx.params.id;
      const nullifier = ctx.auth.userId;

      const bookmarked = await ctx.db.transaction(async (query: QueryFn) => {
        const existing = await query(
          "SELECT 1 FROM bookmarks WHERE post_id = $1 AND nullifier = $2",
          [postId, nullifier]
        );

        if (existing.rows.length > 0) {
          await query(
            "DELETE FROM bookmarks WHERE post_id = $1 AND nullifier = $2",
            [postId, nullifier]
          );
          return false;
        } else {
          await query(
            "INSERT INTO bookmarks (post_id, nullifier) VALUES ($1, $2)",
            [postId, nullifier]
          );
          return true;
        }
      });

      return {
        status: 200,
        json: { bookmarked },
      };
    },
  },
  {
    method: "GET",
    path: "/bookmarks",
    auth: { strategy: "session" },
    handler: async (ctx) => {
      const nullifier = ctx.auth.userId;
      const params = parseQueryParams(ctx.req);
      const { cursor, limit } = parseCursor(params);

      const queryParams: unknown[] = [nullifier, limit + 1];
      let cursorClause = "";

      if (cursor) {
        cursorClause = "AND b.created_at < $3";
        queryParams.push(cursor);
      }

      const result = await ctx.db.query(
        `SELECT b.created_at AS bookmark_created_at, p.*, pr.public_balance, pr.avatar_key,
                (bk.nullifier IS NOT NULL) AS viewer_bookmarked,
                (l.nullifier IS NOT NULL) AS viewer_liked
         FROM bookmarks b
         JOIN posts p ON b.post_id = p.id
         JOIN profiles pr ON p.author_nullifier = pr.nullifier
         LEFT JOIN bookmarks bk ON bk.post_id = p.id AND bk.nullifier = $1
         LEFT JOIN likes l ON l.post_id = p.id AND l.nullifier = $1
         WHERE b.nullifier = $1 ${cursorClause}
         ORDER BY b.created_at DESC
         LIMIT $2`,
        queryParams
      );

      return {
        status: 200,
        json: cursorResponse(result.rows, limit, (row: any) => row.bookmark_created_at),
      };
    },
  },
];
