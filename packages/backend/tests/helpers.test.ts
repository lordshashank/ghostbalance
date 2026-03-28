import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseCursor, cursorResponse, blockFilterSql } from "../src/app/helpers.js";

describe("Helpers", () => {
  describe("parseCursor", () => {
    it("returns defaults when no params", () => {
      const params = new URLSearchParams();
      const { cursor, limit } = parseCursor(params);
      assert.equal(cursor, null);
      assert.equal(limit, 20);
    });

    it("parses cursor and limit from params", () => {
      const params = new URLSearchParams("cursor=2024-01-01&limit=10");
      const { cursor, limit } = parseCursor(params);
      assert.equal(cursor, "2024-01-01");
      assert.equal(limit, 10);
    });

    it("clamps limit to max", () => {
      const params = new URLSearchParams("limit=999");
      const { limit } = parseCursor(params);
      assert.equal(limit, 50);
    });

    it("uses default for invalid limit", () => {
      const params = new URLSearchParams("limit=abc");
      const { limit } = parseCursor(params);
      assert.equal(limit, 20);
    });

    it("uses default for negative limit", () => {
      const params = new URLSearchParams("limit=-5");
      const { limit } = parseCursor(params);
      assert.equal(limit, 20);
    });
  });

  describe("cursorResponse", () => {
    it("returns all rows and null cursor when under limit", () => {
      const rows = [{ id: 1, created_at: "a" }, { id: 2, created_at: "b" }];
      const result = cursorResponse(rows, 5, (r) => r.created_at);
      assert.equal(result.data.length, 2);
      assert.equal(result.next_cursor, null);
    });

    it("pops last row and returns cursor when over limit", () => {
      const rows = [
        { id: 1, created_at: "a" },
        { id: 2, created_at: "b" },
        { id: 3, created_at: "c" },
      ];
      const result = cursorResponse(rows, 2, (r) => r.created_at);
      assert.equal(result.data.length, 2);
      assert.equal(result.next_cursor, "b");
    });

    it("returns empty data and null cursor for empty rows", () => {
      const result = cursorResponse([], 20, () => "");
      assert.equal(result.data.length, 0);
      assert.equal(result.next_cursor, null);
    });
  });

  describe("blockFilterSql", () => {
    it("generates SQL clause with correct param index", () => {
      const { clause, params } = blockFilterSql("0xabc", 3);
      assert.ok(clause.includes("$3"));
      assert.deepEqual(params, ["0xabc"]);
    });
  });
});
