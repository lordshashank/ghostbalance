import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createAuthMiddleware } from "../src/auth/middleware.js";
import type { AuthStrategy } from "../src/auth/types.js";
import type { IncomingMessage } from "node:http";

const mockReq = {} as IncomingMessage;
const mockBody = {};

function createMockStrategy(
  name: string,
  shouldSucceed: boolean
): AuthStrategy {
  return {
    name,
    async authenticate() {
      if (shouldSucceed) {
        return { userId: `user-from-${name}`, strategy: name };
      }
      return null;
    },
  };
}

describe("AuthMiddleware", () => {
  it("returns null for public routes", async () => {
    const auth = createAuthMiddleware();
    const result = await auth.authenticate(mockReq, mockBody, "public");
    assert.equal(result, null);
  });

  it("authenticates with a single strategy", async () => {
    const auth = createAuthMiddleware();
    auth.registerStrategy(createMockStrategy("test-auth", true));

    const result = await auth.authenticate(mockReq, mockBody, {
      strategy: "test-auth",
    });
    assert.ok(result);
    assert.equal(result.userId, "user-from-test-auth");
    assert.equal(result.strategy, "test-auth");
  });

  it("returns false when strategy fails", async () => {
    const auth = createAuthMiddleware();
    auth.registerStrategy(createMockStrategy("failing-auth", false));

    const result = await auth.authenticate(mockReq, mockBody, {
      strategy: "failing-auth",
    });
    assert.equal(result, false);
  });

  it("returns false for unregistered strategy", async () => {
    const auth = createAuthMiddleware();
    const result = await auth.authenticate(mockReq, mockBody, {
      strategy: "nonexistent",
    });
    assert.equal(result, false);
  });

  it("tries multiple strategies and returns first success", async () => {
    const auth = createAuthMiddleware();
    auth.registerStrategy(createMockStrategy("first", false));
    auth.registerStrategy(createMockStrategy("second", true));
    auth.registerStrategy(createMockStrategy("third", true));

    const result = await auth.authenticate(mockReq, mockBody, [
      { strategy: "first" },
      { strategy: "second" },
      { strategy: "third" },
    ]);
    assert.ok(result);
    assert.equal(result.userId, "user-from-second");
  });

  it("returns false when all strategies in array fail", async () => {
    const auth = createAuthMiddleware();
    auth.registerStrategy(createMockStrategy("a", false));
    auth.registerStrategy(createMockStrategy("b", false));

    const result = await auth.authenticate(mockReq, mockBody, [
      { strategy: "a" },
      { strategy: "b" },
    ]);
    assert.equal(result, false);
  });

  it("handles mixed registered and unregistered strategies", async () => {
    const auth = createAuthMiddleware();
    auth.registerStrategy(createMockStrategy("real", true));

    const result = await auth.authenticate(mockReq, mockBody, [
      { strategy: "fake" },
      { strategy: "real" },
    ]);
    assert.ok(result);
    assert.equal(result.userId, "user-from-real");
  });
});
