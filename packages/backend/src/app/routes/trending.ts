import type { RouteConfig } from "../../server/router.js";
import { parseQueryParams, attachAttachmentsToRows } from "../helpers.js";

export function createTrendingRoutes(config: {
  trendingWindowHours: number;
}): RouteConfig[] {
  const SCORE_LIKE_WEIGHT = 1;
  const SCORE_REPOST_WEIGHT = 2;
  const SCORE_REPLY_WEIGHT = 3;
  const SCORE_VIEW_WEIGHT = 0.2;
  const SCORE_TIME_DECAY = 1.5;
  const SCORE_BALANCE_OFFSET = 2;
  const SCORE_MIN_HOURS = 0.1;

  const scoreSql = `(p.like_count * ${SCORE_LIKE_WEIGHT} + p.repost_count * ${SCORE_REPOST_WEIGHT} + p.reply_count * ${SCORE_REPLY_WEIGHT} + p.view_count * ${SCORE_VIEW_WEIGHT})
           * LN(pr.public_balance / 1e18 + ${SCORE_BALANCE_OFFSET})
           / POWER(GREATEST(EXTRACT(EPOCH FROM NOW() - p.created_at) / 3600, ${SCORE_MIN_HOURS}), ${SCORE_TIME_DECAY})`;

  return [
    {
      method: "GET",
      path: "/trending/posts",
      auth: "public",
      handler: async (ctx) => {
        const params = parseQueryParams(ctx.req);
        const page = Math.max(1, parseInt(params.get("page") || "1", 10) || 1);
        const limit = Math.min(50, Math.max(1, parseInt(params.get("limit") || "20", 10) || 20));
        const offset = (page - 1) * limit;
        const minBalanceRaw = params.get("min_balance");

        const queryParams: unknown[] = [
          String(config.trendingWindowHours),
        ];

        let minBalanceClause = "";
        if (minBalanceRaw !== null) {
          const minBalance = parseFloat(minBalanceRaw);
          if (!isNaN(minBalance)) {
            queryParams.push(minBalance);
            minBalanceClause = `AND pr.public_balance >= $${queryParams.length}`;
          }
        }

        queryParams.push(limit + 1);
        const limitIdx = queryParams.length;
        queryParams.push(offset);
        const offsetIdx = queryParams.length;

        const result = await ctx.db.query(
          `SELECT p.*, pr.public_balance, pr.avatar_key,
             ${scoreSql} AS trending_score
           FROM posts p
           JOIN profiles pr ON p.author_nullifier = pr.nullifier
           WHERE p.created_at > NOW() - ($1 || ' hours')::interval
             AND p.parent_id IS NULL
             ${minBalanceClause}
           ORDER BY trending_score DESC
           LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
          queryParams
        );

        const rows = result.rows as Array<Record<string, unknown>>;
        const has_more = rows.length > limit;
        const data = has_more ? rows.slice(0, limit) : rows;

        await attachAttachmentsToRows(ctx.db, data);
        return {
          status: 200,
          json: { data, page, has_more },
        };
      },
    },
  ];
}
