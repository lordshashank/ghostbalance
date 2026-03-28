import type { RouteConfig } from "../../server/router.js";
import { parseQueryParams, parseCursor, cursorResponse } from "../../app/helpers.js";

export const notificationRoutes: RouteConfig[] = [
  {
    method: "POST",
    path: "/notifications/read",
    auth: { strategy: "session" },
    rateLimit: { windowMs: 60_000, max: 30 },
    handler: async (ctx) => {
      const me = ctx.auth.userId;

      const result = await ctx.db.query(
        "UPDATE notifications SET read = true WHERE recipient_nullifier = $1 AND read = false",
        [me]
      );

      return {
        status: 200,
        json: { ok: true, updated_count: result.rowCount },
      };
    },
  },
  {
    method: "GET",
    path: "/notifications/unread-count",
    auth: { strategy: "session" },
    handler: async (ctx) => {
      const me = ctx.auth.userId;

      const result = await ctx.db.query(
        "SELECT COUNT(*) as count FROM notifications WHERE recipient_nullifier = $1 AND read = false",
        [me]
      );

      return {
        status: 200,
        json: { count: parseInt(result.rows[0].count as string, 10) },
      };
    },
  },
  {
    method: "GET",
    path: "/notifications",
    auth: { strategy: "session" },
    handler: async (ctx) => {
      const me = ctx.auth.userId;
      const params = parseQueryParams(ctx.req);
      const { cursor, limit } = parseCursor(params);

      const queryParams: unknown[] = [me, limit + 1];
      let cursorClause = "";

      if (cursor) {
        cursorClause = "AND n.created_at < $3";
        queryParams.push(cursor);
      }

      const result = await ctx.db.query(
        `SELECT n.*, pr.public_balance AS actor_balance, pr.avatar_key AS actor_avatar
         FROM notifications n
         JOIN profiles pr ON n.actor_nullifier = pr.nullifier
         WHERE n.recipient_nullifier = $1 ${cursorClause}
         ORDER BY n.created_at DESC
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
