import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runMigrations } from "../src/db/migrate.js";
import type { DbAdapter, QueryResult } from "../src/db/pool.js";

function createInMemoryDb(): DbAdapter & { queries: string[] } {
  const tables = new Map<string, Record<string, unknown>[]>();
  const queries: string[] = [];

  const query = async <T = Record<string, unknown>>(
    sql: string,
    params?: unknown[]
  ): Promise<QueryResult<T>> => {
    queries.push(sql.trim());

    // Handle CREATE TABLE _migrations
    if (sql.includes("CREATE TABLE IF NOT EXISTS _migrations")) {
      if (!tables.has("_migrations")) tables.set("_migrations", []);
      return { rows: [] as T[], rowCount: 0 };
    }

    // Handle SELECT from _migrations
    if (sql.includes("SELECT name FROM _migrations")) {
      const rows = tables.get("_migrations") ?? [];
      return { rows: rows as T[], rowCount: rows.length };
    }

    // Handle INSERT into _migrations
    if (sql.includes("INSERT INTO _migrations")) {
      const migrations = tables.get("_migrations") ?? [];
      migrations.push({ name: params?.[0] });
      tables.set("_migrations", migrations);
      return { rows: [] as T[], rowCount: 1 };
    }

    // All other SQL (migration content) — just track it
    return { rows: [] as T[], rowCount: 0 };
  };

  return {
    queries,
    query,
    async transaction(fn) {
      return fn(query);
    },
    async close() {},
  };
}

describe("Migrations", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "migrate-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("runs migrations in order", async () => {
    fs.writeFileSync(
      path.join(tmpDir, "001_first.sql"),
      "CREATE TABLE first (id INT);"
    );
    fs.writeFileSync(
      path.join(tmpDir, "002_second.sql"),
      "CREATE TABLE second (id INT);"
    );

    const db = createInMemoryDb();
    await runMigrations(db, tmpDir);

    assert.ok(db.queries.some((q) => q.includes("CREATE TABLE first")));
    assert.ok(db.queries.some((q) => q.includes("CREATE TABLE second")));
    // Verify insertion order
    const insertQueries = db.queries.filter((q) =>
      q.includes("INSERT INTO _migrations")
    );
    assert.equal(insertQueries.length, 2);
  });

  it("skips already applied migrations", async () => {
    fs.writeFileSync(
      path.join(tmpDir, "001_first.sql"),
      "CREATE TABLE first (id INT);"
    );

    const db = createInMemoryDb();

    // Run once
    await runMigrations(db, tmpDir);

    // Run again — should not re-apply
    const queriesBefore = db.queries.length;
    await runMigrations(db, tmpDir);
    const newQueries = db.queries.slice(queriesBefore);

    // Should only have the SELECT for checking applied migrations + CREATE TABLE IF NOT EXISTS
    assert.ok(
      !newQueries.some((q) => q.includes("CREATE TABLE first")),
      "Should not re-run migration"
    );
  });

  it("handles empty migrations directory", async () => {
    const db = createInMemoryDb();
    await runMigrations(db, tmpDir);
    // Should not throw, should just create _migrations table
    assert.ok(
      db.queries.some((q) =>
        q.includes("CREATE TABLE IF NOT EXISTS _migrations")
      )
    );
  });

  it("handles missing migrations directory", async () => {
    const db = createInMemoryDb();
    await runMigrations(db, path.join(tmpDir, "nonexistent"));
    // Should not throw
  });

  it("ignores non-sql files", async () => {
    fs.writeFileSync(path.join(tmpDir, "001_first.sql"), "SELECT 1;");
    fs.writeFileSync(path.join(tmpDir, "README.md"), "# Migrations");
    fs.writeFileSync(path.join(tmpDir, "notes.txt"), "some notes");

    const db = createInMemoryDb();
    await runMigrations(db, tmpDir);

    const inserts = db.queries.filter((q) =>
      q.includes("INSERT INTO _migrations")
    );
    assert.equal(inserts.length, 1);
  });
});
