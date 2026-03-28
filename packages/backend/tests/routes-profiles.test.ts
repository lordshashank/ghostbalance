import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createProfileRoutes } from "../src/app/routes/profiles.js";

const profileRoutes = createProfileRoutes({ sessionDurationSeconds: 3600, bioMaxLength: 500 });
import type { HandlerContext } from "../src/server/router.js";
import type { DbAdapter } from "../src/db/pool.js";
import { createNoopChangeNotifier } from "../src/db/changes.js";
import { createNoopStorage } from "../src/storage/noop.js";
import type { IncomingMessage } from "node:http";

function createMockCtx(overrides: Partial<HandlerContext> = {}): HandlerContext {
  return {
    req: {} as IncomingMessage,
    params: {},
    body: {},
    db: {
      async query() { return { rows: [], rowCount: 0 }; },
      async transaction(fn) { return fn(async () => ({ rows: [], rowCount: 0 })); },
      async close() {},
    },
    auth: { userId: "0xnullifier123", strategy: "session", publicBalance: "1000000000000000000", blockNumber: 100, blockHash: "0xhash" },
    changes: createNoopChangeNotifier(),
    storage: createNoopStorage(),
    ...overrides,
  };
}

const postProfile = profileRoutes.find(r => r.method === "POST" && r.path === "/profiles")!;
const getProfile = profileRoutes.find(r => r.method === "GET" && r.path === "/profiles/:nullifier")!;
const patchProfile = profileRoutes.find(r => r.method === "PATCH" && r.path === "/profiles")!;

describe("Profile Routes", () => {
  describe("POST /profiles", () => {
    it("creates a profile with valid data", async () => {
      const insertedRow = {
        nullifier: "0xnullifier123",
        bio: "hello",
        gender: "male",
        public_balance: "1000000000000000000",
      };
      const db: DbAdapter = {
        async query() { return { rows: [insertedRow], rowCount: 1 }; },
        async transaction(fn) { return fn(async () => ({ rows: [insertedRow], rowCount: 1 })); },
        async close() {},
      };

      const ctx = createMockCtx({
        body: { gender: "male", bio: "hello" },
        db,
      });

      const result = await postProfile.handler(ctx);
      assert.equal(result.status, 201);
      assert.ok(result.headers?.["Set-Cookie"]?.includes("session="));
    });

    it("rejects missing gender", async () => {
      const ctx = createMockCtx({ body: { bio: "hello" } });
      const result = await postProfile.handler(ctx);
      assert.equal(result.status, 400);
    });

    it("rejects invalid gender", async () => {
      const ctx = createMockCtx({ body: { gender: "alien" } });
      const result = await postProfile.handler(ctx);
      assert.equal(result.status, 400);
    });

    it("returns 409 when profile already exists", async () => {
      const db: DbAdapter = {
        async query() { return { rows: [], rowCount: 0 }; },
        async transaction(fn) { return fn(async () => ({ rows: [], rowCount: 0 })); },
        async close() {},
      };

      const ctx = createMockCtx({
        body: { gender: "female" },
        db,
      });

      const result = await postProfile.handler(ctx);
      assert.equal(result.status, 409);
    });
  });

  describe("GET /profiles/:nullifier", () => {
    it("returns profile when found", async () => {
      const profile = { nullifier: "0xabc", bio: "hi", gender: "male", public_balance: "0" };
      const db: DbAdapter = {
        async query() { return { rows: [profile], rowCount: 1 }; },
        async transaction(fn) { return fn(async () => ({ rows: [], rowCount: 0 })); },
        async close() {},
      };

      const ctx = createMockCtx({ params: { nullifier: "0xabc" }, db });
      const result = await getProfile.handler(ctx);
      assert.equal(result.status, 200);
      assert.deepEqual(result.json, profile);
    });

    it("returns 404 when not found", async () => {
      const ctx = createMockCtx({ params: { nullifier: "0xnotfound" } });
      const result = await getProfile.handler(ctx);
      assert.equal(result.status, 404);
    });
  });

  describe("PATCH /profiles", () => {
    it("returns 400 when no fields provided", async () => {
      const ctx = createMockCtx({ body: {} });
      const result = await patchProfile.handler(ctx);
      assert.equal(result.status, 400);
    });

    it("returns 400 for invalid gender", async () => {
      const ctx = createMockCtx({ body: { gender: "robot" } });
      const result = await patchProfile.handler(ctx);
      assert.equal(result.status, 400);
    });

    it("returns 400 for invalid age", async () => {
      const ctx = createMockCtx({ body: { age: 5 } });
      const result = await patchProfile.handler(ctx);
      assert.equal(result.status, 400);
    });

    it("updates profile with valid bio", async () => {
      const updated = { nullifier: "0xnullifier123", bio: "new bio", gender: "male" };
      const db: DbAdapter = {
        async query() { return { rows: [updated], rowCount: 1 }; },
        async transaction(fn) { return fn(async () => ({ rows: [], rowCount: 0 })); },
        async close() {},
      };

      const ctx = createMockCtx({ body: { bio: "new bio" }, db });
      const result = await patchProfile.handler(ctx);
      assert.equal(result.status, 200);
    });
  });
});
