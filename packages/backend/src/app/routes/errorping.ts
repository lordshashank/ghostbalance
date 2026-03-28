import type { RouteConfig } from "../../server/router.js";

interface ErrorpingConfig {
  botToken: string;
  chatId: string;
}

const SEVERITY_LABELS: Record<number, string> = {
  0: "INFO",
  1: "WARNING",
  2: "ERROR",
  3: "CRITICAL",
};

const SEVERITY_EMOJI: Record<number, string> = {
  0: "\u2139\uFE0F",
  1: "\u26A0\uFE0F",
  2: "\u{1F534}",
  3: "\u{1F525}",
};

const ESCAPABLE = /[_*[\]()~`>#+\-=|{}.!\\]/g;

function escapeMarkdownV2(text: string): string {
  return text.replace(ESCAPABLE, "\\$&");
}

function formatTelegramMessage(event: Record<string, unknown>): string {
  const severity = (event.severity as number) ?? 2;
  const emoji = SEVERITY_EMOJI[severity] ?? "\u{1F534}";
  const label = SEVERITY_LABELS[severity] ?? "ERROR";
  const context = (event.context as Record<string, unknown>) ?? {};
  const parts: string[] = [];

  let header = `${emoji} *${label}*`;
  if (context.environment) {
    header += ` \\| \`${escapeMarkdownV2(String(context.environment))}\``;
  }
  parts.push(header);

  parts.push("");
  parts.push(`*${escapeMarkdownV2(String(event.message ?? "Unknown error"))}*`);

  if (context.url) {
    const loc = context.method
      ? `${context.method} ${context.url}`
      : String(context.url);
    parts.push(`\u{1F4CD} \`${escapeMarkdownV2(loc)}\``);
  }

  parts.push(
    `\u{1F550} \`${escapeMarkdownV2(String(event.timestamp ?? new Date().toISOString()))}\``
  );

  if (event.stack) {
    parts.push("");
    parts.push("```");
    parts.push(String(event.stack).slice(0, 2000));
    parts.push("```");
  }

  const occurrences = (event.occurrences as number) ?? 1;
  if (occurrences > 1) {
    parts.push("");
    parts.push(`*Occurrences:* \`${occurrences}\``);
  }

  return parts.join("\n").slice(0, 4096);
}

function sendToTelegram(
  botToken: string,
  chatId: string,
  text: string
): void {
  fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "MarkdownV2",
      disable_web_page_preview: true,
    }),
  }).catch((err) => {
    console.error("[errorping] Telegram send failed:", err.message);
  });
}

let insertCount = 0;

