import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createRouter } from "../src/server/router.js";
import { createHttpServer } from "../src/server/http.js";
import { createAuthMiddleware } from "../src/auth/middleware.js";
import { createRateLimiter } from "../src/rate-limit/limiter.js";
import { createNoopChangeNotifier } from "../src/db/changes.js";
import { createUploadRoutes } from "../src/app/routes/uploads.js";
import type { DbAdapter, QueryFn, QueryResult } from "../src/db/pool.js";
import type { StorageAdapter } from "../src/storage/types.js";
import type { AuthStrategy } from "../src/auth/types.js";

const TEST_PORT = 9877;

function createMockStorage(): StorageAdapter {
  const uploaded = new Set<string>();
  return {
    async getSignedUploadUrl(key, contentType) {
      uploaded.add(key);
      return `https://fake-r2.example.com/upload/${key}?ct=${contentType}`;
    },
    async getSignedUrl(key) {
      return `https://fake-r2.example.com/download/${key}`;
    },
    async exists(key) {
      return uploaded.has(key);
    },
    async delete() {},
  };
}

// Tracks inserted rows and answers queries
function createUploadsMockDb(): DbAdapter & { inserted: unknown[][] } {
  const inserted: unknown[][] = [];
  const rows: Record<
    string,
    {
      key: string;
      user_id: string;
      filename: string;
      content_type: string;
      status: "pending" | "completed" | "failed" | "deleting";
      upload_expires_at: string;
      completed_at: string | null;
      created_at: string;
    }
  > = {};

  const toResult = <T>(
    values: unknown[],
    rowCount = values.length
  ): QueryResult<T> => ({
    rows: values as T[],
    rowCount,
  });

  const query: QueryFn = async <T = Record<string, unknown>>(
    sql: string,
    params?: unknown[]
  ): Promise<QueryResult<T>> => {
    const text = sql.trim().toLowerCase();

    if (text.startsWith("insert into uploads")) {
      const [key, userId, filename, contentType] = params as string[];
      rows[key] = {
        key,
        user_id: userId,
        filename,
        content_type: contentType,
        status: "pending",
        upload_expires_at: new Date(Date.now() + 5 * 60_000).toISOString(),
        completed_at: null,
        created_at: new Date().toISOString(),
      };
      inserted.push(params as unknown[]);
      return toResult<T>([rows[key]], 1);
    }

    if (
      text.startsWith("select") &&
      text.includes("from uploads") &&
      text.includes("where user_id")
    ) {
      const userId = params?.[0] as string;
      const userRows = Object.values(rows).filter(
        (r) =>
          r.user_id === userId &&
          (!text.includes("status = 'completed'") || r.status === "completed") &&
          (!text.includes("status = 'deleting'") || r.status === "deleting")
      );
      return toResult<T>(userRows, userRows.length);
    }

    if (text.startsWith("select") && text.includes("from uploads")) {
      const key = params?.[0] as string;
      const userId = params?.[1] as string | undefined;
      const row = rows[key];
      if (!row) return toResult<T>([], 0);
      if (userId && row.user_id !== userId) return toResult<T>([], 0);
      if (text.includes("status = 'completed'") && row.status !== "completed") {
        return toResult<T>([], 0);
      }
      if (text.includes("status = 'deleting'") && row.status !== "deleting") {
        return toResult<T>([], 0);
      }
      if (text.includes("select status, upload_expires_at")) {
        return toResult<T>(
          [
            {
              status: row.status,
              upload_expires_at: row.upload_expires_at,
            },
          ],
          1
        );
      }
      return toResult<T>([row], 1);
    }

    if (text.startsWith("update uploads") && text.includes("set status = 'completed'")) {
      const key = params?.[0] as string;
      const userId = params?.[1] as string;
      const row = rows[key];
      if (!row || row.user_id !== userId) return toResult<T>([], 0);
      row.status = "completed";
      row.completed_at = new Date().toISOString();
      return toResult<T>([row], 1);
    }

    if (text.startsWith("update uploads") && text.includes("set status = 'deleting'")) {
      const key = params?.[0] as string;
      const userId = params?.[1] as string;
      const row = rows[key];
      if (!row || row.user_id !== userId || row.status === "deleting") {
        return toResult<T>([], 0);
      }
      row.status = "deleting";
      return toResult<T>([row], 1);
    }

    if (text.startsWith("delete from uploads") && text.includes("status = 'pending'")) {
      const userId = params?.[0] as string;
      const deleted: unknown[] = [];
      for (const [k, r] of Object.entries(rows)) {
        if (r.user_id === userId && r.status === "pending" && new Date(r.upload_expires_at).getTime() < Date.now()) {
          deleted.push({ key: k });
          delete rows[k];
        }
      }
      return toResult<T>(deleted, deleted.length);
    }

    if (text.startsWith("delete from uploads")) {
      const key = params?.[0] as string;
      const userId = params?.[1] as string;
      const row = rows[key];
      if (row && row.user_id === userId) {
        delete rows[key];
        return toResult<T>([{ key }], 1);
      }
      return toResult<T>([], 0);
    }

    return toResult<T>([], 0);
  };

  return {
    inserted,
    query,
    async transaction(fn) {
      const noopQuery: QueryFn = async <T = Record<string, unknown>>() =>
        toResult<T>([], 0);
      return fn(noopQuery);
    },
    async close() {},
  };
}

