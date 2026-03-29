import { randomUUID } from "crypto";
import type { RouteConfig } from "../../server/router.js";
import { parseQueryParams, parseCursor, cursorResponse, buildCursorClause } from "../helpers.js";

const VALID_GENDERS = ["male", "female", "other"] as const;

export function createProfileRoutes(config: {
  sessionDurationSeconds: number;
  bioMaxLength: number;
}): RouteConfig[] {
  return [
    // Create profile
    {
      method: "POST",
      path: "/profiles",
      auth: { strategy: "zkproof" },
      rateLimit: { windowMs: 60_000, max: 5 },
      handler: async (ctx) => {
        const { bio, gender, age } = ctx.body as {
          bio?: string;
          gender?: string;
          age?: number;
        };

        if (gender !== undefined && !VALID_GENDERS.includes(gender as typeof VALID_GENDERS[number])) {
          return {
            status: 400,
            json: { error: `gender must be one of: ${VALID_GENDERS.join(", ")}` },
          };
        }

        if (bio !== undefined && bio.length > config.bioMaxLength) {
          return {
            status: 400,
            json: { error: `bio must be at most ${config.bioMaxLength} characters` },
          };
        }

        if (age !== undefined && age !== null) {
          if (!Number.isInteger(age) || age < 13 || age > 150) {
            return { status: 400, json: { error: "age must be an integer between 13 and 150" } };
          }
        }

        const result = await ctx.db.query(
          `INSERT INTO profiles (nullifier, public_balance, initial_balance, block_number, block_hash, bio, gender, age)
           VALUES ($1, $2, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (nullifier) DO NOTHING
           RETURNING *`,
          [
            ctx.auth.userId,
            ctx.auth.publicBalance,
            ctx.auth.blockNumber,
            ctx.auth.blockHash,
            bio?.trim() || null,
            gender || null,
            age ?? null,
          ]
        );

        if (result.rowCount === 0) {
          return { status: 409, json: { error: "Profile already exists for this nullifier" } };
        }

        // Record initial balance in history
        await ctx.db.query(
          `INSERT INTO balance_history (nullifier, public_balance, block_number)
           VALUES ($1, $2, $3)`,
          [ctx.auth.userId, ctx.auth.publicBalance, ctx.auth.blockNumber]
        );

        // Create session after successful profile creation
        const token = randomUUID();
        const expiresAt = new Date(Date.now() + config.sessionDurationSeconds * 1000);

        await ctx.db.query(
          `INSERT INTO sessions (token, nullifier, public_balance, block_number, block_hash, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            token,
            ctx.auth.userId,
            ctx.auth.publicBalance,
            ctx.auth.blockNumber,
            ctx.auth.blockHash,
            expiresAt.toISOString(),
          ]
        );

        const cookieValue = `session=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${config.sessionDurationSeconds}`;

        return {
          status: 201,
          json: result.rows[0],
          headers: {
            "Set-Cookie": cookieValue,
          },
        };
      },
    },

    // Get suggested profiles (must be before :nullifier route)
    // TODO: improve suggestion algo — factor in shared follows, recent activity, randomness
    {
      method: "GET",
      path: "/profiles/suggested",
      auth: { strategy: "session" },
      handler: async (ctx) => {
        const params = parseQueryParams(ctx.req);
        const { limit } = parseCursor(params, 5, 20);
        const result = await ctx.db.query(
          `SELECT p.nullifier, p.bio, p.avatar_key, p.public_balance, p.follower_count
           FROM profiles p
           WHERE p.nullifier != $1
             AND p.nullifier NOT IN (SELECT following_nullifier FROM follows WHERE follower_nullifier = $1)
             AND p.nullifier NOT IN (
               SELECT blocked_nullifier FROM blocks WHERE blocker_nullifier = $1
               UNION
               SELECT blocker_nullifier FROM blocks WHERE blocked_nullifier = $1
             )
           ORDER BY p.public_balance DESC
           LIMIT $2`,
          [ctx.auth.userId, limit]
        );

        return { status: 200, json: { data: result.rows } };
      },
    },

    // Get profile by nullifier
    {
      method: "GET",
      path: "/profiles/:nullifier",
      auth: { strategy: "session", optional: true },
      handler: async (ctx) => {
        const me = ctx.auth?.userId || null;
        const targetNullifier = ctx.params.nullifier;

        const queryParams: unknown[] = [targetNullifier];
        let viewerJoin = "";
        let viewerSelect = "";

        if (me) {
          queryParams.push(me);
          viewerJoin = `LEFT JOIN follows vf ON vf.following_nullifier = p.nullifier AND vf.follower_nullifier = $2`;
          viewerSelect = ", (vf.follower_nullifier IS NOT NULL) AS viewer_following";
        }

        // NOTE: p.* exposes all profile columns in the API response. When adding new columns
        // to the profiles table, verify they should be public. If not, switch to explicit column names.
        const result = await ctx.db.query(
          `SELECT p.*${viewerSelect}
           FROM profiles p
           ${viewerJoin}
           WHERE p.nullifier = $1`,
          queryParams
        );

        if (result.rows.length === 0) {
          return { status: 404, json: { error: "Profile not found" } };
        }

        return { status: 200, json: result.rows[0] };
      },
    },

    // Get posts liked by a user
    {
      method: "GET",
      path: "/profiles/:nullifier/likes",
      auth: "public",
      handler: async (ctx) => {
        const params = parseQueryParams(ctx.req);
        const { cursor, limit } = parseCursor(params);

        const queryParams: unknown[] = [ctx.params.nullifier];
        const cursorClause = buildCursorClause(cursor, queryParams, "l.created_at");

        const limitIdx = queryParams.length + 1;
        queryParams.push(limit + 1);

        const result = await ctx.db.query(
          `SELECT p.*, pr.public_balance, pr.avatar_key, l.created_at as liked_at
           FROM likes l
           JOIN posts p ON l.post_id = p.id
           JOIN profiles pr ON p.author_nullifier = pr.nullifier
           WHERE l.nullifier = $1${cursorClause}
           ORDER BY l.created_at DESC
           LIMIT $${limitIdx}`,
          queryParams
        );

        const { data, next_cursor } = cursorResponse(
          result.rows,
          limit,
          (row: Record<string, unknown>) => row.liked_at as string
        );

        return { status: 200, json: { data, next_cursor } };
      },
    },

    // Update own profile
    {
      method: "PATCH",
      path: "/profiles",
      auth: { strategy: "session" },
      rateLimit: { windowMs: 60_000, max: 30 },
      handler: async (ctx) => {
        const { bio, gender, age, avatar_key, banner_key } = ctx.body as {
          bio?: string;
          gender?: string;
          age?: number | null;
          avatar_key?: string;
          banner_key?: string;
        };

        // Validate bio length if present
        if (bio !== undefined && bio.length > config.bioMaxLength) {
          return {
            status: 400,
            json: { error: `bio must be at most ${config.bioMaxLength} characters` },
          };
        }

        // Validate gender if present
        if (gender !== undefined) {
          if (!VALID_GENDERS.includes(gender as typeof VALID_GENDERS[number])) {
            return {
              status: 400,
              json: { error: `gender must be one of: ${VALID_GENDERS.join(", ")}` },
            };
          }
        }

        // Validate age if present (null is allowed to clear it)
        if (age !== undefined && age !== null) {
          if (!Number.isInteger(age) || age < 13 || age > 150) {
            return { status: 400, json: { error: "age must be an integer between 13 and 150, or null" } };
          }
        }

        // Validate upload keys if present
        for (const [field, key] of [["avatar_key", avatar_key], ["banner_key", banner_key]] as const) {
          if (key !== undefined) {
            const upload = await ctx.db.query(
              "SELECT 1 FROM uploads WHERE key = $1 AND user_id = $2 AND status = 'completed'",
              [key, ctx.auth.userId]
            );
            if (upload.rows.length === 0) {
              return {
                status: 400,
                json: { error: `${field}: upload not found, not completed, or not owned by you` },
              };
            }
          }
        }

        // Build dynamic SET clause
        const updates: string[] = [];
        const params: unknown[] = [];
        let paramIdx = 1;

        if (bio !== undefined) {
          updates.push(`bio = $${paramIdx++}`);
          params.push(bio.trim());
        }
        if (gender !== undefined) {
          updates.push(`gender = $${paramIdx++}`);
          params.push(gender);
        }
        if (age !== undefined) {
          updates.push(`age = $${paramIdx++}`);
          params.push(age);
        }
        if (avatar_key !== undefined) {
          updates.push(`avatar_key = $${paramIdx++}`);
          params.push(avatar_key);
        }
        if (banner_key !== undefined) {
          updates.push(`banner_key = $${paramIdx++}`);
          params.push(banner_key);
        }

        if (updates.length === 0) {
          return { status: 400, json: { error: "No fields to update" } };
        }

        updates.push("updated_at = NOW()");
        params.push(ctx.auth.userId);

        const result = await ctx.db.query(
          `UPDATE profiles
           SET ${updates.join(", ")}
           WHERE nullifier = $${paramIdx}
           RETURNING *`,
          params
        );

        if (result.rows.length === 0) {
          return { status: 404, json: { error: "Profile not found" } };
        }

        return { status: 200, json: result.rows[0] };
      },
    },

    // Reprove balance with a fresh zk proof
    {
      method: "POST",
      path: "/profiles/reprove",
      auth: { strategy: "zkproof" },
      rateLimit: { windowMs: 60_000, max: 5 },
      handler: async (ctx) => {
        const result = await ctx.db.query(
          `UPDATE profiles
           SET public_balance = $1, block_number = $2, block_hash = $3, updated_at = NOW()
           WHERE nullifier = $4
           RETURNING *`,
          [ctx.auth.publicBalance, ctx.auth.blockNumber, ctx.auth.blockHash, ctx.auth.userId]
        );

        if (result.rows.length === 0) {
          return { status: 404, json: { error: "Profile not found" } };
        }

        // Record balance change in history
        await ctx.db.query(
          `INSERT INTO balance_history (nullifier, public_balance, block_number)
           VALUES ($1, $2, $3)`,
          [ctx.auth.userId, ctx.auth.publicBalance, ctx.auth.blockNumber]
        );

        return { status: 200, json: result.rows[0] };
      },
    },

    // Get balance history for a profile
    {
      method: "GET",
      path: "/profiles/:nullifier/balance-history",
      auth: "public",
      handler: async (ctx) => {
        const params = parseQueryParams(ctx.req);
        const { cursor, limit } = parseCursor(params);

        const queryParams: unknown[] = [ctx.params.nullifier];
        const cursorClause = buildCursorClause(cursor, queryParams, "bh.created_at");

        const limitIdx = queryParams.length + 1;
        queryParams.push(limit + 1);

        const result = await ctx.db.query(
          `SELECT bh.id, bh.public_balance, bh.block_number, bh.created_at
           FROM balance_history bh
           WHERE bh.nullifier = $1${cursorClause}
           ORDER BY bh.created_at DESC
           LIMIT $${limitIdx}`,
          queryParams
        );

        const { data, next_cursor } = cursorResponse(
          result.rows,
          limit,
          (row: Record<string, unknown>) => row.created_at as string
        );

        return { status: 200, json: { data, next_cursor } };
      },
    },
  ];
}
