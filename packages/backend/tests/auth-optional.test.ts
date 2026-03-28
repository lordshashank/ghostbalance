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

describe("AuthMiddleware - optional auth", () => {
  it("returns null (not false) when optional strategy fails", async () => {
    const auth = createAuthMiddleware();
    auth.registerStrategy(createMockStrategy("session", false));

    const result = await auth.authenticate(mockReq, mockBody, {
      strategy: "session",
      optional: true,
    });
    // null = unauthenticated but allowed (not false = 401)
    assert.equal(result, null);
  });

  it("returns AuthContext when optional strategy succeeds", async () => {
    const auth = createAuthMiddleware();
    auth.registerStrategy(createMockStrategy("session", true));

    const result = await auth.authenticate(mockReq, mockBody, {
      strategy: "session",
      optional: true,
    });
    assert.ok(result);
    assert.equal(result.userId, "user-from-session");
  });

  it("returns false when non-optional strategy fails", async () => {
    const auth = createAuthMiddleware();
    auth.registerStrategy(createMockStrategy("session", false));

    const result = await auth.authenticate(mockReq, mockBody, {
      strategy: "session",
    });
    assert.equal(result, false);
  });

  it("returns null when optional strategy in array fails", async () => {
    const auth = createAuthMiddleware();
    auth.registerStrategy(createMockStrategy("a", false));

    const result = await auth.authenticate(mockReq, mockBody, [
      { strategy: "a", optional: true },
    ]);
    assert.equal(result, null);
  });

  it("returns false when non-optional strategies in array all fail", async () => {
    const auth = createAuthMiddleware();
    auth.registerStrategy(createMockStrategy("a", false));
    auth.registerStrategy(createMockStrategy("b", false));

    const result = await auth.authenticate(mockReq, mockBody, [
      { strategy: "a" },
      { strategy: "b" },
    ]);
    assert.equal(result, false);
  });

  it("returns null if at least one requirement in array is optional and all fail", async () => {
    const auth = createAuthMiddleware();
    auth.registerStrategy(createMockStrategy("a", false));
    auth.registerStrategy(createMockStrategy("b", false));

    const result = await auth.authenticate(mockReq, mockBody, [
      { strategy: "a" },
      { strategy: "b", optional: true },
    ]);
    // b was optional, so the whole array is treated as optional
    assert.equal(result, null);
  });
});