// Simple auth strategy that trusts a header
function createTestAuthStrategy(): AuthStrategy {
  return {
    name: "test-auth",
    async authenticate(req) {
      const userId = req.headers["x-test-user"] as string | undefined;
      if (!userId) return null;
      return { userId, strategy: "test-auth" };
    },
  };
}

function fetch(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    headers?: Record<string, string>;
  } = {}
): Promise<{
  status: number;
  json: unknown;
  headers: http.IncomingHttpHeaders;
}> {
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

describe("Upload Routes", () => {
  let server: http.Server;

  afterEach(() => {
    return new Promise<void>((resolve) => {
      if (server) server.close(() => resolve());
      else resolve();
    });
  });

  function setup(storage?: StorageAdapter) {
    const db = createUploadsMockDb();
    const auth = createAuthMiddleware();
    auth.registerStrategy(createTestAuthStrategy());

    const router = createRouter();
    for (const route of createUploadRoutes({
      auth: { strategy: "test-auth" },
    })) {
      router.addRoute(route);
    }

    server = createHttpServer({
      port: TEST_PORT,
      router,
      db,
      changes: createNoopChangeNotifier(),
      auth,
      rateLimiter: createRateLimiter(),
      storage: storage ?? createMockStorage(),
    });

    return { db };
  }

  async function prepareUpload(userId: string, filename = "shot.png") {
    const res = await fetch("/uploads", {
      method: "POST",
      body: { contentType: "image/png", filename, fileSize: 1024 },
      headers: { "x-test-user": userId },
    });
    assert.equal(res.status, 200);
    return (res.json as { key: string }).key;
  }

  async function completeUpload(userId: string, key: string) {
    const res = await fetch(`/uploads/${key}/complete`, {
      method: "POST",
      headers: { "x-test-user": userId },
    });
    return res;
  }

  it("lists user uploads", async () => {
    setup();
    await new Promise((r) => setTimeout(r, 50));

    // Prepare + complete two files
    const key1 = await prepareUpload("user-1", "a.png");
    await completeUpload("user-1", key1);
    const key2 = await prepareUpload("user-1", "b.jpg");
    await completeUpload("user-1", key2);

    // Different user upload (pending only)
    await prepareUpload("user-2", "c.png");

    // List user-1's uploads
    const res = await fetch("/uploads", {
      headers: { "x-test-user": "user-1" },
    });

    assert.equal(res.status, 200);
    const list = res.json as { key: string; filename: string }[];
    assert.equal(list.length, 2);
  });

  it("does not list pending uploads before completion", async () => {
    setup();
    await new Promise((r) => setTimeout(r, 50));

    await prepareUpload("user-1", "pending.png");

    const listRes = await fetch("/uploads", {
      headers: { "x-test-user": "user-1" },
    });

    assert.equal(listRes.status, 200);
    const list = listRes.json as { key: string; filename: string }[];
    assert.equal(list.length, 0);
  });

  it("returns presigned upload URL for valid request", async () => {
    const { db } = setup();
    await new Promise((r) => setTimeout(r, 50));

    const res = await fetch("/uploads", {
      method: "POST",
      body: { contentType: "image/png", filename: "shot.png", fileSize: 1024 },
      headers: { "x-test-user": "user-1" },
    });

    assert.equal(res.status, 200);
    const body = res.json as { key: string; uploadUrl: string };
    assert.ok(body.key.length > 0);
    assert.ok(body.uploadUrl.includes("fake-r2.example.com/upload/"));
    assert.equal(db.inserted.length, 1);
  });

  it("rejects invalid content type", async () => {
    setup();
    await new Promise((r) => setTimeout(r, 50));

    const res = await fetch("/uploads", {
      method: "POST",
      body: { contentType: "application/exe", filename: "bad.exe", fileSize: 1024 },
      headers: { "x-test-user": "user-1" },
    });

    assert.equal(res.status, 400);
    assert.ok(
      (res.json as { error: string }).error.includes("Content type not allowed")
    );
  });

  it("rejects missing fields", async () => {
    setup();
    await new Promise((r) => setTimeout(r, 50));

    const res = await fetch("/uploads", {
      method: "POST",
      body: { contentType: "image/png" },
      headers: { "x-test-user": "user-1" },
    });

    assert.equal(res.status, 400);
    assert.ok(
      (res.json as { error: string }).error.includes("Missing required fields")
    );
  });

  it("rejects oversized files", async () => {
    setup();
    await new Promise((r) => setTimeout(r, 50));

    const res = await fetch("/uploads", {
      method: "POST",
      body: {
        contentType: "image/png",
        filename: "large.png",
        fileSize: 50 * 1024 * 1024,
      },
      headers: { "x-test-user": "user-1" },
    });

    assert.equal(res.status, 413);
    assert.ok((res.json as { error: string }).error.includes("File too large"));
  });

  it("returns 401 without auth", async () => {
    setup();
    await new Promise((r) => setTimeout(r, 50));

    const res = await fetch("/uploads", {
      method: "POST",
      body: { contentType: "image/png", filename: "shot.png", fileSize: 1024 },
    });

    assert.equal(res.status, 401);
  });

  it("returns signed download URL", async () => {
    setup();
    await new Promise((r) => setTimeout(r, 50));

    const key = await prepareUpload("user-1");
    const completeRes = await completeUpload("user-1", key);
    assert.equal(completeRes.status, 200);

    // Then get download URL
    const res = await fetch(`/uploads/${key}`, {
      headers: { "x-test-user": "user-1" },
    });

    assert.equal(res.status, 200);
    const body = res.json as { url: string };
    assert.ok(body.url.includes("fake-r2.example.com/download/"));
  });

  it("returns 404 for nonexistent upload", async () => {
    setup();
    await new Promise((r) => setTimeout(r, 50));

    const res = await fetch("/uploads/nonexistent-key", {
      headers: { "x-test-user": "user-1" },
    });

    assert.equal(res.status, 404);
  });

  it("returns 404 for pending upload download request", async () => {
    setup();
    await new Promise((r) => setTimeout(r, 50));

    const key = await prepareUpload("user-1");
    const res = await fetch(`/uploads/${key}`, {
      headers: { "x-test-user": "user-1" },
    });

    assert.equal(res.status, 404);
  });

  it("completes upload for owner only", async () => {
    setup();
    await new Promise((r) => setTimeout(r, 50));

    const key = await prepareUpload("user-1");

    const badRes = await completeUpload("user-2", key);
    assert.equal(badRes.status, 404);

    const okRes = await completeUpload("user-1", key);
    assert.equal(okRes.status, 200);
    assert.deepEqual(okRes.json, { ok: true });
  });

  it("allows owner to delete", async () => {
    setup();
    await new Promise((r) => setTimeout(r, 50));

    // Upload
    const uploadRes = await fetch("/uploads", {
      method: "POST",
      body: { contentType: "image/png", filename: "shot.png", fileSize: 1024 },
      headers: { "x-test-user": "user-1" },
    });
    const { key } = uploadRes.json as { key: string };

    // Delete
    const res = await fetch(`/uploads/${key}`, {
      method: "DELETE",
      headers: { "x-test-user": "user-1" },
    });

    assert.equal(res.status, 200);
    assert.deepEqual(res.json, { ok: true });
  });

  it("returns 404 when non-owner tries to delete", async () => {
    setup();
    await new Promise((r) => setTimeout(r, 50));

    // Upload as user-1
    const uploadRes = await fetch("/uploads", {
      method: "POST",
      body: { contentType: "image/png", filename: "shot.png", fileSize: 1024 },
      headers: { "x-test-user": "user-1" },
    });
    const { key } = uploadRes.json as { key: string };

    // Delete as user-2
    const res = await fetch(`/uploads/${key}`, {
      method: "DELETE",
      headers: { "x-test-user": "user-2" },
    });

    assert.equal(res.status, 404);
  });

  it("marks as deleting when storage delete fails", async () => {
    const uploaded = new Set<string>();
    const flakyDeleteStorage: StorageAdapter = {
      async getSignedUploadUrl(key, contentType) {
        uploaded.add(key);
        return `https://fake-r2.example.com/upload/${key}?ct=${contentType}`;
      },
      async getSignedUrl(key) {
        return `https://fake-r2.example.com/download/${key}`;
      },
      async exists(key) {
        return uploaded.has(key);
      },
      async delete() {
        throw new Error("temporary storage failure");
      },
    };

    setup(flakyDeleteStorage);
    await new Promise((r) => setTimeout(r, 50));

    const key = await prepareUpload("user-1");
    await completeUpload("user-1", key);

    const firstDelete = await fetch(`/uploads/${key}`, {
      method: "DELETE",
      headers: { "x-test-user": "user-1" },
    });
    assert.equal(firstDelete.status, 200);
    assert.deepEqual(firstDelete.json, { ok: true, deleting: true });

    // Not visible in listing (status is deleting, not completed)
    const listRes = await fetch("/uploads", {
      headers: { "x-test-user": "user-1" },
    });
    assert.equal(listRes.status, 200);
    assert.equal((listRes.json as unknown[]).length, 0);

    // Not downloadable
    const getRes = await fetch(`/uploads/${key}`, {
      headers: { "x-test-user": "user-1" },
    });
    assert.equal(getRes.status, 404);

    // Repeat delete returns ok (already deleting)
    const secondDelete = await fetch(`/uploads/${key}`, {
      method: "DELETE",
      headers: { "x-test-user": "user-1" },
    });
    assert.equal(secondDelete.status, 200);
    assert.deepEqual(secondDelete.json, { ok: true, deleting: true });
  });
});
