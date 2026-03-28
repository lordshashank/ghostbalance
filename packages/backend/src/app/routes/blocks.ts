import type { RouteConfig } from "../../server/router.js";
import type { QueryFn } from "../../db/pool.js";

export const blockRoutes: RouteConfig[] = [
  {
    method: "POST",
    path: "/profiles/:nullifier/block",
    auth: { strategy: "session" },
    rateLimit: { windowMs: 60_000, max: 10 },
    handler: async (ctx) => {
      const me = ctx.auth.userId;
      const target = ctx.params.nullifier;

      if (me === target) {
        return { status: 400, json: { error: "Cannot block yourself" } };
      }

      const existing = await ctx.db.query(
        "SELECT 1 FROM blocks WHERE blocker_nullifier = $1 AND blocked_nullifier = $2",
        [me, target]
      );

      if (existing.rows.length > 0) {
        await ctx.db.query(
          "DELETE FROM blocks WHERE blocker_nullifier = $1 AND blocked_nullifier = $2",
          [me, target]
        );

        return { status: 200, json: { blocked: false } };
      }

      await ctx.db.transaction(async (query: QueryFn) => {
        await query(
          "INSERT INTO blocks (blocker_nullifier, blocked_nullifier) VALUES ($1, $2)",
          [me, target]
        );

        // Remove follow from me -> target if it exists
        const removedForward = await query(
          "DELETE FROM follows WHERE follower_nullifier = $1 AND following_nullifier = $2 RETURNING *",
          [me, target]
        );

        if (removedForward.rows.length > 0) {
          await query(
            "UPDATE profiles SET following_count = following_count - 1 WHERE nullifier = $1",
            [me]
          );
          await query(
            "UPDATE profiles SET follower_count = follower_count - 1 WHERE nullifier = $1",
            [target]
          );
        }

        // Remove follow from target -> me if it exists
        const removedReverse = await query(
          "DELETE FROM follows WHERE follower_nullifier = $1 AND following_nullifier = $2 RETURNING *",
          [target, me]
        );

        if (removedReverse.rows.length > 0) {
          await query(
            "UPDATE profiles SET following_count = following_count - 1 WHERE nullifier = $1",
            [target]
          );
          await query(
            "UPDATE profiles SET follower_count = follower_count - 1 WHERE nullifier = $1",
            [me]
          );
        }
      });

      return { status: 200, json: { blocked: true } };
    },
  },
];
