import type { RouteConfig } from "../../server/router.js";

export const pollRoutes: RouteConfig[] = [
  {
    method: "POST",
    path: "/polls/:id/vote",
    auth: { strategy: "session" },
    rateLimit: { windowMs: 60_000, max: 10 },
    handler: async (ctx) => {
      const pollId = ctx.params.id;
      const nullifier = ctx.auth.userId;
      const optionId = ctx.body.option_id as string | undefined;

      if (!optionId) {
        return { status: 400, json: { error: "option_id is required" } };
      }

      // Check poll exists and not expired
      const pollResult = await ctx.db.query(
        "SELECT expires_at FROM polls WHERE id = $1",
        [pollId]
      );

      if (pollResult.rows.length === 0) {
        return { status: 404, json: { error: "Poll not found" } };
      }

      const expiresAt = new Date(pollResult.rows[0].expires_at as string);
      if (new Date() > expiresAt) {
        return { status: 400, json: { error: "Poll expired" } };
      }

      // Check option belongs to this poll
      const optionCheck = await ctx.db.query(
        "SELECT 1 FROM poll_options WHERE id = $1 AND poll_id = $2",
        [optionId, pollId]
      );

      if (optionCheck.rows.length === 0) {
        return { status: 400, json: { error: "Invalid option for this poll" } };
      }

      // Insert vote; conflict means already voted
      try {
        await ctx.db.query(
          `INSERT INTO poll_votes (poll_id, option_id, voter_nullifier, voter_balance)
           VALUES ($1, $2, $3, $4)`,
          [pollId, optionId, nullifier, ctx.auth.publicBalance]
        );
      } catch (err: any) {
        // Unique constraint violation (already voted)
        if (err.code === "23505") {
          return { status: 409, json: { error: "Already voted" } };
        }
        throw err;
      }

      return { status: 200, json: { ok: true } };
    },
  },
  {
    method: "GET",
    path: "/polls/:id",
    auth: "public",
    handler: async (ctx) => {
      const pollId = ctx.params.id;

      const result = await ctx.db.query(
        `SELECT p.*,
                json_agg(
                  json_build_object(
                    'id', po.id,
                    'label', po.label,
                    'position', po.position,
                    'vote_count', COALESCE(v.vote_count, 0),
                    'total_balance', COALESCE(v.total_balance, 0)
                  )
                ) AS options
         FROM polls p
         JOIN poll_options po ON po.poll_id = p.id
         LEFT JOIN (
           SELECT option_id,
                  COUNT(*) AS vote_count,
                  SUM(voter_balance) AS total_balance
           FROM poll_votes
           WHERE poll_id = $1
           GROUP BY option_id
         ) v ON v.option_id = po.id
         WHERE p.id = $1
         GROUP BY p.id`,
        [pollId]
      );

      if (result.rows.length === 0) {
        return { status: 404, json: { error: "Poll not found" } };
      }

      const poll = result.rows[0];
      const isExpired = new Date() > new Date(poll.expires_at as string);

      return {
        status: 200,
        json: { ...poll, is_expired: isExpired },
      };
    },
  },
];
