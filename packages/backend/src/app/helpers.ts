import type { IncomingMessage } from "node:http";
import type { DbAdapter } from "../db/pool.js";

export function parseQueryParams(req: IncomingMessage): URLSearchParams {
  const url = new URL(req.url ?? "/", "http://localhost");
  return url.searchParams;
}

export function parseCursor(params: URLSearchParams, defaultLimit = 20, maxLimit = 50) {
  const cursor = params.get("cursor") || null;
  let limit = parseInt(params.get("limit") || String(defaultLimit), 10);
  if (isNaN(limit) || limit < 1) limit = defaultLimit;
  if (limit > maxLimit) limit = maxLimit;
  return { cursor, limit };
}

export function cursorResponse<T>(
  rows: T[],
  limit: number,
  getCursor: (row: T) => string
): { data: T[]; next_cursor: string | null } {
  if (rows.length > limit) {
    const data = rows.slice(0, limit);
    return { data, next_cursor: getCursor(data[data.length - 1]) };
  }
  return { data: rows, next_cursor: null };
}

export async function attachAttachmentsToRows(
  db: DbAdapter,
  rows: Array<Record<string, unknown>>
): Promise<void> {
  const postIds = rows.map((r) => r.id as string).filter(Boolean);
  if (postIds.length === 0) return;

  const placeholders = postIds.map((_, i) => `$${i + 1}`).join(",");
  const result = await db.query(
    `SELECT id, post_id, upload_key, position FROM post_attachments
     WHERE post_id IN (${placeholders})
     ORDER BY position ASC`,
    postIds
  );

  const byPost = new Map<string, Array<Record<string, unknown>>>();
  for (const row of result.rows) {
    const pid = row.post_id as string;
    if (!byPost.has(pid)) byPost.set(pid, []);
    byPost.get(pid)!.push(row);
  }

  for (const row of rows) {
    row.attachments = byPost.get(row.id as string) ?? [];
  }
}

export function blockFilterSql(
  nullifier: string,
  startParamIndex: number
): { clause: string; params: string[] } {
  const i = startParamIndex;
  return {
    clause: `AND p.author_nullifier NOT IN (
      SELECT blocked_nullifier FROM blocks WHERE blocker_nullifier = $${i}
      UNION
      SELECT blocker_nullifier FROM blocks WHERE blocked_nullifier = $${i}
    )`,
    params: [nullifier],
  };
}
