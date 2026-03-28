import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createSessionStrategy } from "../src/auth/strategies/session.js";
import type { IncomingMessage } from "node:http";
import type { DbAdapter } from "../src/db/pool.js";

function createMockReq(cookie?: string): IncomingMessage {
  return {
    headers: cookie ? { cookie } : {},
  } as IncomingMessage;
}

function createMockDb(
  rows: Record<string, unknown>[] = [],
  deleteCalled: { count: number } = { count: 0 }
): DbAdapter {
  return {
    async query(sql: string) {
      if (sql.startsWith("DELETE")) {
        deleteCalled.count++;
        return { rows: [], rowCount: 0 };
      }
      return { rows, rowCount: rows.length };
    },
    async transaction(fn) {
      return fn(async () => ({ rows: [], rowCount: 0 }));
    },
    async close() {},
  };
}

describe("Session Strategy", () => {
  it("returns null when no session cookie", async () => {
    const strategy = createSessionStrategy(createMockDb());
    const result = await strategy.authenticate(createMockReq(), {});
    assert.equal(result, null);
  });

  it("returns null for empty cookie header", async () => {
    const strategy = createSessionStrategy(createMockDb());
    const result = await strategy.authenticate(createMockReq(""), {});
    assert.equal(result, null);
  });

  it("returns null when session token not found in DB", async () => {
    const strategy = createSessionStrategy(createMockDb([]));
    const result = await strategy.authenticate(
      createMockReq("session=nonexistent-token"),
      {}
    );
    assert.equal(result, null);
  });

  it("returns AuthContext for valid session", async () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    const db = createMockDb([
      {
        nullifier: "0xabc123",
        public_balance: "1000000000000000000",
        block_number: "12345",
        block_hash: "0xhash",
        expires_at: future,
      },
    ]);

    const strategy = createSessionStrategy(db);
    const result = await strategy.authenticate(
      createMockReq("session=valid-token"),
      {}
    );

    assert.ok(result);
    assert.equal(result.userId, "0xabc123");
    assert.equal(result.strategy, "session");
    assert.equal(result.publicBalance, "1000000000000000000");
    assert.equal(result.blockNumber, 12345);
    assert.equal(result.blockHash, "0xhash");
  });

  it("returns null and deletes expired session", async () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const deleteCalled = { count: 0 };
    const db = createMockDb(
      [
        {
          nullifier: "0xabc123",
          public_balance: "1000000000000000000",
          block_number: "12345",
          block_hash: "0xhash",
          expires_at: past,
        },
      ],
      deleteCalled
    );

    const strategy = createSessionStrategy(db);
    const result = await strategy.authenticate(
      createMockReq("session=expired-token"),
      {}
    );

    assert.equal(result, null);
    assert.equal(deleteCalled.count, 1);
  });

  it("parses session cookie among multiple cookies", async () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    const db = createMockDb([
      {
        nullifier: "0xdef456",
        public_balance: "0",
        block_number: "100",
        block_hash: "0xh",
        expires_at: future,
      },
    ]);

    const strategy = createSessionStrategy(db);
    const result = await strategy.authenticate(
      createMockReq("other=value; session=my-token; foo=bar"),
      {}
    );

    assert.ok(result);
    assert.equal(result.userId, "0xdef456");
  });
});
