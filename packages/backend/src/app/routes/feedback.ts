import type { RouteConfig } from "../../server/router.js";
import type { AuthRequirement } from "../../auth/types.js";

interface FeedbackConfig {
  userAuth: AuthRequirement;
}

export function createFeedbackRoutes(config: FeedbackConfig): RouteConfig[] {
  const { userAuth } = config;

  // Merge user auth strategies with bearer for dual-auth routes (user OR admin)
  const userStrategies =
    userAuth === "public"
      ? []
      : Array.isArray(userAuth)
        ? userAuth
        : [userAuth];
  const dualAuth: AuthRequirement = [
    ...userStrategies,
    { strategy: "bearer" },
  ];

  return [
    // Create a feedback post
    {
      method: "POST",
      path: "/feedback",
      auth: userAuth,
      handler: async (ctx) => {
        const { type, title, description } = ctx.body as {
          type?: string;
          title?: string;
          description?: string;
        };

        if (!type || !title || !description) {
          return {
            status: 400,
            json: { error: "Missing required fields: type, title, description" },
          };
        }

        const validTypes = ["bug", "feature", "improvement", "question"];
        if (!validTypes.includes(type)) {
          return {
            status: 400,
            json: { error: `Invalid type. Must be one of: ${validTypes.join(", ")}` },
          };
        }

        const result = await ctx.db.query(
          `INSERT INTO feedback_posts (user_id, type, title, description)
           VALUES ($1, $2, $3, $4)
           RETURNING *`,
          [ctx.auth.userId, type, title, description]
        );

        return { status: 201, json: result.rows[0] };
      },
    },

    // List feedback posts with filters and pagination
    {
      method: "GET",
      path: "/feedback",
      auth: userAuth,
      handler: async (ctx) => {
        const url = new URL(ctx.req.url ?? "/", "http://localhost");
        const status = url.searchParams.get("status");
        const type = url.searchParams.get("type");
        const sort = url.searchParams.get("sort") ?? "recent";
        const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10));
        const limit = Math.min(
          Math.max(1, parseInt(url.searchParams.get("limit") ?? "20", 10)),
          100
        );
        const offset = (page - 1) * limit;

        const conditions: string[] = [];
        const params: unknown[] = [];
        let paramIdx = 1;

        if (status) {
          conditions.push(`p.status = $${paramIdx++}`);
          params.push(status);
        }
        if (type) {
          conditions.push(`p.type = $${paramIdx++}`);
          params.push(type);
        }

        const where =
          conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

        const orderBy =
          sort === "votes"
            ? "p.vote_count DESC, p.created_at DESC"
            : "p.created_at DESC";

        // Count total for pagination
        const countResult = await ctx.db.query(
          `SELECT COUNT(*) as total FROM feedback_posts p ${where}`,
          params
        );
        const total = parseInt(String(countResult.rows[0].total), 10);

        // Fetch posts with user_has_voted
        params.push(ctx.auth.userId);
        const userIdParam = paramIdx++;
        params.push(limit);
        const limitParam = paramIdx++;
        params.push(offset);
        const offsetParam = paramIdx++;

        const result = await ctx.db.query(
          `SELECT p.*,
                  CASE WHEN v.user_id IS NOT NULL THEN true ELSE false END AS user_has_voted
           FROM feedback_posts p
           LEFT JOIN feedback_votes v ON v.post_id = p.id AND v.user_id = $${userIdParam}
           ${where}
           ORDER BY ${orderBy}
           LIMIT $${limitParam} OFFSET $${offsetParam}`,
          params
        );

        return {
          status: 200,
          json: {
            posts: result.rows,
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
          },
        };
      },
    },

    // Get a single feedback post with comments
    {
      method: "GET",
      path: "/feedback/:id",
      auth: userAuth,
      handler: async (ctx) => {
        const postId = ctx.params.id;

        const postResult = await ctx.db.query(
          `SELECT p.*,
                  CASE WHEN v.user_id IS NOT NULL THEN true ELSE false END AS user_has_voted
           FROM feedback_posts p
           LEFT JOIN feedback_votes v ON v.post_id = p.id AND v.user_id = $2
           WHERE p.id = $1`,
          [postId, ctx.auth.userId]
        );

        if (postResult.rows.length === 0) {
          return { status: 404, json: { error: "Post not found" } };
        }

        const commentsResult = await ctx.db.query(
          `SELECT * FROM feedback_comments
           WHERE post_id = $1
           ORDER BY created_at ASC`,
          [postId]
        );

        return {
          status: 200,
          json: {
            ...postResult.rows[0],
            comments: commentsResult.rows,
          },
        };
      },
    },

    // Toggle vote on a feedback post
    {
      method: "POST",
      path: "/feedback/:id/vote",
      auth: userAuth,
      handler: async (ctx) => {
        const postId = ctx.params.id;
        const userId = ctx.auth.userId;

        // Check post exists
        const postCheck = await ctx.db.query(
          "SELECT id FROM feedback_posts WHERE id = $1",
          [postId]
        );
        if (postCheck.rows.length === 0) {
          return { status: 404, json: { error: "Post not found" } };
        }

        // Check if already voted
        const existing = await ctx.db.query(
          "SELECT 1 FROM feedback_votes WHERE post_id = $1 AND user_id = $2",
          [postId, userId]
        );

        let voted: boolean;

        if (existing.rows.length > 0) {
          // Remove vote
          await ctx.db.query(
            "DELETE FROM feedback_votes WHERE post_id = $1 AND user_id = $2",
            [postId, userId]
          );
          await ctx.db.query(
            "UPDATE feedback_posts SET vote_count = vote_count - 1 WHERE id = $1",
            [postId]
          );
          voted = false;
        } else {
          // Add vote
          await ctx.db.query(
            "INSERT INTO feedback_votes (post_id, user_id) VALUES ($1, $2)",
            [postId, userId]
          );
          await ctx.db.query(
            "UPDATE feedback_posts SET vote_count = vote_count + 1 WHERE id = $1",
            [postId]
          );
          voted = true;
        }

        const updated = await ctx.db.query(
          "SELECT vote_count FROM feedback_posts WHERE id = $1",
          [postId]
        );

        return {
          status: 200,
          json: { voted, vote_count: updated.rows[0].vote_count },
        };
      },
    },

    // Add a comment to a feedback post
    {
      method: "POST",
      path: "/feedback/:id/comments",
      auth: dualAuth,
      handler: async (ctx) => {
        const postId = ctx.params.id;
        const { body } = ctx.body as { body?: string };

        if (!body) {
          return { status: 400, json: { error: "Missing required field: body" } };
        }

        // Check post exists
        const postCheck = await ctx.db.query(
          "SELECT id FROM feedback_posts WHERE id = $1",
          [postId]
        );
        if (postCheck.rows.length === 0) {
          return { status: 404, json: { error: "Post not found" } };
        }

        const isAdmin = ctx.auth.strategy === "bearer";

        const result = await ctx.db.query(
          `INSERT INTO feedback_comments (post_id, user_id, body, is_admin)
           VALUES ($1, $2, $3, $4)
           RETURNING *`,
          [postId, ctx.auth.userId, body, isAdmin]
        );

        return { status: 201, json: result.rows[0] };
      },
    },

    // Delete a feedback post (owner or admin)
    {
      method: "DELETE",
      path: "/feedback/:id",
      auth: dualAuth,
      handler: async (ctx) => {
        const postId = ctx.params.id;

        // Admin can delete any post
        if (ctx.auth.strategy === "bearer") {
          const result = await ctx.db.query(
            "DELETE FROM feedback_posts WHERE id = $1 RETURNING id",
            [postId]
          );
          if (result.rows.length === 0) {
            return { status: 404, json: { error: "Post not found" } };
          }
          return { status: 200, json: { ok: true } };
        }

        // Users can only delete their own posts
        const result = await ctx.db.query(
          "DELETE FROM feedback_posts WHERE id = $1 AND user_id = $2 RETURNING id",
          [postId, ctx.auth.userId]
        );

        if (result.rows.length === 0) {
          return { status: 404, json: { error: "Post not found or not owned by you" } };
        }

        return { status: 200, json: { ok: true } };
      },
    },

    // Delete a comment (owner or admin)
    {
      method: "DELETE",
      path: "/feedback/:id/comments/:commentId",
      auth: dualAuth,
      handler: async (ctx) => {
        const { commentId } = ctx.params;

        // Admin can delete any comment
        if (ctx.auth.strategy === "bearer") {
          const result = await ctx.db.query(
            "DELETE FROM feedback_comments WHERE id = $1 RETURNING id",
            [commentId]
          );
          if (result.rows.length === 0) {
            return { status: 404, json: { error: "Comment not found" } };
          }
          return { status: 200, json: { ok: true } };
        }

        // Users can only delete their own comments
        const result = await ctx.db.query(
          "DELETE FROM feedback_comments WHERE id = $1 AND user_id = $2 RETURNING id",
          [commentId, ctx.auth.userId]
        );

        if (result.rows.length === 0) {
          return { status: 404, json: { error: "Comment not found or not owned by you" } };
        }

        return { status: 200, json: { ok: true } };
      },
    },

    // Admin: update post status, priority, admin_note, duplicate_of
    {
      method: "PATCH",
      path: "/feedback/:id/status",
      auth: { strategy: "bearer" },
      handler: async (ctx) => {
        const postId = ctx.params.id;
        const { status, priority, admin_note, duplicate_of } = ctx.body as {
          status?: string;
          priority?: string;
          admin_note?: string;
          duplicate_of?: string;
        };

        const updates: string[] = [];
        const params: unknown[] = [];
        let paramIdx = 1;

        if (status !== undefined) {
          const validStatuses = [
            "open", "under_review", "planned", "in_progress",
            "done", "rejected", "duplicate",
          ];
          if (!validStatuses.includes(status)) {
            return {
              status: 400,
              json: { error: `Invalid status. Must be one of: ${validStatuses.join(", ")}` },
            };
          }
          updates.push(`status = $${paramIdx++}`);
          params.push(status);
        }

        if (priority !== undefined) {
          const validPriorities = ["low", "medium", "high", "critical"];
          if (!validPriorities.includes(priority)) {
            return {
              status: 400,
              json: { error: `Invalid priority. Must be one of: ${validPriorities.join(", ")}` },
            };
          }
          updates.push(`priority = $${paramIdx++}`);
          params.push(priority);
        }

        if (admin_note !== undefined) {
          updates.push(`admin_note = $${paramIdx++}`);
          params.push(admin_note);
        }

        if (duplicate_of !== undefined) {
          updates.push(`duplicate_of = $${paramIdx++}`);
          params.push(duplicate_of || null);
        }

        if (updates.length === 0) {
          return {
            status: 400,
            json: { error: "No fields to update" },
          };
        }

        updates.push(`updated_at = NOW()`);
        params.push(postId);

        const result = await ctx.db.query(
          `UPDATE feedback_posts
           SET ${updates.join(", ")}
           WHERE id = $${paramIdx}
           RETURNING *`,
          params
        );

        if (result.rows.length === 0) {
          return { status: 404, json: { error: "Post not found" } };
        }

        return { status: 200, json: result.rows[0] };
      },
    },
  ];
}
