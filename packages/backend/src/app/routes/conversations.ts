import type { RouteConfig } from "../../server/router.js";
import type { QueryFn } from "../../db/pool.js";
import { parseQueryParams, parseCursor, cursorResponse } from "../helpers.js";

export function createConversationRoutes(config: {
  messageMaxLength: number;
}): RouteConfig[] {
  return [
  // Create a conversation (1:1 DM or group)
  {
    method: "POST",
    path: "/conversations",
    auth: { strategy: "session" },
    rateLimit: { windowMs: 60_000, max: 10 },
    handler: async (ctx) => {
      const me = ctx.auth.userId;
      const isGroup = ctx.body.is_group === true;

      if (isGroup) {
        // --- Group conversation ---
        const participants = ctx.body.participants as string[] | undefined;
        const name = (ctx.body.name as string | undefined) || null;

        if (
          !Array.isArray(participants) ||
          participants.length < 1 ||
          !participants.every((p) => typeof p === "string" && p.length > 0)
        ) {
          return {
            status: 400,
            json: { error: "participants must be an array with at least 1 member" },
          };
        }

        const conversation = await ctx.db.transaction(async (query: QueryFn) => {
          const convResult = await query(
            `INSERT INTO conversations (id, is_group, name, created_by)
             VALUES (gen_random_uuid(), true, $1, $2)
             RETURNING *`,
            [name, me]
          );
          const conv = convResult.rows[0] as Record<string, unknown>;

          // Add self as member
          await query(
            `INSERT INTO conversation_members (conversation_id, nullifier, last_read_at)
             VALUES ($1, $2, NOW())`,
            [conv.id, me]
          );

          // Add each participant
          for (const participant of participants) {
            await query(
              `INSERT INTO conversation_members (conversation_id, nullifier)
               VALUES ($1, $2)`,
              [conv.id, participant]
            );
          }

          return conv;
        });

        // Fire-and-forget: notify each participant about group invite
        for (const participant of participants) {
          ctx.db
            .query(
              `INSERT INTO notifications (id, recipient_nullifier, type, actor_nullifier, conversation_id)
               VALUES (gen_random_uuid(), $1, 'group_invite', $2, $3)`,
              [participant, me, conversation.id]
            )
            .catch(() => {});
        }

        return { status: 201, json: conversation };
      }

      // --- 1:1 DM ---
      const them = ctx.body.participant as string | undefined;
      if (!them || typeof them !== "string") {
        return { status: 400, json: { error: "participant is required" } };
      }

      if (them === me) {
        return { status: 400, json: { error: "Cannot create a conversation with yourself" } };
      }

      // Check blocks in either direction
      const blockCheck = await ctx.db.query(
        `SELECT 1 FROM blocks
         WHERE (blocker_nullifier = $1 AND blocked_nullifier = $2)
            OR (blocker_nullifier = $2 AND blocked_nullifier = $1)`,
        [me, them]
      );

      if (blockCheck.rows.length > 0) {
        return { status: 403, json: { error: "Blocked" } };
      }

      // Check for existing 1:1 conversation between the two users
      const existing = await ctx.db.query(
        `SELECT cm1.conversation_id FROM conversation_members cm1
         JOIN conversation_members cm2 ON cm1.conversation_id = cm2.conversation_id
         JOIN conversations c ON c.id = cm1.conversation_id
         WHERE cm1.nullifier = $1 AND cm2.nullifier = $2 AND c.is_group = false`,
        [me, them]
      );

      if (existing.rows.length > 0) {
        const convId = (existing.rows[0] as { conversation_id: string }).conversation_id;
        const convResult = await ctx.db.query(
          "SELECT * FROM conversations WHERE id = $1",
          [convId]
        );
        return { status: 200, json: convResult.rows[0] };
      }

      // Create new 1:1 conversation
      const conversation = await ctx.db.transaction(async (query: QueryFn) => {
        const convResult = await query(
          `INSERT INTO conversations (id, is_group, created_by)
           VALUES (gen_random_uuid(), false, $1)
           RETURNING *`,
          [me]
        );
        const conv = convResult.rows[0] as Record<string, unknown>;

        await query(
          `INSERT INTO conversation_members (conversation_id, nullifier, last_read_at)
           VALUES ($1, $2, NOW())`,
          [conv.id, me]
        );
        await query(
          `INSERT INTO conversation_members (conversation_id, nullifier)
           VALUES ($1, $2)`,
          [conv.id, them]
        );

        return conv;
      });

      return { status: 201, json: conversation };
    },
  },

  // List conversations (inbox)
  {
    method: "GET",
    path: "/conversations",
    auth: { strategy: "session" },
    handler: async (ctx) => {
      const me = ctx.auth.userId;
      const params = parseQueryParams(ctx.req);
      const { cursor, limit } = parseCursor(params);

      const queryParams: unknown[] = [me, limit + 1];
      let cursorClause = "";

      if (cursor) {
        cursorClause = "AND COALESCE(c.last_message_at, c.created_at) < $3";
        queryParams.push(cursor);
      }

      const result = await ctx.db.query(
        `SELECT c.id, c.is_group, c.name, c.last_message_at, c.created_at,
           (SELECT body FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) AS last_message_body,
           (SELECT sender_nullifier FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) AS last_message_sender,
           (SELECT COUNT(*) FROM messages
            WHERE conversation_id = c.id
              AND created_at > cm.last_read_at
              AND sender_nullifier != $1
           )::int AS unread_count
         FROM conversation_members cm
         JOIN conversations c ON c.id = cm.conversation_id
         WHERE cm.nullifier = $1
           ${cursorClause}
         ORDER BY COALESCE(c.last_message_at, c.created_at) DESC NULLS LAST
         LIMIT $2`,
        queryParams
      );

      const rows = result.rows as Array<Record<string, unknown>>;
      const paged = cursorResponse(rows, limit, (row) =>
        String(row.last_message_at ?? row.created_at)
      );

      // Gather conversation IDs for member lookup
      const conversationIds = paged.data.map((r) => r.id);

      let membersByConversation: Record<string, unknown[]> = {};
      if (conversationIds.length > 0) {
        const membersResult = await ctx.db.query(
          `SELECT cm2.conversation_id, cm2.nullifier, pr.public_balance, pr.avatar_key
           FROM conversation_members cm2
           JOIN profiles pr ON cm2.nullifier = pr.nullifier
           WHERE cm2.conversation_id = ANY($1) AND cm2.nullifier != $2`,
          [conversationIds, me]
        );

        for (const row of membersResult.rows as Array<Record<string, unknown>>) {
          const cid = row.conversation_id as string;
          if (!membersByConversation[cid]) membersByConversation[cid] = [];
          membersByConversation[cid].push({
            nullifier: row.nullifier,
            public_balance: row.public_balance,
            avatar_key: row.avatar_key,
          });
        }
      }

      const data = paged.data.map((conv) => ({
        ...conv,
        members: membersByConversation[conv.id as string] || [],
      }));

      return {
        status: 200,
        json: { data, next_cursor: paged.next_cursor },
      };
    },
  },

  // Count unread direct-message conversations (not unread message total)
  {
    method: "GET",
    path: "/conversations/unread-count",
    auth: { strategy: "session" },
    handler: async (ctx) => {
      const me = ctx.auth.userId;

      const result = await ctx.db.query<{ count: number }>(
        `SELECT COUNT(*)::int AS count
         FROM conversation_members cm
         JOIN conversations c ON c.id = cm.conversation_id
         WHERE cm.nullifier = $1
           AND c.is_group = false
           AND EXISTS (
             SELECT 1
             FROM messages m
             WHERE m.conversation_id = cm.conversation_id
               AND m.created_at > cm.last_read_at
               AND m.sender_nullifier != $1
           )`,
        [me]
      );

      return { status: 200, json: result.rows[0] };
    },
  },

  // Get messages for a conversation
  {
    method: "GET",
    path: "/conversations/:id/messages",
    auth: { strategy: "session" },
    handler: async (ctx) => {
      const me = ctx.auth.userId;
      const conversationId = ctx.params.id;

      // Verify membership
      const membership = await ctx.db.query(
        "SELECT 1 FROM conversation_members WHERE conversation_id = $1 AND nullifier = $2",
        [conversationId, me]
      );
      if (membership.rows.length === 0) {
        return { status: 403, json: { error: "Not a member of this conversation" } };
      }

      const params = parseQueryParams(ctx.req);
      const { cursor, limit } = parseCursor(params);

      const queryParams: unknown[] = [conversationId, limit + 1];
      let cursorClause = "";

      if (cursor) {
        cursorClause = "AND m.created_at < $3";
        queryParams.push(cursor);
      }

      const result = await ctx.db.query(
        `SELECT m.*, pr.public_balance, pr.avatar_key
         FROM messages m
         JOIN profiles pr ON m.sender_nullifier = pr.nullifier
         WHERE m.conversation_id = $1
           ${cursorClause}
         ORDER BY m.created_at DESC
         LIMIT $2`,
        queryParams
      );

      const rows = result.rows as Array<Record<string, unknown>>;
      return {
        status: 200,
        json: cursorResponse(rows, limit, (row) => String(row.created_at)),
      };
    },
  },

  // Send a message in a conversation
  {
    method: "POST",
    path: "/conversations/:id/messages",
    auth: { strategy: "session" },
    rateLimit: { windowMs: 60_000, max: 30 },
    handler: async (ctx) => {
      const me = ctx.auth.userId;
      const conversationId = ctx.params.id;
      const body = (ctx.body.body as string | undefined) || null;
      const attachmentKey = (ctx.body.attachment_key as string | undefined) || null;

      if (body && body.length > config.messageMaxLength) {
        return {
          status: 400,
          json: { error: `message body must be at most ${config.messageMaxLength} characters` },
        };
      }

      if (!body?.trim() && !attachmentKey) {
        return { status: 400, json: { error: "body or attachment_key is required" } };
      }

      // Verify membership
      const membership = await ctx.db.query(
        "SELECT 1 FROM conversation_members WHERE conversation_id = $1 AND nullifier = $2",
        [conversationId, me]
      );
      if (membership.rows.length === 0) {
        return { status: 403, json: { error: "Not a member of this conversation" } };
      }

      const message = await ctx.db.transaction(async (query: QueryFn) => {
        const msgResult = await query(
          `INSERT INTO messages (id, conversation_id, sender_nullifier, body, attachment_key)
           VALUES (gen_random_uuid(), $1, $2, $3, $4)
           RETURNING *`,
          [conversationId, me, body?.trim() || null, attachmentKey]
        );

        await query(
          "UPDATE conversations SET last_message_at = NOW() WHERE id = $1",
          [conversationId]
        );

        return msgResult.rows[0];
      });

      // Fire-and-forget: notify other members
      ctx.db
        .query(
          "SELECT nullifier FROM conversation_members WHERE conversation_id = $1 AND nullifier != $2",
          [conversationId, me]
        )
        .then((r) => {
          for (const row of r.rows as Array<{ nullifier: string }>) {
            ctx.db
              .query(
                `INSERT INTO notifications (id, recipient_nullifier, type, actor_nullifier, conversation_id)
                 VALUES (gen_random_uuid(), $1, 'dm', $2, $3)`,
                [row.nullifier, me, conversationId]
              )
              .catch(() => {});
          }
        })
        .catch(() => {});

      // Real-time notification
      ctx.changes.notify("conversations", conversationId);

      return { status: 201, json: message };
    },
  },

  // Mark conversation as read
  {
    method: "POST",
    path: "/conversations/:id/read",
    auth: { strategy: "session" },
    rateLimit: { windowMs: 60_000, max: 60 },
    handler: async (ctx) => {
      const me = ctx.auth.userId;
      const conversationId = ctx.params.id;

      await ctx.db.query(
        "UPDATE conversation_members SET last_read_at = NOW() WHERE conversation_id = $1 AND nullifier = $2",
        [conversationId, me]
      );

      return { status: 200, json: { ok: true } };
    },
  },
  ];
}
