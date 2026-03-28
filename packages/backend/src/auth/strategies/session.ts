import type { IncomingMessage } from "node:http";
import type { AuthStrategy, AuthContext } from "../types.js";
import type { DbAdapter } from "../../db/pool.js";

function parseCookies(req: IncomingMessage): Record<string, string> {
  const header = req.headers.cookie;
  if (!header) return {};
  const cookies: Record<string, string> = {};
  for (const pair of header.split(";")) {
    const [name, ...rest] = pair.trim().split("=");
    if (name) cookies[name] = rest.join("=");
  }
  return cookies;
}

export function createSessionStrategy(db: DbAdapter): AuthStrategy {
  return {
    name: "session",

    async authenticate(req): Promise<AuthContext | null> {
      const cookies = parseCookies(req);
      const token = cookies["session"];
      if (!token) return null;

      const result = await db.query<{
        nullifier: string;
        public_balance: string;
        block_number: string;
        block_hash: string;
        expires_at: string;
      }>(
        "SELECT nullifier, public_balance, block_number, block_hash, expires_at FROM sessions WHERE token = $1",
        [token]
      );

      if (result.rows.length === 0) return null;

      const session = result.rows[0];

      // Check expiry
      if (new Date(session.expires_at) < new Date()) {
        // Clean up expired session
        await db.query("DELETE FROM sessions WHERE token = $1", [token]);
        return null;
      }

      return {
        userId: session.nullifier,
        strategy: "session",
        publicBalance: session.public_balance,
        blockNumber: Number(session.block_number),
        blockHash: session.block_hash,
      };
    },
  };
}
