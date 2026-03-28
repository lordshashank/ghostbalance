import { randomUUID } from "crypto";
import type { RouteConfig } from "../../server/router.js";
import type { VerificationConfig } from "../../auth/strategies/zkproof/verify.js";
import { verifyProofBundle } from "../../auth/strategies/zkproof/verify.js";
import { extractProofBundle } from "../../auth/strategies/zkproof/index.js";

export const authMeRoute: RouteConfig = {
  method: "GET",
  path: "/auth/me",
  auth: { strategy: "session" },
  handler: async (ctx) => {
    const result = await ctx.db.query(
      `SELECT p.nullifier, p.bio, p.gender, p.age, p.avatar_key, p.banner_key,
              p.public_balance, p.initial_balance, p.block_number, p.block_hash,
              p.post_count, p.follower_count, p.following_count, p.created_at
       FROM profiles p
       WHERE p.nullifier = $1`,
      [ctx.auth.userId]
    );

    if (result.rows.length === 0) {
      return { status: 404, json: { error: "Profile not found" } };
    }

    return { status: 200, json: result.rows[0] };
  },
};

export const authLogoutRoute: RouteConfig = {
  method: "POST",
  path: "/auth/logout",
  auth: { strategy: "session" },
  handler: async (ctx) => {
    const cookieHeader = ctx.req.headers.cookie || "";
    const cookies = cookieHeader.split(";").map((c: string) => c.trim());
    const sessionCookie = cookies.find((c: string) => c.startsWith("session="));
    const token = sessionCookie ? sessionCookie.split("=")[1] : null;

    if (token) {
      await ctx.db.query("DELETE FROM sessions WHERE token = $1", [token]);
    }

    return {
      status: 200,
      json: { ok: true },
      headers: {
        "Set-Cookie": "session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0",
      },
    };
  },
};

export function createAuthVerifyRoute(
  config: VerificationConfig,
  sessionDurationSeconds: number
): RouteConfig {
  return {
    method: "POST",
    path: "/auth/verify",
    auth: "public",
    rateLimit: { windowMs: 60_000, max: 10 },
    validate: (body: unknown): boolean => {
      if (!body || typeof body !== "object") return false;
      return extractProofBundle(body as Record<string, unknown>) !== null;
    },
    handler: async (ctx) => {
      const bundle = extractProofBundle(ctx.body)!;
      const result = await verifyProofBundle(bundle, config, { checkFreshness: false });

      if (!result.valid) {
        return { status: 200, json: result };
      }

      // Check if profile exists for this nullifier
      const profileResult = await ctx.db.query(
        "SELECT 1 FROM profiles WHERE nullifier = $1",
        [result.nullifier]
      );
      const profileExists = profileResult.rows.length > 0;

      // Only create session when profile exists
      if (profileExists) {
        const token = randomUUID();
        const expiresAt = new Date(Date.now() + sessionDurationSeconds * 1000);

        await ctx.db.query(
          `INSERT INTO sessions (token, nullifier, public_balance, block_number, block_hash, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            token,
            result.nullifier,
            result.publicBalance,
            result.blockNumber,
            result.blockHash,
            expiresAt.toISOString(),
          ]
        );

        // Clean up old sessions for this nullifier
        await ctx.db.query(
          "DELETE FROM sessions WHERE nullifier = $1 AND expires_at < NOW()",
          [result.nullifier]
        );

        // Update profile balance if it changed
        await ctx.db.query(
          `UPDATE profiles
           SET public_balance = $1, block_number = $2, block_hash = $3
           WHERE nullifier = $4 AND public_balance IS DISTINCT FROM $1`,
          [result.publicBalance, result.blockNumber, result.blockHash, result.nullifier]
        );

        // Record balance history
        await ctx.db.query(
          `INSERT INTO balance_history (nullifier, public_balance, block_number)
           VALUES ($1, $2, $3)`,
          [result.nullifier, result.publicBalance, result.blockNumber]
        );

        const cookieValue = `session=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${sessionDurationSeconds}`;

        return {
          status: 200,
          json: {
            ...result,
            profileExists,
            expiresAt: expiresAt.toISOString(),
          },
          headers: {
            "Set-Cookie": cookieValue,
          },
        };
      }

      return {
        status: 200,
        json: {
          ...result,
          profileExists,
        },
      };
    },
  };
}
