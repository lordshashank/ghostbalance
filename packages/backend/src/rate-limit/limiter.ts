export interface RateLimitConfig {
  windowMs: number;
  max: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfter: number;
}

export interface RateLimiter {
  check(key: string, config: RateLimitConfig): RateLimitResult;
}

export function createRateLimiter(): RateLimiter {
  const windows = new Map<string, number[]>();

  // Cleanup expired entries every 60s
  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, timestamps] of windows) {
      const filtered = timestamps.filter((t) => now - t < 120_000);
      if (filtered.length === 0) {
        windows.delete(key);
      } else {
        windows.set(key, filtered);
      }
    }
  }, 60_000);
  cleanupInterval.unref();

  return {
    check(key: string, config: RateLimitConfig): RateLimitResult {
      const now = Date.now();
      const windowStart = now - config.windowMs;

      let timestamps = windows.get(key);
      if (!timestamps) {
        timestamps = [];
        windows.set(key, timestamps);
      }

      // Remove expired timestamps
      while (timestamps.length > 0 && timestamps[0] < windowStart) {
        timestamps.shift();
      }

      if (timestamps.length >= config.max) {
        const oldestInWindow = timestamps[0];
        const retryAfter = config.windowMs - (now - oldestInWindow);
        return {
          allowed: false,
          remaining: 0,
          retryAfter,
        };
      }

      timestamps.push(now);
      return {
        allowed: true,
        remaining: config.max - timestamps.length,
        retryAfter: 0,
      };
    },
  };
}
