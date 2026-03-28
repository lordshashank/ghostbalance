import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { authMeRoute, authLogoutRoute } from "../src/app/routes/auth.js";
import type { HandlerContext } from "../src/server/router.js";
import type { DbAdapter } from "../src/db/pool.js";
import { createNoopChangeNotifier } from "../src/db/changes.js";
import { createNoopStorage } from "../src/storage/noop.js";
import type { IncomingMessage } from "node:http";

function createMockCtx(overrides: Partial<HandlerContext> = {}): HandlerContext {
  return {
    req: { headers: {} } as IncomingMessage,
    params: {},
    body: {},
    db: {
      async query() { return { rows: [], rowCount: 0 }; },
      async transaction(fn) { return fn(async () => ({ rows: [], rowCount: 0 })); },
      async close() {},
    },
    auth: { userId: "0xnullifier", strategy: "session" },
    changes: createNoopChangeNotifier(),
    storage: createNoopStorage(),
    ...overrides,
  };
}

describe("Auth Routes", () => {
  describe("GET /auth/me", () => {
    it("returns profile when found", async () => {
      const profile = { nullifier: "0xnullifier", bio: "hi", gender: "male", public_balance: "1000" };
      const db: DbAdapter = {
        async query() { return { rows: [profile], rowCount: 1 }; },
        async transaction(fn) { return fn(async () => ({ rows: [], rowCount: 0 })); },
        async close() {},
      };
      const ctx = createMockCtx({ db });
      const result = await authMeRoute.handler(ctx);
      assert.equal(result.status, 200);
      assert.deepEqual(result.json, profile);
    });

    it("returns 404 when profile not found", async () => {
      const ctx = createMockCtx();
      const result = await authMeRoute.handler(ctx);
      assert.equal(result.status, 404);
    });

    it("requires session auth", () => {
      assert.deepEqual(authMeRoute.auth, { strategy: "session" });
    });
  });

  describe("POST /auth/logout", () => {
    it("clears cookie and returns ok", async () => {
      let deletedToken: string | null = null;
      const db: DbAdapter = {
        async query(_sql: string, params?: unknown[]) {
          if (params) deletedToken = params[0] as string;
          return { rows: [], rowCount: 1 };
        },
        async transaction(fn) { return fn(async () => ({ rows: [], rowCount: 0 })); },
        async close() {},
      };
      const ctx = createMockCtx({
        req: { headers: { cookie: "session=my-token-123" } } as unknown as IncomingMessage,
        db,
      });
      const result = await authLogoutRoute.handler(ctx);
      assert.equal(result.status, 200);
      assert.deepEqual(result.json, { ok: true });
      assert.ok(result.headers?.["Set-Cookie"]?.includes("Max-Age=0"));
      assert.equal(deletedToken, "my-token-123");
    });

    it("handles missing cookie gracefully", async () => {
      const ctx = createMockCtx({
        req: { headers: {} } as IncomingMessage,
      });
      const result = await authLogoutRoute.handler(ctx);
      assert.equal(result.status, 200);
      assert.ok(result.headers?.["Set-Cookie"]?.includes("Max-Age=0"));
    });
  });
});
