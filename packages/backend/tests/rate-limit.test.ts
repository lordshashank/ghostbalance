import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRateLimiter } from "../src/rate-limit/limiter.js";

describe("RateLimiter", () => {
  it("allows requests within limit", () => {
    const limiter = createRateLimiter();
    const config = { windowMs: 60_000, max: 5 };

    for (let i = 0; i < 5; i++) {
      const result = limiter.check("test-key", config);
      assert.equal(result.allowed, true);
      assert.equal(result.remaining, 5 - i - 1);
    }
  });

  it("blocks requests exceeding limit", () => {
    const limiter = createRateLimiter();
    const config = { windowMs: 60_000, max: 3 };

    // Use up the limit
    for (let i = 0; i < 3; i++) {
      limiter.check("block-key", config);
    }

    // Next request should be blocked
    const result = limiter.check("block-key", config);
    assert.equal(result.allowed, false);
    assert.equal(result.remaining, 0);
    assert.ok(result.retryAfter > 0);
  });

  it("tracks keys independently", () => {
    const limiter = createRateLimiter();
    const config = { windowMs: 60_000, max: 2 };

    limiter.check("key-a", config);
    limiter.check("key-a", config);

    // key-a is exhausted
    assert.equal(limiter.check("key-a", config).allowed, false);

    // key-b is still fresh
    assert.equal(limiter.check("key-b", config).allowed, true);
  });

  it("returns correct remaining count", () => {
    const limiter = createRateLimiter();
    const config = { windowMs: 60_000, max: 3 };

    assert.equal(limiter.check("rem-key", config).remaining, 2);
    assert.equal(limiter.check("rem-key", config).remaining, 1);
    assert.equal(limiter.check("rem-key", config).remaining, 0);
  });

  it("returns retryAfter only when blocked", () => {
    const limiter = createRateLimiter();
    const config = { windowMs: 60_000, max: 1 };

    const allowed = limiter.check("retry-key", config);
    assert.equal(allowed.retryAfter, 0);

    const blocked = limiter.check("retry-key", config);
    assert.ok(blocked.retryAfter > 0);
    assert.ok(blocked.retryAfter <= 60_000);
  });
});
