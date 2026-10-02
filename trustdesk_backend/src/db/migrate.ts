import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "./pool.js";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "migrations");

export async function migrate(): Promise<void> {
  await pool.query(
    "CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())",
  );
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    const existing = await pool.query("SELECT id FROM schema_migrations WHERE id = $1", [file]);
    if (existing.rowCount) continue;
    const sql = fs.readFileSync(path.join(dir, file), "utf8");
    await pool.query(sql);
    await pool.query("INSERT INTO schema_migrations (id) VALUES ($1)", [file]);
  }
}

const isDirect = process.argv[1] && path.resolve(process.argv[1]).includes("migrate");
if (isDirect) {
  migrate()
    .then(async () => {
      console.log("migrations applied");
      await pool.end();
    })
    .catch(async (err) => {
      console.error(err);
      await pool.end();
      process.exit(1);
    });
}
