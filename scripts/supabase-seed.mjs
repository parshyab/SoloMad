import { randomBytes } from "node:crypto";
import { appendFileSync, readFileSync } from "node:fs";
import postgres from "../packages/db/node_modules/postgres/cjs/src/index.js";
import { captureLocalSupabase, readLocalSupabase } from "./supabase-env.mjs";

const env = Object.fromEntries(
  readFileSync(".env", "utf8")
    .split("\n")
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
);

// Local development accounts only. They are created in the local Supabase CLI stack, never a hosted project.
const accounts = [
  { key: "MINA", email: "mina@solomad.test", userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1", legacy: "dev:mina" },
  { key: "JONAH", email: "jonah@solomad.test", userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2", legacy: "dev:jonah" },
  { key: "LEILA", email: "leila@solomad.test", userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3", legacy: "dev:leila" },
];

let local = readLocalSupabase();
if (!local?.SUPABASE_SECRET_KEY) local = { ...local, ...captureLocalSupabase() };
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(local.SUPABASE_URL)) {
  console.error("supabase-seed refuses to run against a non-local SUPABASE_URL");
  process.exit(1);
}
if (!local.SOLOMAD_LOCAL_PASSWORD) {
  local.SOLOMAD_LOCAL_PASSWORD = `local-${randomBytes(12).toString("base64url")}`;
  appendFileSync(".env.supabase.local", `SOLOMAD_LOCAL_PASSWORD=${local.SOLOMAD_LOCAL_PASSWORD}\n`);
}

const admin = {
  apikey: local.SUPABASE_SECRET_KEY,
  authorization: `Bearer ${local.SUPABASE_SECRET_KEY}`,
  "content-type": "application/json",
};

async function findUser(email) {
  for (let page = 1; page < 20; page += 1) {
    const response = await fetch(`${local.SUPABASE_URL}/auth/v1/admin/users?page=${page}&per_page=200`, { headers: admin });
    if (!response.ok) throw new Error(`admin list failed with ${response.status}`);
    const body = await response.json();
    const match = body.users.find((user) => user.email === email);
    if (match) return match;
    if (body.users.length < 200) return null;
  }
  return null;
}

const sql = postgres(env.DATABASE_URL, { max: 1 });
try {
  for (const account of accounts) {
    let user = await findUser(account.email);
    if (!user) {
      const response = await fetch(`${local.SUPABASE_URL}/auth/v1/admin/users`, {
        method: "POST",
        headers: admin,
        body: JSON.stringify({
          email: account.email,
          password: local.SOLOMAD_LOCAL_PASSWORD,
          email_confirm: true,
          user_metadata: { solomad_seed: true },
        }),
      });
      if (!response.ok) throw new Error(`create ${account.email} failed with ${response.status}`);
      user = await response.json();
    } else {
      await fetch(`${local.SUPABASE_URL}/auth/v1/admin/users/${user.id}`, {
        method: "PUT",
        headers: admin,
        body: JSON.stringify({ password: local.SOLOMAD_LOCAL_PASSWORD, ban_duration: "none" }),
      });
    }
    await sql.begin(async (tx) => {
      await tx`
        INSERT INTO identities (user_id, provider, provider_subject, email)
        VALUES (${account.userId}, 'supabase', ${user.id}, ${account.email})
        ON CONFLICT (provider, provider_subject) DO NOTHING
      `;
      await tx`
        INSERT INTO identity_migrations (user_id, legacy_provider, legacy_subject, supabase_subject, method)
        VALUES (${account.userId}, 'apple', ${account.legacy}, ${user.id}, 'development_seed')
        ON CONFLICT DO NOTHING
      `;
    });
    const [linked] = await sql`SELECT user_id FROM identities WHERE provider = 'supabase' AND provider_subject = ${user.id}`;
    if (linked?.user_id !== account.userId) throw new Error(`${account.email} is linked to a different application user`);
    console.log(`linked ${account.email} -> application user ${account.userId}`);
  }
} finally {
  await sql.end();
}
console.log("local password is stored in .env.supabase.local as SOLOMAD_LOCAL_PASSWORD (not printed)");
