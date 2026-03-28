import type { RouteConfig } from "../../server/router.js";
import type { QueryFn } from "../../db/pool.js";
import { parseQueryParams, parseCursor, cursorResponse } from "../../app/helpers.js";

export const followRoutes: RouteConfig[] = [
  {
    method: "POST",
    path: "/profiles/:nullifier/follow",
    auth: { strategy: "session" },
    rateLimit: { windowMs: 60_000, max: 30 },
    handler: async (ctx) => {
      const targetNullifier = ctx.params.nullifier;
      const myNullifier = ctx.auth.userId;

      if (myNullifier === targetNullifier) {
        return { status: 400, json: { error: "Cannot follow yourself" } };
      }

      let txResult: { following: boolean; follower_count: unknown };
      try {
        txResult = await ctx.db.transaction(async (query: QueryFn) => {
        // Check blocks in either direction
        const blockCheck = await query(
          `SELECT 1 FROM blocks
           WHERE (blocker_nullifier = $1 AND blocked_nullifier = $2)
              OR (blocker_nullifier = $2 AND blocked_nullifier = $1)`,
          [myNullifier, targetNullifier]
        );

        if (blockCheck.rows.length > 0) {
          throw Object.assign(new Error("Blocked"), { statusCode: 403 });
        }

        const existing = await query(
          "SELECT 1 FROM follows WHERE follower_nullifier = $1 AND following_nullifier = $2",
          [myNullifier, targetNullifier]
        );

        let toggled: boolean;

        if (existing.rows.length > 0) {
          await query(
            "DELETE FROM follows WHERE follower_nullifier = $1 AND following_nullifier = $2",
            [myNullifier, targetNullifier]
          );
          await query(
            "UPDATE profiles SET follower_count = follower_count - 1 WHERE nullifier = $1",
            [targetNullifier]
          );
          await query(
            "UPDATE profiles SET following_count = following_count - 1 WHERE nullifier = $1",
            [myNullifier]
          );
          toggled = false;
        } else {
          await query(
            "INSERT INTO follows (follower_nullifier, following_nullifier) VALUES ($1, $2)",
            [myNullifier, targetNullifier]
          );
          await query(
            "UPDATE profiles SET follower_count = follower_count + 1 WHERE nullifier = $1",
            [targetNullifier]
          );
          await query(
            "UPDATE profiles SET following_count = following_count + 1 WHERE nullifier = $1",
            [myNullifier]
          );
          toggled = true;
        }

        const updated = await query(
          "SELECT follower_count FROM profiles WHERE nullifier = $1",
          [targetNullifier]
        );

        return { following: toggled, follower_count: updated.rows[0].follower_count };
        });
      } catch (err: unknown) {
        if (err && typeof err === "object" && "statusCode" in err && (err as { statusCode: number }).statusCode === 403) {
          return { status: 403, json: { error: "Blocked" } };
        }
        throw err;
      }

      const { following, follower_count } = txResult;

      // Fire-and-forget notification on follow (not unfollow) — outside transaction
      // Skip if a follow notification from this actor already exists
      if (following) {
        ctx.db.query(
          `INSERT INTO notifications (recipient_nullifier, type, actor_nullifier)
           SELECT $1, $2, $3
           WHERE NOT EXISTS (
             SELECT 1 FROM notifications
             WHERE recipient_nullifier = $1 AND type = $2 AND actor_nullifier = $3
           )`,
          [targetNullifier, "follow", myNullifier]
        ).catch(() => {});
      }

      return {
        status: 200,
        json: { following, follower_count },
      };
    },
  },
  {
    method: "GET",
    path: "/profiles/:nullifier/followers",
    auth: "public",
    handler: async (ctx) => {
      const targetNullifier = ctx.params.nullifier;
      const params = parseQueryParams(ctx.req);
      const { cursor, limit } = parseCursor(params);

      const queryParams: unknown[] = [targetNullifier, limit + 1];
      let cursorClause = "";

      if (cursor) {
        cursorClause = "AND f.created_at < $3";
        queryParams.push(cursor);
      }

      const result = await ctx.db.query(
        `SELECT f.follower_nullifier, f.created_at, pr.public_balance, pr.avatar_key
         FROM follows f
         JOIN profiles pr ON f.follower_nullifier = pr.nullifier
         WHERE f.following_nullifier = $1 ${cursorClause}
         ORDER BY f.created_at DESC
         LIMIT $2`,
        queryParams
      );

      return {
        status: 200,
        json: cursorResponse(result.rows, limit, (row: any) => row.created_at),
      };
    },
  },
  {
    method: "GET",
    path: "/profiles/:nullifier/following",
    auth: "public",
    handler: async (ctx) => {
      const targetNullifier = ctx.params.nullifier;
      const params = parseQueryParams(ctx.req);
      const { cursor, limit } = parseCursor(params);

      const queryParams: unknown[] = [targetNullifier, limit + 1];
      let cursorClause = "";

      if (cursor) {
        cursorClause = "AND f.created_at < $3";
        queryParams.push(cursor);
      }

      const result = await ctx.db.query(
        `SELECT f.following_nullifier, f.created_at, pr.public_balance, pr.avatar_key
         FROM follows f
         JOIN profiles pr ON f.following_nullifier = pr.nullifier
         WHERE f.follower_nullifier = $1 ${cursorClause}
         ORDER BY f.created_at DESC
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
