import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { createSql } from "./client";

export async function migrate(databaseUrl: string, migrationsDir = path.join(__dirname, "..", "migrations")): Promise<string[]> {
  const sql = createSql(databaseUrl, 1);
  const applied: string[] = [];
  try {
    await sql`CREATE TABLE IF NOT EXISTS schema_migrations (
      id text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`;
    const files = (await readdir(migrationsDir)).filter((name) => name.endsWith(".sql")).sort();
    for (const file of files) {
      const rows = await sql<{ id: string }[]>`SELECT id FROM schema_migrations WHERE id = ${file}`;
      if (rows.length > 0) continue;
      const body = await readFile(path.join(migrationsDir, file), "utf8");
      await sql.begin(async (tx) => {
        await tx.unsafe(body);
        await tx`INSERT INTO schema_migrations (id) VALUES (${file})`;
      });
      applied.push(file);
    }
    return applied;
  } finally {
    await sql.end();
  }
}

if (require.main === module) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }
  migrate(databaseUrl)
    .then((applied) => {
      console.log(applied.length ? `applied ${applied.join(", ")}` : "migrations up to date");
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    });
}
