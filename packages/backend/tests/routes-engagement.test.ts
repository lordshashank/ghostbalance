import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { likeRoutes } from "../src/app/routes/likes.js";
import { bookmarkRoutes } from "../src/app/routes/bookmarks.js";
import { followRoutes } from "../src/app/routes/follows.js";
import { blockRoutes } from "../src/app/routes/blocks.js";
import type { HandlerContext } from "../src/server/router.js";
import { createNoopChangeNotifier } from "../src/db/changes.js";
import { createNoopStorage } from "../src/storage/noop.js";
import type { IncomingMessage } from "node:http";
import type { DbAdapter } from "../src/db/pool.js";

function createMockCtx(overrides: Partial<HandlerContext> = {}): HandlerContext {
  return {
    req: { url: "/" } as IncomingMessage,
    params: {},
    body: {},
    db: {
      async query() { return { rows: [], rowCount: 0 }; },
      async transaction(fn) { return fn(async () => ({ rows: [], rowCount: 0 })); },
      async close() {},
    },
    auth: { userId: "0xme", strategy: "session" },
    changes: createNoopChangeNotifier(),
    storage: createNoopStorage(),
    ...overrides,
  };
}

const toggleLike = likeRoutes.find(r => r.method === "POST")!;
const toggleBookmark = bookmarkRoutes.find(r => r.method === "POST")!;
const toggleFollow = followRoutes.find(r => r.method === "POST")!;
const toggleBlock = blockRoutes.find(r => r.method === "POST")!;

describe("Engagement Routes", () => {
  describe("POST /posts/:id/like - toggle", () => {
    it("likes a post when not already liked", async () => {
      let insertCalled = false;
      const db: DbAdapter = {
        async query(sql: string) {
          if (sql.includes("SELECT") && sql.includes("likes")) return { rows: [], rowCount: 0 };
          if (sql.includes("INSERT INTO likes")) { insertCalled = true; return { rows: [], rowCount: 1 }; }
          if (sql.includes("UPDATE posts")) return { rows: [], rowCount: 1 };
          if (sql.includes("SELECT like_count")) return { rows: [{ like_count: 1 }], rowCount: 1 };
          if (sql.includes("SELECT") && sql.includes("author")) return { rows: [{ author_nullifier: "0xother" }], rowCount: 1 };
          return { rows: [], rowCount: 0 };
        },
        async transaction(fn) { return fn(this.query.bind(this)); },
        async close() {},
      };
      const ctx = createMockCtx({ params: { id: "post-1" }, db });
      const result = await toggleLike.handler(ctx);
      assert.equal(result.status, 200);
      assert.ok(insertCalled);
      const json = result.json as { liked: boolean };
      assert.equal(json.liked, true);
    });

    it("unlikes when already liked", async () => {
      let deleteCalled = false;
      const db: DbAdapter = {
        async query(sql: string) {
          if (sql.includes("SELECT") && sql.includes("likes")) return { rows: [{ post_id: "post-1" }], rowCount: 1 };
          if (sql.includes("DELETE FROM likes")) { deleteCalled = true; return { rows: [], rowCount: 1 }; }
          if (sql.includes("UPDATE posts")) return { rows: [], rowCount: 1 };
          if (sql.includes("SELECT like_count")) return { rows: [{ like_count: 0 }], rowCount: 1 };
          return { rows: [], rowCount: 0 };
        },
        async transaction(fn) { return fn(this.query.bind(this)); },
        async close() {},
      };
      const ctx = createMockCtx({ params: { id: "post-1" }, db });
      const result = await toggleLike.handler(ctx);
      assert.equal(result.status, 200);
      assert.ok(deleteCalled);
      const json = result.json as { liked: boolean };
      assert.equal(json.liked, false);
    });
  });

  describe("POST /posts/:id/bookmark - toggle", () => {
    it("bookmarks when not bookmarked", async () => {
      let insertCalled = false;
      const db: DbAdapter = {
        async query(sql: string) {
          if (sql.includes("SELECT")) return { rows: [], rowCount: 0 };
          if (sql.includes("INSERT")) { insertCalled = true; return { rows: [], rowCount: 1 }; }
          return { rows: [], rowCount: 0 };
        },
        async transaction(fn) { return fn(this.query.bind(this)); },
        async close() {},
      };
      const ctx = createMockCtx({ params: { id: "post-1" }, db });
      const result = await toggleBookmark.handler(ctx);
      assert.equal(result.status, 200);
      assert.ok(insertCalled);
      const json = result.json as { bookmarked: boolean };
      assert.equal(json.bookmarked, true);
    });
  });

  describe("POST /profiles/:nullifier/follow", () => {
    it("rejects self-follow", async () => {
      const ctx = createMockCtx({ params: { nullifier: "0xme" } });
      const result = await toggleFollow.handler(ctx);
      assert.equal(result.status, 400);
    });

    it("rejects follow when blocked", async () => {
      const queryFn = async (sql: string) => {
        if (sql.includes("blocks")) return { rows: [{ blocker_nullifier: "0xother" }], rowCount: 1 };
        return { rows: [], rowCount: 0 };
      };
      const db: DbAdapter = {
        async query(sql: string) { return queryFn(sql); },
        async transaction(fn) { return fn(queryFn); },
        async close() {},
      };
      const ctx = createMockCtx({ params: { nullifier: "0xother" }, db });
      const result = await toggleFollow.handler(ctx);
      assert.equal(result.status, 403);
    });
  });

  describe("POST /profiles/:nullifier/block", () => {
    it("rejects self-block", async () => {
      const ctx = createMockCtx({ params: { nullifier: "0xme" } });
      const result = await toggleBlock.handler(ctx);
      assert.equal(result.status, 400);
    });
  });
});
