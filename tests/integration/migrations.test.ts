import { readFile } from "node:fs/promises";
import path from "node:path";
import { createSql, migrate } from "@solomad/db";
import { afterAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.DATABASE_URL ?? "postgres://solomad:solomad@127.0.0.1:5432/solomad";
const adminUrl = databaseUrl.replace(/\/[^/]+$/, "/postgres");

async function recreate(name: string) {
  const admin = createSql(adminUrl, 1);
  await admin.unsafe(`DROP DATABASE IF EXISTS ${name}`);
  await admin.unsafe(`CREATE DATABASE ${name}`);
  await admin.end();
  return databaseUrl.replace(/\/[^/]+$/, `/${name}`);
}

describe("migrations", () => {
  const created: string[] = [];

  afterAll(async () => {
    const admin = createSql(adminUrl, 1);
    for (const name of created) await admin.unsafe(`DROP DATABASE IF EXISTS ${name}`);
    await admin.end();
  });

  it("migrates an empty database", async () => {
    created.push("solomad_empty");
    const url = await recreate("solomad_empty");
    const applied = await migrate(url);
    expect(applied).toEqual(["0000_init.sql", "0001_user_locale.sql", "0002_supabase_identities.sql"]);
    const sql = createSql(url, 1);
    const version = await sql`SELECT postgis_full_version()`;
    expect(version.length).toBe(1);
    await sql.end();
  });

  it("upgrades a database that only has the initial schema", async () => {
    created.push("solomad_upgrade");
    const url = await recreate("solomad_upgrade");
    const sql = createSql(url, 1);
    await sql`CREATE TABLE schema_migrations (id text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`;
    const init = await readFile(path.join(__dirname, "../../packages/db/migrations/0000_init.sql"), "utf8");
    await sql.unsafe(init);
    await sql`INSERT INTO schema_migrations (id) VALUES ('0000_init.sql')`;
    const missing = await sql<{ exists: boolean }[]>`
      SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'locale') AS exists
    `;
    expect(missing[0]?.exists).toBe(false);
    await sql.end();
    const applied = await migrate(url);
    expect(applied).toEqual(["0001_user_locale.sql", "0002_supabase_identities.sql"]);
    const check = createSql(url, 1);
    const present = await check<{ exists: boolean }[]>`
      SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'locale') AS exists
    `;
    expect(present[0]?.exists).toBe(true);
    await check.end();
  });

  it("keeps legacy identities and internal user ids when Supabase subjects are added", async () => {
    created.push("solomad_identity");
    const url = await recreate("solomad_identity");
    const sql = createSql(url, 1);
    await sql`CREATE TABLE schema_migrations (id text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`;
    for (const file of ["0000_init.sql", "0001_user_locale.sql"]) {
      await sql.unsafe(await readFile(path.join(__dirname, "../../packages/db/migrations", file), "utf8"));
      await sql`INSERT INTO schema_migrations (id) VALUES (${file})`;
    }
    const [user] = await sql<{ id: string }[]>`INSERT INTO users (onboarding_step) VALUES ('name') RETURNING id`;
    await sql`INSERT INTO identities (user_id, provider, provider_subject, email) VALUES (${user!.id}, 'apple', 'legacy-subject', 'same@solomad.test')`;
    await sql.end();
    expect(await migrate(url)).toEqual(["0002_supabase_identities.sql"]);
    const after = createSql(url, 1);
    await after`INSERT INTO identities (user_id, provider, provider_subject) VALUES (${user!.id}, 'supabase', '00000000-0000-4000-8000-000000000001')`;
    const rows = await after<{ provider: string; user_id: string }[]>`SELECT provider, user_id FROM identities ORDER BY provider`;
    expect(rows).toEqual([
      { provider: "apple", user_id: user!.id },
      { provider: "supabase", user_id: user!.id },
    ]);
    await expect(after`INSERT INTO identities (user_id, provider, provider_subject) VALUES (${user!.id}, 'firebase', 'x')`).rejects.toThrow();
    await after.end();
  });
});
