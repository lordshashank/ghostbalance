import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createPostRoutes } from "../src/app/routes/posts.js";
import type { HandlerContext } from "../src/server/router.js";
import type { DbAdapter } from "../src/db/pool.js";
import { createNoopChangeNotifier } from "../src/db/changes.js";
import { createNoopStorage } from "../src/storage/noop.js";
import type { IncomingMessage } from "node:http";

const postRoutes = createPostRoutes({
  trendingWindowHours: 24,
  postMaxLength: 2000,
  maxPollOptions: 6,
});

const getFeed = postRoutes.find(r => r.method === "GET" && r.path === "/posts")!;

function createMockCtx(url: string, auth?: { userId: string; strategy: string }): HandlerContext {
  const posts = [
    { id: "1", author_nullifier: "0xa", body: "hello", like_count: 5, created_at: "2024-01-01" },
  ];
  return {
    req: { url } as IncomingMessage,
    params: {},
    body: {},
    db: {
      async query(_sql: string) {
        return { rows: posts, rowCount: 1 };
      },
      async transaction(fn) { return fn(async () => ({ rows: posts, rowCount: 1 })); },
      async close() {},
    },
    auth: auth || { userId: "", strategy: "public" },
    changes: createNoopChangeNotifier(),
    storage: createNoopStorage(),
  };
}

describe("Post Feed Filters", () => {
  it("GET /posts returns data for latest type", async () => {
    const ctx = createMockCtx("/posts?type=latest");
    const result = await getFeed.handler(ctx);
    assert.equal(result.status, 200);
    const json = result.json as { data: unknown[] };
    assert.ok(Array.isArray(json.data));
  });

  it("GET /posts with author filter works", async () => {
    let capturedSql = "";
    const ctx = createMockCtx("/posts?author=0xabc");
    ctx.db = {
      async query(sql: string) {
        capturedSql = sql;
        return { rows: [], rowCount: 0 };
      },
      async transaction(fn) { return fn(async () => ({ rows: [], rowCount: 0 })); },
      async close() {},
    };
    await getFeed.handler(ctx);
    assert.ok(capturedSql.includes("author_nullifier"), "SQL should filter by author");
  });

  it("GET /posts with min_balance filter works", async () => {
    let capturedSql = "";
    const ctx = createMockCtx("/posts?min_balance=1000000000000000000");
    ctx.db = {
      async query(sql: string) {
        capturedSql = sql;
        return { rows: [], rowCount: 0 };
      },
      async transaction(fn) { return fn(async () => ({ rows: [], rowCount: 0 })); },
      async close() {},
    };
    await getFeed.handler(ctx);
    assert.ok(capturedSql.includes("public_balance"), "SQL should filter by balance");
  });

  it("GET /posts with session adds viewer flags", async () => {
    let capturedSql = "";
    const ctx = createMockCtx("/posts?type=latest", { userId: "0xme", strategy: "session" });
    ctx.db = {
      async query(sql: string) {
        capturedSql = sql;
        return { rows: [], rowCount: 0 };
      },
      async transaction(fn) { return fn(async () => ({ rows: [], rowCount: 0 })); },
      async close() {},
    };
    await getFeed.handler(ctx);
    assert.ok(capturedSql.includes("viewer_liked"), "SQL should include viewer_liked");
    assert.ok(capturedSql.includes("viewer_bookmarked"), "SQL should include viewer_bookmarked");
  });

  it("GET /posts without session omits viewer flags", async () => {
    let capturedSql = "";
    const ctx = createMockCtx("/posts?type=latest");
    ctx.db = {
      async query(sql: string) {
        capturedSql = sql;
        return { rows: [], rowCount: 0 };
      },
      async transaction(fn) { return fn(async () => ({ rows: [], rowCount: 0 })); },
      async close() {},
    };
    await getFeed.handler(ctx);
    assert.ok(!capturedSql.includes("viewer_liked"), "SQL should NOT include viewer_liked for anonymous");
  });

  it("GET /posts with type=replies filters to replies", async () => {
    let capturedSql = "";
    const ctx = createMockCtx("/posts?author=0xabc&type=replies");
    ctx.db = {
      async query(sql: string) {
        capturedSql = sql;
        return { rows: [], rowCount: 0 };
      },
      async transaction(fn) { return fn(async () => ({ rows: [], rowCount: 0 })); },
      async close() {},
    };
    await getFeed.handler(ctx);
    assert.ok(capturedSql.includes("parent_id IS NOT NULL"), "SQL should filter to replies");
  });

  it("GET /posts with type=media filters to posts with attachments", async () => {
    let capturedSql = "";
    const ctx = createMockCtx("/posts?author=0xabc&type=media");
    ctx.db = {
      async query(sql: string) {
        capturedSql = sql;
        return { rows: [], rowCount: 0 };
      },
      async transaction(fn) { return fn(async () => ({ rows: [], rowCount: 0 })); },
      async close() {},
    };
    await getFeed.handler(ctx);
    assert.ok(capturedSql.includes("post_attachments"), "SQL should filter to posts with attachments");
  });

  it("GET /posts?type=following returns 401 without auth", async () => {
    const ctx = createMockCtx("/posts?type=following");
    const result = await getFeed.handler(ctx);
    assert.equal(result.status, 401);
  });

  it("uses optional session auth", () => {
    assert.deepEqual(getFeed.auth, { strategy: "session", optional: true });
  });
});
