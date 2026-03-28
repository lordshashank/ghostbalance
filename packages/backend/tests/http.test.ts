import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createRouter } from "../src/server/router.js";
import { createHttpServer } from "../src/server/http.js";
import { createAuthMiddleware } from "../src/auth/middleware.js";
import { createRateLimiter } from "../src/rate-limit/limiter.js";
import { createNoopChangeNotifier } from "../src/db/changes.js";
import { createNoopStorage } from "../src/storage/noop.js";
import type { DbAdapter } from "../src/db/pool.js";

const TEST_PORT = 9876;

function createMockDb(): DbAdapter {
  return {
    async query() {
      return { rows: [], rowCount: 0 };
    },
    async transaction(fn) {
      return fn(async () => ({ rows: [], rowCount: 0 }));
    },
    async close() {},
  };
}

function fetch(
  path: string,
  options: { method?: string; body?: unknown; headers?: Record<string, string> } = {}
): Promise<{ status: number; json: unknown; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const bodyStr = options.body ? JSON.stringify(options.body) : undefined;
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: TEST_PORT,
        path,
        method: options.method ?? "GET",
        headers: {
          "Content-Type": "application/json",
          ...options.headers,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString();
          let json: unknown;
          try {
            json = JSON.parse(raw);
          } catch {
            json = raw;
          }
          resolve({ status: res.statusCode!, json, headers: res.headers });
        });
      }
    );
    req.on("error", reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

describe("HTTP Server", () => {
  let server: http.Server;

  afterEach(() => {
    return new Promise<void>((resolve) => {
      if (server) server.close(() => resolve());
      else resolve();
    });
  });

  it("returns 404 for unknown routes", async () => {
    const router = createRouter();
    server = createHttpServer({
      port: TEST_PORT,
      router,
      db: createMockDb(),
      changes: createNoopChangeNotifier(),
      auth: createAuthMiddleware(),
      rateLimiter: createRateLimiter(),
      storage: createNoopStorage(),
    });
    await new Promise((r) => setTimeout(r, 50));

    const res = await fetch("/nonexistent");
    assert.equal(res.status, 404);
    assert.deepEqual(res.json, { error: "Not Found" });
  });

  it("handles GET /health", async () => {
    const router = createRouter();
    router.addRoute({
      method: "GET",
      path: "/health",
      auth: "public",
      handler: async () => ({
        status: 200,
        json: { status: "ok" },
      }),
    });

    server = createHttpServer({
      port: TEST_PORT,
      router,
      db: createMockDb(),
      changes: createNoopChangeNotifier(),
      auth: createAuthMiddleware(),
      rateLimiter: createRateLimiter(),
      storage: createNoopStorage(),
    });
    await new Promise((r) => setTimeout(r, 50));

    const res = await fetch("/health");
    assert.equal(res.status, 200);
    assert.deepEqual(res.json, { status: "ok" });
  });

  it("parses JSON body for POST requests", async () => {
    const router = createRouter();
    let receivedBody: Record<string, unknown> = {};

    router.addRoute({
      method: "POST",
      path: "/echo",
      auth: "public",
      handler: async (ctx) => {
        receivedBody = ctx.body;
        return { status: 200, json: ctx.body };
      },
    });

    server = createHttpServer({
      port: TEST_PORT,
      router,
      db: createMockDb(),
      changes: createNoopChangeNotifier(),
      auth: createAuthMiddleware(),
      rateLimiter: createRateLimiter(),
      storage: createNoopStorage(),
    });
    await new Promise((r) => setTimeout(r, 50));

    const res = await fetch("/echo", {
      method: "POST",
      body: { message: "hello" },
    });
    assert.equal(res.status, 200);
    assert.deepEqual(res.json, { message: "hello" });
    assert.equal(receivedBody.message, "hello");
  });

  it("returns 401 for protected routes without auth", async () => {
    const router = createRouter();
    router.addRoute({
      method: "GET",
      path: "/protected",
      auth: { strategy: "some-auth" },
      handler: async () => ({
        status: 200,
        json: { secret: "data" },
      }),
    });

    server = createHttpServer({
      port: TEST_PORT,
      router,
      db: createMockDb(),
      changes: createNoopChangeNotifier(),
      auth: createAuthMiddleware(),
      rateLimiter: createRateLimiter(),
      storage: createNoopStorage(),
    });
    await new Promise((r) => setTimeout(r, 50));

    const res = await fetch("/protected");
    assert.equal(res.status, 401);
    assert.deepEqual(res.json, { error: "Unauthorized" });
  });

  it("returns 429 when rate limited", async () => {
    const router = createRouter();
    router.addRoute({
      method: "GET",
      path: "/limited",
      auth: "public",
      rateLimit: { windowMs: 60_000, max: 2 },
      handler: async () => ({ status: 200, json: { ok: true } }),
    });

    server = createHttpServer({
      port: TEST_PORT,
      router,
      db: createMockDb(),
      changes: createNoopChangeNotifier(),
      auth: createAuthMiddleware(),
      rateLimiter: createRateLimiter(),
      storage: createNoopStorage(),
    });
    await new Promise((r) => setTimeout(r, 50));

    await fetch("/limited");
    await fetch("/limited");
    const res = await fetch("/limited");
    assert.equal(res.status, 429);
    assert.deepEqual(res.json, { error: "Too Many Requests" });
    assert.ok(res.headers["retry-after"]);
  });

  it("returns 400 for invalid JSON body", async () => {
    const router = createRouter();
    router.addRoute({
      method: "POST",
      path: "/data",
      auth: "public",
      handler: async () => ({ status: 200, json: { ok: true } }),
    });

    server = createHttpServer({
      port: TEST_PORT,
      router,
      db: createMockDb(),
      changes: createNoopChangeNotifier(),
      auth: createAuthMiddleware(),
      rateLimiter: createRateLimiter(),
      storage: createNoopStorage(),
    });
    await new Promise((r) => setTimeout(r, 50));

    const res = await new Promise<{ status: number; json: unknown }>((resolve, reject) => {
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port: TEST_PORT,
          path: "/data",
          method: "POST",
          headers: { "Content-Type": "application/json" },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c: Buffer) => chunks.push(c));
          res.on("end", () => {
            resolve({
              status: res.statusCode!,
              json: JSON.parse(Buffer.concat(chunks).toString()),
            });
          });
        }
      );
      req.on("error", reject);
      req.write("not json{{{");
      req.end();
    });

    assert.equal(res.status, 400);
    assert.deepEqual(res.json, { error: "Invalid JSON body" });
  });

  it("returns 400 when validation fails", async () => {
    const router = createRouter();
    router.addRoute({
      method: "POST",
      path: "/validated",
      auth: "public",
      validate: (body: unknown) => {
        const b = body as Record<string, unknown>;
        return typeof b.name === "string" && b.name.length > 0;
      },
      handler: async () => ({ status: 200, json: { ok: true } }),
    });

    server = createHttpServer({
      port: TEST_PORT,
      router,
      db: createMockDb(),
      changes: createNoopChangeNotifier(),
      auth: createAuthMiddleware(),
      rateLimiter: createRateLimiter(),
      storage: createNoopStorage(),
    });
    await new Promise((r) => setTimeout(r, 50));

    const res = await fetch("/validated", {
      method: "POST",
      body: { name: "" },
    });
    assert.equal(res.status, 400);
    assert.deepEqual(res.json, { error: "Validation failed" });
  });

  it("extracts path params into handler context", async () => {
    const router = createRouter();
    let capturedParams: Record<string, string> = {};

    router.addRoute({
      method: "GET",
      path: "/users/:id",
      auth: "public",
      handler: async (ctx) => {
        capturedParams = ctx.params;
        return { status: 200, json: { id: ctx.params.id } };
      },
    });

    server = createHttpServer({
      port: TEST_PORT,
      router,
      db: createMockDb(),
      changes: createNoopChangeNotifier(),
      auth: createAuthMiddleware(),
      rateLimiter: createRateLimiter(),
      storage: createNoopStorage(),
    });
    await new Promise((r) => setTimeout(r, 50));

    const res = await fetch("/users/abc-123");
    assert.equal(res.status, 200);
    assert.deepEqual(res.json, { id: "abc-123" });
    assert.equal(capturedParams.id, "abc-123");
  });

  it("handles OPTIONS for CORS preflight", async () => {
    const router = createRouter();
    server = createHttpServer({
      port: TEST_PORT,
      router,
      db: createMockDb(),
      changes: createNoopChangeNotifier(),
      auth: createAuthMiddleware(),
      rateLimiter: createRateLimiter(),
      storage: createNoopStorage(),
      corsOrigin: "*",
    });
    await new Promise((r) => setTimeout(r, 50));

    const res = await fetch("/anything", { method: "OPTIONS" });
    assert.equal(res.status, 204);
    assert.equal(res.headers["access-control-allow-origin"], "*");
  });

  it("returns 500 when handler throws", async () => {
    const router = createRouter();
    router.addRoute({
      method: "GET",
      path: "/crash",
      auth: "public",
      handler: async () => {
        throw new Error("something broke");
      },
    });

    server = createHttpServer({
      port: TEST_PORT,
      router,
      db: createMockDb(),
      changes: createNoopChangeNotifier(),
      auth: createAuthMiddleware(),
      rateLimiter: createRateLimiter(),
      storage: createNoopStorage(),
    });
    await new Promise((r) => setTimeout(r, 50));

    const res = await fetch("/crash");
    assert.equal(res.status, 500);
    assert.deepEqual(res.json, { error: "Internal Server Error" });
  });
});
