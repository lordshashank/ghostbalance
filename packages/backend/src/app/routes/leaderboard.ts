import type { RouteConfig } from "../../server/router.js";
import { parseQueryParams, parseCursor, cursorResponse } from "../helpers.js";

export const leaderboardRoutes: RouteConfig[] = [
  {
    method: "GET",
    path: "/leaderboard/rank",
    auth: { strategy: "session" },
    handler: async (ctx) => {
      const balance = ctx.auth.publicBalance;

      const rankResult = await ctx.db.query(
        "SELECT COUNT(*) + 1 as rank FROM profiles WHERE public_balance > $1",
        [balance]
      );

      const totalResult = await ctx.db.query(
        "SELECT COUNT(*) as total FROM profiles"
      );

      return {
        status: 200,
        json: {
          rank: Number(rankResult.rows[0].rank),
          total_users: Number(totalResult.rows[0].total),
        },
      };
    },
  },
  {
    method: "GET",
    path: "/leaderboard",
    auth: "public",
    handler: async (ctx) => {
      const params = parseQueryParams(ctx.req);
      const sort = params.get("sort") || "balance";
      const start = params.get("start");
      const end = params.get("end");
      const { cursor, limit } = parseCursor(params);

      const sortColumns: Record<string, string> = {
        balance: "public_balance",
        posts: "post_count",
        followers: "follower_count",
      };
      const sortCol = sortColumns[sort] || "public_balance";

      const queryParams: unknown[] = [];
      const conditions: string[] = [];

      if (cursor) {
        const [cursorValue, cursorNullifier] = cursor.split(":");
        queryParams.push(cursorValue, cursorNullifier);
        conditions.push(`(${sortCol}, nullifier) < ($1, $2)`);
      }

      if (start) {
        queryParams.push(start);
        conditions.push(`updated_at >= $${queryParams.length}`);
      }

      if (end) {
        queryParams.push(end);
        conditions.push(`updated_at <= $${queryParams.length}`);
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

      queryParams.push(limit + 1);
      const limitParam = `$${queryParams.length}`;

      const result = await ctx.db.query(
        `SELECT nullifier, bio, gender, age, avatar_key, banner_key,
                public_balance, block_number, post_count, follower_count, following_count, created_at
         FROM profiles
         ${whereClause}
         ORDER BY ${sortCol} DESC, nullifier DESC
         LIMIT ${limitParam}`,
        queryParams
      );

      return {
        status: 200,
        json: cursorResponse(result.rows, limit, (row: Record<string, unknown>) =>
          `${row[sortCol]}:${row.nullifier}`
        ),
      };
    },
  },
];
