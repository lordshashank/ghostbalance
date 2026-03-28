import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createFeedbackRoutes } from "../src/app/routes/feedback.js";
import { createNoopChangeNotifier } from "../src/db/changes.js";
import type { RouteConfig, HandlerContext } from "../src/server/router.js";
import type { DbAdapter, QueryResult } from "../src/db/pool.js";
import type { AuthContext } from "../src/auth/types.js";
import type { IncomingMessage } from "node:http";

// --- Helpers ---

const changes = createNoopChangeNotifier();

function mockReq(url = "/"): IncomingMessage {
  return { url } as IncomingMessage;
}

function userAuth(userId = "user1"): AuthContext {
  return { userId, strategy: "test" };
}

function adminAuth(): AuthContext {
  return { userId: "bearer", strategy: "bearer" };
}

/** Create a mock DB where `query` calls a provided function. */
function createMockDb(
  onQuery: (sql: string, params?: unknown[]) => QueryResult<Record<string, unknown>>
): DbAdapter {
  return {
    async query<T = Record<string, unknown>>(sql: string, params?: unknown[]) {
      const result = onQuery(sql, params);
      return { rows: result.rows as T[], rowCount: result.rowCount };
    },
    async transaction(fn) {
      return fn(async <T = Record<string, unknown>>(sql: string, params?: unknown[]) =>
        {
          const result = onQuery(sql, params);
          return { rows: result.rows as T[], rowCount: result.rowCount };
        }
      );
    },
    async close() {},
  };
}

const EMPTY = { rows: [], rowCount: 0 };

// --- Setup ---

let routes: RouteConfig[];

function findRoute(method: string, path: string): RouteConfig {
  const r = routes.find((r) => r.method === method && r.path === path);
  if (!r) throw new Error(`Route not found: ${method} ${path}`);
  return r;
}

function ctx(
  overrides: Partial<HandlerContext> & { db: DbAdapter }
): HandlerContext {
  return {
    req: mockReq(),
    params: {},
    body: {},
    auth: userAuth(),
    changes,
    ...overrides,
  };
}

// --- Tests ---

