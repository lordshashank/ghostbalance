import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { leaderboardRoutes } from "../src/app/routes/leaderboard.js";
import type { HandlerContext } from "../src/server/router.js";
import { createNoopChangeNotifier } from "../src/db/changes.js";
import { createNoopStorage } from "../src/storage/noop.js";
import type { IncomingMessage } from "node:http";
import type { DbAdapter } from "../src/db/pool.js";

function createMockCtx(overrides: Partial<HandlerContext> = {}): HandlerContext {
  return {
    req: { url: "/leaderboard/rank" } as IncomingMessage,
    params: {},
    body: {},
    db: {
      async query() { return { rows: [], rowCount: 0 }; },
      async transaction(fn) { return fn(async () => ({ rows: [], rowCount: 0 })); },
      async close() {},
    },
    auth: { userId: "0xme", strategy: "session", publicBalance: "5000000000000000000" },
    changes: createNoopChangeNotifier(),
    storage: createNoopStorage(),
    ...overrides,
  };
}

const rankRoute = leaderboardRoutes.find(r => r.path === "/leaderboard/rank")!;
const listRoute = leaderboardRoutes.find(r => r.path === "/leaderboard")!;

describe("Leaderboard Routes", () => {
  describe("GET /leaderboard/rank", () => {
    it("returns rank and total users", async () => {
      let queryCount = 0;
      const db: DbAdapter = {
        async query() {
          queryCount++;
          if (queryCount === 1) return { rows: [{ rank: "5" }], rowCount: 1 };
          return { rows: [{ total: "100" }], rowCount: 1 };
        },
        async transaction(fn) { return fn(async () => ({ rows: [], rowCount: 0 })); },
        async close() {},
      };
      const ctx = createMockCtx({ db });
      const result = await rankRoute.handler(ctx);
      assert.equal(result.status, 200);
      const json = result.json as { rank: number; total_users: number };
      assert.equal(json.rank, 5);
      assert.equal(json.total_users, 100);
    });

    it("requires session auth", () => {
      assert.deepEqual(rankRoute.auth, { strategy: "session" });
    });
  });

  describe("GET /leaderboard", () => {
    it("returns paginated profiles", async () => {
      const profiles = [
        { nullifier: "0xa", public_balance: "100" },
        { nullifier: "0xb", public_balance: "50" },
      ];
      const db: DbAdapter = {
        async query() { return { rows: profiles, rowCount: 2 }; },
        async transaction(fn) { return fn(async () => ({ rows: [], rowCount: 0 })); },
        async close() {},
      };
      const ctx = createMockCtx({
        req: { url: "/leaderboard?limit=20" } as IncomingMessage,
        db,
      });
      const result = await listRoute.handler(ctx);
      assert.equal(result.status, 200);
      const json = result.json as { data: unknown[]; next_cursor: string | null };
      assert.equal(json.data.length, 2);
      assert.equal(json.next_cursor, null);
    });

    it("is public", () => {
      assert.equal(listRoute.auth, "public");
    });
  });
});