export function createErrorpingRoutes(
  config: ErrorpingConfig
): RouteConfig[] {
  return [
    // Ingest errors from frontend
    {
      method: "POST",
      path: "/errorping",
      auth: "public",
      rateLimit: { windowMs: 60_000, max: 60 },
      handler: async (ctx) => {
        const event = ctx.body;

        if (!event.id || !event.message || !event.fingerprint) {
          return {
            status: 400,
            json: { error: "Missing required fields: id, message, fingerprint" },
          };
        }

        await ctx.db.query(
          `INSERT INTO error_events (id, timestamp, severity, name, message, stack, fingerprint, context, occurrences, first_seen)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           ON CONFLICT (id) DO NOTHING`,
          [
            event.id,
            event.timestamp ?? new Date().toISOString(),
            event.severity ?? 2,
            event.name ?? "Error",
            event.message,
            event.stack ?? null,
            event.fingerprint,
            JSON.stringify(event.context ?? {}),
            event.occurrences ?? 1,
            event.firstSeen ?? event.timestamp ?? new Date().toISOString(),
          ]
        );

        // Fire-and-forget Telegram notification
        if (config.botToken && config.chatId) {
          const text = formatTelegramMessage(event as Record<string, unknown>);
          sendToTelegram(config.botToken, config.chatId, text);
        }

        // Periodic retention cleanup
        insertCount++;
        if (insertCount % 100 === 0) {
          ctx.db
            .query(
              "DELETE FROM error_events WHERE created_at < NOW() - INTERVAL '30 days'"
            )
            .catch((err) => {
              console.error("[errorping] Retention cleanup failed:", err.message);
            });
        }

        return { status: 201, json: { ok: true } };
      },
    },

    // Query errors with filters
    {
      method: "GET",
      path: "/errorping",
      auth: { strategy: "bearer" },
      handler: async (ctx) => {
        const url = new URL(ctx.req.url ?? "/", "http://localhost");
        const since = url.searchParams.get("since");
        const until = url.searchParams.get("until");
        const severity = url.searchParams.get("severity");
        const fingerprint = url.searchParams.get("fingerprint");
        const resolved = url.searchParams.get("resolved");
        const limit = Math.min(
          parseInt(url.searchParams.get("limit") ?? "50", 10),
          500
        );
        const offset = parseInt(url.searchParams.get("offset") ?? "0", 10);

        const conditions: string[] = [];
        const params: unknown[] = [];
        let paramIdx = 1;

        if (since) {
          conditions.push(`timestamp >= $${paramIdx++}`);
          params.push(since);
        }
        if (until) {
          conditions.push(`timestamp <= $${paramIdx++}`);
          params.push(until);
        }
        if (severity) {
          conditions.push(`severity >= $${paramIdx++}`);
          params.push(parseInt(severity, 10));
        }
        if (fingerprint) {
          conditions.push(`fingerprint = $${paramIdx++}`);
          params.push(fingerprint);
        }
        if (resolved !== null) {
          conditions.push(`resolved = $${paramIdx++}`);
          params.push(resolved === "true");
        }

        const where =
          conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

        params.push(limit);
        params.push(offset);

        const result = await ctx.db.query(
          `SELECT * FROM error_events ${where} ORDER BY timestamp DESC LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
          params
        );

        return { status: 200, json: result.rows };
      },
    },

    // Summary grouped by fingerprint
    {
      method: "GET",
      path: "/errorping/summary",
      auth: { strategy: "bearer" },
      handler: async (ctx) => {
        const url = new URL(ctx.req.url ?? "/", "http://localhost");
        const since = url.searchParams.get("since");
        const resolved = url.searchParams.get("resolved");

        const conditions: string[] = [];
        const params: unknown[] = [];
        let paramIdx = 1;

        if (since) {
          conditions.push(`timestamp >= $${paramIdx++}`);
          params.push(since);
        }
        if (resolved !== null) {
          conditions.push(`resolved = $${paramIdx++}`);
          params.push(resolved === "true");
        }

        const where =
          conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

        const result = await ctx.db.query(
          `SELECT
            fingerprint,
            MAX(severity) as max_severity,
            MAX(name) as name,
            MAX(message) as message,
            SUM(occurrences) as total_occurrences,
            COUNT(*) as distinct_events,
            MIN(first_seen) as first_seen,
            MAX(timestamp) as last_seen,
            BOOL_OR(resolved) as resolved
          FROM error_events ${where}
          GROUP BY fingerprint
          ORDER BY last_seen DESC`,
          params
        );

        return { status: 200, json: result.rows };
      },
    },

    // Resolve errors by fingerprint
    {
      method: "POST",
      path: "/errorping/resolve",
      auth: { strategy: "bearer" },
      handler: async (ctx) => {
        const fingerprint = ctx.body.fingerprint as string | undefined;
        if (!fingerprint) {
          return {
            status: 400,
            json: { error: "fingerprint is required" },
          };
        }

        await ctx.db.query(
          "UPDATE error_events SET resolved = TRUE, resolved_at = NOW() WHERE fingerprint = $1",
          [fingerprint]
        );

        return { status: 200, json: { ok: true, fingerprint } };
      },
    },

    // Unresolve errors by fingerprint
    {
      method: "POST",
      path: "/errorping/unresolve",
      auth: { strategy: "bearer" },
      handler: async (ctx) => {
        const fingerprint = ctx.body.fingerprint as string | undefined;
        if (!fingerprint) {
          return {
            status: 400,
            json: { error: "fingerprint is required" },
          };
        }

        await ctx.db.query(
          "UPDATE error_events SET resolved = FALSE, resolved_at = NULL WHERE fingerprint = $1",
          [fingerprint]
        );

        return { status: 200, json: { ok: true, fingerprint } };
      },
    },
  ];
}