describe("Feedback Routes", () => {
  beforeEach(() => {
    routes = createFeedbackRoutes({ userAuth: { strategy: "test" } });
  });

  describe("POST /feedback (create post)", () => {
    it("creates a post with valid fields", async () => {
      const route = findRoute("POST", "/feedback");
      const fakePost = {
        id: "post-1",
        user_id: "user1",
        type: "bug",
        title: "Crash on load",
        description: "App crashes",
      };

      const db = createMockDb((sql) => {
        if (sql.includes("INSERT INTO feedback_posts"))
          return { rows: [fakePost], rowCount: 1 };
        return EMPTY;
      });

      const res = await route.handler(
        ctx({
          db,
          body: { type: "bug", title: "Crash on load", description: "App crashes" },
        })
      );

      assert.equal(res.status, 201);
      assert.equal((res.json as Record<string, unknown>).id, "post-1");
    });

    it("rejects missing fields", async () => {
      const route = findRoute("POST", "/feedback");
      const db = createMockDb(() => EMPTY);

      const res = await route.handler(ctx({ db, body: { type: "bug" } }));
      assert.equal(res.status, 400);
      assert.match(
        (res.json as Record<string, string>).error,
        /Missing required fields/
      );
    });

    it("rejects invalid type", async () => {
      const route = findRoute("POST", "/feedback");
      const db = createMockDb(() => EMPTY);

      const res = await route.handler(
        ctx({
          db,
          body: { type: "rant", title: "title", description: "desc" },
        })
      );
      assert.equal(res.status, 400);
      assert.match((res.json as Record<string, string>).error, /Invalid type/);
    });
  });

  describe("GET /feedback (list posts)", () => {
    it("returns paginated posts with user_has_voted", async () => {
      const route = findRoute("GET", "/feedback");
      const db = createMockDb((sql) => {
        if (sql.includes("COUNT(*)"))
          return { rows: [{ total: 1 }], rowCount: 1 };
        if (sql.includes("SELECT p.*"))
          return {
            rows: [
              { id: "post-1", title: "Bug", user_has_voted: false },
            ],
            rowCount: 1,
          };
        return EMPTY;
      });

      const res = await route.handler(
        ctx({ db, req: mockReq("/feedback?status=open&sort=votes") })
      );

      assert.equal(res.status, 200);
      const json = res.json as Record<string, unknown>;
      assert.equal(json.page, 1);
      assert.equal(json.total, 1);
      assert.equal((json.posts as unknown[]).length, 1);
    });

    it("respects page and limit params", async () => {
      const route = findRoute("GET", "/feedback");
      const db = createMockDb((sql) => {
        if (sql.includes("COUNT(*)"))
          return { rows: [{ total: 50 }], rowCount: 1 };
        return { rows: [], rowCount: 0 };
      });

      const res = await route.handler(
        ctx({ db, req: mockReq("/feedback?page=3&limit=10") })
      );

      const json = res.json as Record<string, unknown>;
      assert.equal(json.page, 3);
      assert.equal(json.limit, 10);
      assert.equal(json.totalPages, 5);
    });
  });

  describe("GET /feedback/:id (get single post)", () => {
    it("returns post with comments", async () => {
      const route = findRoute("GET", "/feedback/:id");
      const db = createMockDb((sql) => {
        if (sql.includes("FROM feedback_posts"))
          return {
            rows: [{ id: "post-1", title: "Bug", user_has_voted: true }],
            rowCount: 1,
          };
        if (sql.includes("FROM feedback_comments"))
          return {
            rows: [{ id: "c1", body: "me too" }],
            rowCount: 1,
          };
        return EMPTY;
      });

      const res = await route.handler(
        ctx({ db, params: { id: "post-1" } })
      );

      assert.equal(res.status, 200);
      const json = res.json as Record<string, unknown>;
      assert.equal(json.id, "post-1");
      assert.equal((json.comments as unknown[]).length, 1);
    });

    it("returns 404 for non-existent post", async () => {
      const route = findRoute("GET", "/feedback/:id");
      const db = createMockDb(() => EMPTY);

      const res = await route.handler(
        ctx({ db, params: { id: "nope" } })
      );
      assert.equal(res.status, 404);
    });
  });

  describe("POST /feedback/:id/vote (toggle vote)", () => {
    it("adds vote when not yet voted", async () => {
      const route = findRoute("POST", "/feedback/:id/vote");
      const queries: string[] = [];

      const db = createMockDb((sql) => {
        queries.push(sql);
        if (sql.includes("SELECT id FROM feedback_posts"))
          return { rows: [{ id: "post-1" }], rowCount: 1 };
        if (sql.includes("SELECT 1 FROM feedback_votes"))
          return EMPTY; // not voted yet
        if (sql.includes("SELECT vote_count"))
          return { rows: [{ vote_count: 1 }], rowCount: 1 };
        return EMPTY;
      });

      const res = await route.handler(
        ctx({ db, params: { id: "post-1" } })
      );

      assert.equal(res.status, 200);
      const json = res.json as Record<string, unknown>;
      assert.equal(json.voted, true);
      assert.equal(json.vote_count, 1);
      assert.ok(queries.some((q) => q.includes("INSERT INTO feedback_votes")));
    });

    it("removes vote when already voted", async () => {
      const route = findRoute("POST", "/feedback/:id/vote");
      const queries: string[] = [];

      const db = createMockDb((sql) => {
        queries.push(sql);
        if (sql.includes("SELECT id FROM feedback_posts"))
          return { rows: [{ id: "post-1" }], rowCount: 1 };
        if (sql.includes("SELECT 1 FROM feedback_votes"))
          return { rows: [{ "?column?": 1 }], rowCount: 1 }; // already voted
        if (sql.includes("SELECT vote_count"))
          return { rows: [{ vote_count: 0 }], rowCount: 1 };
        return EMPTY;
      });

      const res = await route.handler(
        ctx({ db, params: { id: "post-1" } })
      );

      assert.equal(res.status, 200);
      const json = res.json as Record<string, unknown>;
      assert.equal(json.voted, false);
      assert.equal(json.vote_count, 0);
      assert.ok(queries.some((q) => q.includes("DELETE FROM feedback_votes")));
    });

    it("returns 404 for non-existent post", async () => {
      const route = findRoute("POST", "/feedback/:id/vote");
      const db = createMockDb(() => EMPTY);

      const res = await route.handler(
        ctx({ db, params: { id: "nope" } })
      );
      assert.equal(res.status, 404);
    });
  });

  describe("POST /feedback/:id/comments (add comment)", () => {
    it("adds a user comment with is_admin=false", async () => {
      const route = findRoute("POST", "/feedback/:id/comments");
      let insertParams: unknown[] = [];

      const db = createMockDb((sql, params) => {
        if (sql.includes("SELECT id FROM feedback_posts"))
          return { rows: [{ id: "post-1" }], rowCount: 1 };
        if (sql.includes("INSERT INTO feedback_comments")) {
          insertParams = params ?? [];
          return {
            rows: [{ id: "c1", body: "great idea", is_admin: false }],
            rowCount: 1,
          };
        }
        return EMPTY;
      });

      const res = await route.handler(
        ctx({
          db,
          params: { id: "post-1" },
          body: { body: "great idea" },
          auth: userAuth(),
        })
      );

      assert.equal(res.status, 201);
      // is_admin param should be false for user auth
      assert.equal(insertParams[3], false);
    });

    it("adds an admin comment with is_admin=true", async () => {
      const route = findRoute("POST", "/feedback/:id/comments");
      let insertParams: unknown[] = [];

      const db = createMockDb((sql, params) => {
        if (sql.includes("SELECT id FROM feedback_posts"))
          return { rows: [{ id: "post-1" }], rowCount: 1 };
        if (sql.includes("INSERT INTO feedback_comments")) {
          insertParams = params ?? [];
          return {
            rows: [{ id: "c1", body: "noted", is_admin: true }],
            rowCount: 1,
          };
        }
        return EMPTY;
      });

      const res = await route.handler(
        ctx({
          db,
          params: { id: "post-1" },
          body: { body: "noted" },
          auth: adminAuth(),
        })
      );

      assert.equal(res.status, 201);
      assert.equal(insertParams[3], true);
    });

    it("rejects missing body", async () => {
      const route = findRoute("POST", "/feedback/:id/comments");
      const db = createMockDb(() => EMPTY);

      const res = await route.handler(
        ctx({ db, params: { id: "post-1" }, body: {} })
      );
      assert.equal(res.status, 400);
    });
  });

  describe("DELETE /feedback/:id (delete post)", () => {
    it("allows owner to delete their own post", async () => {
      const route = findRoute("DELETE", "/feedback/:id");
      const db = createMockDb((sql) => {
        if (sql.includes("DELETE FROM feedback_posts") && sql.includes("user_id"))
          return { rows: [{ id: "post-1" }], rowCount: 1 };
        return EMPTY;
      });

      const res = await route.handler(
        ctx({ db, params: { id: "post-1" }, auth: userAuth("user1") })
      );
      assert.equal(res.status, 200);
      assert.deepEqual(res.json, { ok: true });
    });

    it("returns 404 when user tries to delete another users post", async () => {
      const route = findRoute("DELETE", "/feedback/:id");
      const db = createMockDb(() => EMPTY); // no matching row for user_id check

      const res = await route.handler(
        ctx({ db, params: { id: "post-1" }, auth: userAuth("other-user") })
      );
      assert.equal(res.status, 404);
      assert.match(
        (res.json as Record<string, string>).error,
        /not owned by you/
      );
    });

    it("allows admin to delete any post", async () => {
      const route = findRoute("DELETE", "/feedback/:id");
      let deleteSql = "";

      const db = createMockDb((sql) => {
        deleteSql = sql;
        if (sql.includes("DELETE FROM feedback_posts"))
          return { rows: [{ id: "post-1" }], rowCount: 1 };
        return EMPTY;
      });

      const res = await route.handler(
        ctx({ db, params: { id: "post-1" }, auth: adminAuth() })
      );
      assert.equal(res.status, 200);
      // Admin delete should NOT check user_id
      assert.ok(!deleteSql.includes("user_id"));
    });
  });

  describe("DELETE /feedback/:id/comments/:commentId (delete comment)", () => {
    it("allows owner to delete their own comment", async () => {
      const route = findRoute("DELETE", "/feedback/:id/comments/:commentId");
      const db = createMockDb((sql) => {
        if (sql.includes("DELETE FROM feedback_comments") && sql.includes("user_id"))
          return { rows: [{ id: "c1" }], rowCount: 1 };
        return EMPTY;
      });

      const res = await route.handler(
        ctx({
          db,
          params: { id: "post-1", commentId: "c1" },
          auth: userAuth(),
        })
      );
      assert.equal(res.status, 200);
    });

    it("returns 404 when user tries to delete anothers comment", async () => {
      const route = findRoute("DELETE", "/feedback/:id/comments/:commentId");
      const db = createMockDb(() => EMPTY);

      const res = await route.handler(
        ctx({
          db,
          params: { id: "post-1", commentId: "c1" },
          auth: userAuth("other"),
        })
      );
      assert.equal(res.status, 404);
      assert.match(
        (res.json as Record<string, string>).error,
        /not owned by you/
      );
    });

    it("allows admin to delete any comment", async () => {
      const route = findRoute("DELETE", "/feedback/:id/comments/:commentId");
      let deleteSql = "";

      const db = createMockDb((sql) => {
        deleteSql = sql;
        if (sql.includes("DELETE FROM feedback_comments"))
          return { rows: [{ id: "c1" }], rowCount: 1 };
        return EMPTY;
      });

      const res = await route.handler(
        ctx({
          db,
          params: { id: "post-1", commentId: "c1" },
          auth: adminAuth(),
        })
      );
      assert.equal(res.status, 200);
      assert.ok(!deleteSql.includes("user_id"));
    });
  });

  describe("PATCH /feedback/:id/status (admin update)", () => {
    it("updates status and admin_note", async () => {
      const route = findRoute("PATCH", "/feedback/:id/status");
      const updated = { id: "post-1", status: "in_progress", admin_note: "Working on it" };

      const db = createMockDb((sql) => {
        if (sql.includes("UPDATE feedback_posts"))
          return { rows: [updated], rowCount: 1 };
        return EMPTY;
      });

      const res = await route.handler(
        ctx({
          db,
          params: { id: "post-1" },
          body: { status: "in_progress", admin_note: "Working on it" },
          auth: adminAuth(),
        })
      );

      assert.equal(res.status, 200);
      assert.equal((res.json as Record<string, unknown>).status, "in_progress");
    });

    it("rejects invalid status value", async () => {
      const route = findRoute("PATCH", "/feedback/:id/status");
      const db = createMockDb(() => EMPTY);

      const res = await route.handler(
        ctx({
          db,
          params: { id: "post-1" },
          body: { status: "yolo" },
          auth: adminAuth(),
        })
      );
      assert.equal(res.status, 400);
      assert.match((res.json as Record<string, string>).error, /Invalid status/);
    });

    it("rejects invalid priority value", async () => {
      const route = findRoute("PATCH", "/feedback/:id/status");
      const db = createMockDb(() => EMPTY);

      const res = await route.handler(
        ctx({
          db,
          params: { id: "post-1" },
          body: { priority: "urgent" },
          auth: adminAuth(),
        })
      );
      assert.equal(res.status, 400);
      assert.match((res.json as Record<string, string>).error, /Invalid priority/);
    });

    it("rejects empty update", async () => {
      const route = findRoute("PATCH", "/feedback/:id/status");
      const db = createMockDb(() => EMPTY);

      const res = await route.handler(
        ctx({ db, params: { id: "post-1" }, body: {}, auth: adminAuth() })
      );
      assert.equal(res.status, 400);
      assert.match((res.json as Record<string, string>).error, /No fields to update/);
    });

    it("returns 404 for non-existent post", async () => {
      const route = findRoute("PATCH", "/feedback/:id/status");
      const db = createMockDb(() => EMPTY);

      const res = await route.handler(
        ctx({
          db,
          params: { id: "nope" },
          body: { status: "done" },
          auth: adminAuth(),
        })
      );
      assert.equal(res.status, 404);
    });
  });

  describe("Route auth configuration", () => {
    it("user-only routes use the configured userAuth", () => {
      const userOnlyPaths = [
        { method: "POST", path: "/feedback" },
        { method: "GET", path: "/feedback" },
        { method: "GET", path: "/feedback/:id" },
        { method: "POST", path: "/feedback/:id/vote" },
      ];

      for (const { method, path } of userOnlyPaths) {
        const route = findRoute(method, path);
        assert.deepEqual(route.auth, { strategy: "test" }, `${method} ${path}`);
      }
    });

    it("dual-auth routes include both userAuth and bearer", () => {
      const dualPaths = [
        { method: "POST", path: "/feedback/:id/comments" },
        { method: "DELETE", path: "/feedback/:id" },
        { method: "DELETE", path: "/feedback/:id/comments/:commentId" },
      ];

      for (const { method, path } of dualPaths) {
        const route = findRoute(method, path);
        assert.ok(Array.isArray(route.auth), `${method} ${path} should be array`);
        const strategies = (route.auth as Array<{ strategy: string }>).map(
          (s) => s.strategy
        );
        assert.ok(strategies.includes("test"), `${method} ${path} missing user strategy`);
        assert.ok(strategies.includes("bearer"), `${method} ${path} missing bearer`);
      }
    });

    it("admin-only route uses bearer strategy", () => {
      const route = findRoute("PATCH", "/feedback/:id/status");
      assert.deepEqual(route.auth, { strategy: "bearer" });
    });
  });
});
