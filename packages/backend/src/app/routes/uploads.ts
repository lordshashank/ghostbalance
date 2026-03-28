import crypto from "node:crypto";
import type { RouteConfig } from "../../server/router.js";
import type { AuthRequirement } from "../../auth/types.js";

interface UploadRoutesConfig {
  auth: AuthRequirement;
  maxSizeBytes?: number;
  allowedTypes?: string[];
}

const DEFAULT_MAX_SIZE = 10 * 1024 * 1024; // 10MB
const DEFAULT_ALLOWED_TYPES = ["image/"];
const DEFAULT_UPLOAD_TTL_SECONDS = 300; // 5 minutes

function isAllowedType(
  contentType: string,
  allowedTypes: string[]
): boolean {
  return allowedTypes.some((prefix) => contentType.startsWith(prefix));
}

export async function cleanupStaleUploadsForUser(
  db: { query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }> },
  storage: { delete: (key: string) => Promise<void> },
  userId: string
) {
  // Remove expired pending uploads
  await db.query(
    `DELETE FROM uploads
     WHERE user_id = $1 AND status = 'pending' AND upload_expires_at < now()`,
    [userId]
  );

  // Retry deleting uploads (storage delete failed previously)
  const deleting = await db.query(
    `SELECT key
     FROM uploads
     WHERE user_id = $1 AND status = 'deleting'
     ORDER BY created_at ASC
     LIMIT 10`,
    [userId]
  );

  for (const row of deleting.rows as Array<{ key: string }>) {
    try {
      await storage.delete(row.key);
      await db.query("DELETE FROM uploads WHERE key = $1 AND user_id = $2", [
        row.key,
        userId,
      ]);
    } catch {
      // Keep status=deleting for next retry attempt.
    }
  }
}

export function createUploadRoutes(config: UploadRoutesConfig): RouteConfig[] {
  const { auth, allowedTypes = DEFAULT_ALLOWED_TYPES } = config;
  const maxSizeBytes = config.maxSizeBytes ?? DEFAULT_MAX_SIZE;

  return [
    // List user's uploads
    {
      method: "GET",
      path: "/uploads",
      auth,
      handler: async (ctx) => {
        const result = await ctx.db.query(
          `SELECT key, filename, content_type, created_at
           FROM uploads WHERE user_id = $1 AND status = 'completed'
           ORDER BY created_at DESC`,
          [ctx.auth.userId]
        );
        return { status: 200, json: result.rows };
      },
    },

    // Request a presigned upload URL
    {
      method: "POST",
      path: "/uploads",
      auth,
      rateLimit: { windowMs: 60_000, max: 10 },
      handler: async (ctx) => {
        const { contentType, filename, fileSize } = ctx.body as {
          contentType?: string;
          filename?: string;
          fileSize?: number;
        };

        if (!contentType || !filename || typeof fileSize !== "number") {
          return {
            status: 400,
            json: {
              error: "Missing required fields: contentType, filename, fileSize",
            },
          };
        }

        if (!isAllowedType(contentType, allowedTypes)) {
          return {
            status: 400,
            json: {
              error: `Content type not allowed. Must start with: ${allowedTypes.join(", ")}`,
            },
          };
        }

        if (!Number.isFinite(fileSize) || fileSize <= 0) {
          return { status: 400, json: { error: "Invalid fileSize" } };
        }

        if (fileSize > maxSizeBytes) {
          return {
            status: 413,
            json: { error: `File too large. Max size is ${maxSizeBytes} bytes` },
          };
        }

        const key = crypto.randomUUID();

        const uploadUrl = await ctx.storage.getSignedUploadUrl(
          key,
          contentType,
          fileSize
        );

        await ctx.db.query(
          `INSERT INTO uploads (
             key, user_id, filename, content_type, status, upload_expires_at
           )
           VALUES ($1, $2, $3, $4, 'pending', now() + ($5 || ' seconds')::interval)`,
          [key, ctx.auth.userId, filename, contentType, DEFAULT_UPLOAD_TTL_SECONDS]
        );

        return { status: 200, json: { key, uploadUrl } };
      },
    },

    // Complete upload after client PUT succeeds
    {
      method: "POST",
      path: "/uploads/:key/complete",
      auth,
      handler: async (ctx) => {
        const key = ctx.params.key;

        const current = await ctx.db.query(
          `SELECT status, upload_expires_at
           FROM uploads
           WHERE key = $1 AND user_id = $2`,
          [key, ctx.auth.userId]
        );

        if (current.rows.length === 0) {
          return { status: 404, json: { error: "Upload not found" } };
        }

        const row = current.rows[0] as {
          status: string;
          upload_expires_at: string;
        };

        if (row.status === "completed") {
          return { status: 200, json: { ok: true, alreadyCompleted: true } };
        }

        if (row.status !== "pending") {
          return { status: 409, json: { error: `Cannot complete upload with status '${row.status}'` } };
        }

        if (new Date(row.upload_expires_at).getTime() < Date.now()) {
          return {
            status: 409,
            json: { error: "Upload expired. Request a new upload URL." },
          };
        }

        const exists = await ctx.storage.exists(key);
        if (!exists) {
          return {
            status: 400,
            json: { error: "Uploaded object not found in storage" },
          };
        }

        await ctx.db.query(
          `UPDATE uploads
           SET status = 'completed', completed_at = now()
           WHERE key = $1 AND user_id = $2`,
          [key, ctx.auth.userId]
        );

        return { status: 200, json: { ok: true } };
      },
    },

    // Get a presigned download URL (public — anyone can view uploaded images)
    {
      method: "GET",
      path: "/uploads/:key",
      auth: "public",
      handler: async (ctx) => {
        const key = ctx.params.key;

        const result = await ctx.db.query(
          `SELECT key
           FROM uploads
           WHERE key = $1 AND status = 'completed'`,
          [key]
        );
        if (result.rows.length === 0) {
          return { status: 404, json: { error: "Upload not found" } };
        }

        const url = await ctx.storage.getSignedUrl(key);
        return { status: 200, json: { url } };
      },
    },

    // Delete an upload (owner only)
    {
      method: "DELETE",
      path: "/uploads/:key",
      auth,
      handler: async (ctx) => {
        const key = ctx.params.key;

        const markDeleting = await ctx.db.query(
          `UPDATE uploads
           SET status = 'deleting'
           WHERE key = $1 AND user_id = $2 AND status <> 'deleting'
           RETURNING key`,
          [key, ctx.auth.userId]
        );

        if (markDeleting.rows.length === 0) {
          const existingDeleting = await ctx.db.query(
            "SELECT key FROM uploads WHERE key = $1 AND user_id = $2 AND status = 'deleting'",
            [key, ctx.auth.userId]
          );
          if (existingDeleting.rows.length > 0) {
            return { status: 200, json: { ok: true, deleting: true } };
          }
          return {
            status: 404,
            json: { error: "Upload not found or not owned by you" },
          };
        }

        try {
          await ctx.storage.delete(key);
          await ctx.db.query("DELETE FROM uploads WHERE key = $1 AND user_id = $2", [
            key,
            ctx.auth.userId,
          ]);
        } catch {
          return { status: 200, json: { ok: true, deleting: true } };
        }

        return { status: 200, json: { ok: true } };
      },
    },
  ];
}
