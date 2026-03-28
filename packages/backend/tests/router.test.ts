import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRouter } from "../src/server/router.js";

const stubHandler = async () => ({ status: 200, json: { ok: true } });

describe("Router", () => {
  it("matches exact paths", () => {
    const router = createRouter();
    router.addRoute({
      method: "GET",
      path: "/health",
      auth: "public",
      handler: stubHandler,
    });

    const result = router.match("GET", "/health");
    assert.ok(result);
    assert.equal(result.route.path, "/health");
    assert.deepEqual(result.params, {});
  });

  it("returns null for unmatched paths", () => {
    const router = createRouter();
    router.addRoute({
      method: "GET",
      path: "/health",
      auth: "public",
      handler: stubHandler,
    });

    assert.equal(router.match("GET", "/unknown"), null);
  });

  it("returns null for wrong method", () => {
    const router = createRouter();
    router.addRoute({
      method: "GET",
      path: "/health",
      auth: "public",
      handler: stubHandler,
    });

    assert.equal(router.match("POST", "/health"), null);
  });

  it("extracts path parameters", () => {
    const router = createRouter();
    router.addRoute({
      method: "GET",
      path: "/users/:id",
      auth: "public",
      handler: stubHandler,
    });

    const result = router.match("GET", "/users/42");
    assert.ok(result);
    assert.equal(result.params.id, "42");
  });

  it("extracts multiple path parameters", () => {
    const router = createRouter();
    router.addRoute({
      method: "GET",
      path: "/rooms/:roomId/messages/:messageId",
      auth: "public",
      handler: stubHandler,
    });

    const result = router.match("GET", "/rooms/abc/messages/123");
    assert.ok(result);
    assert.equal(result.params.roomId, "abc");
    assert.equal(result.params.messageId, "123");
  });

  it("decodes URI-encoded path parameters", () => {
    const router = createRouter();
    router.addRoute({
      method: "GET",
      path: "/users/:name",
      auth: "public",
      handler: stubHandler,
    });

    const result = router.match("GET", "/users/hello%20world");
    assert.ok(result);
    assert.equal(result.params.name, "hello world");
  });

  it("strips query string before matching", () => {
    const router = createRouter();
    router.addRoute({
      method: "GET",
      path: "/search",
      auth: "public",
      handler: stubHandler,
    });

    const result = router.match("GET", "/search?q=test&page=1");
    assert.ok(result);
    assert.equal(result.route.path, "/search");
  });

  it("does not match partial paths", () => {
    const router = createRouter();
    router.addRoute({
      method: "GET",
      path: "/users",
      auth: "public",
      handler: stubHandler,
    });

    assert.equal(router.match("GET", "/users/123"), null);
    assert.equal(router.match("GET", "/users/"), null);
  });

  it("matches first registered route on conflict", () => {
    const router = createRouter();
    router.addRoute({
      method: "GET",
      path: "/items/:id",
      auth: "public",
      handler: stubHandler,
    });
    router.addRoute({
      method: "GET",
      path: "/items/special",
      auth: "public",
      handler: stubHandler,
    });

    const result = router.match("GET", "/items/special");
    assert.ok(result);
    // First route wins — :id captures "special"
    assert.equal(result.route.path, "/items/:id");
    assert.equal(result.params.id, "special");
  });
});
