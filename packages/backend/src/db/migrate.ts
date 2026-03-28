import fs from "node:fs";
import path from "node:path";
import type { DbAdapter } from "./pool.js";

export async function runMigrations(
  db: DbAdapter,
  migrationsDir: string
): Promise<void> {
  await db.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const applied = await db.query<{ name: string }>(
    "SELECT name FROM _migrations ORDER BY name"
  );
  const appliedSet = new Set(applied.rows.map((r) => r.name));

  const absoluteDir = path.resolve(migrationsDir);
  if (!fs.existsSync(absoluteDir)) {
    console.log("[migrate] No migrations directory found, skipping");
    return;
  }

  const files = fs
    .readdirSync(absoluteDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    if (appliedSet.has(file)) continue;

    const sql = fs.readFileSync(path.join(absoluteDir, file), "utf-8");
    await db.transaction(async (query) => {
      await query(sql);
      await query("INSERT INTO _migrations (name) VALUES ($1)", [file]);
    });
    console.log(`[migrate] Applied: ${file}`);
  }
}
