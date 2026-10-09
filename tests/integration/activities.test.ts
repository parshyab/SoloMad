import { randomUUID } from "node:crypto";
import { cities, createSql, migrate } from "@solomad/db";
import { DomainError, joinActivity, leaveActivity, sendMessage, sharedDates } from "@solomad/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Sql } from "postgres";

const databaseUrl = process.env.DATABASE_URL ?? "postgres://solomad:solomad@127.0.0.1:5432/solomad";
let sql: Sql;

beforeAll(async () => {
  await migrate(databaseUrl);
  sql = createSql(databaseUrl);
  await sql`SELECT postgis_full_version()`;
  await sql`INSERT INTO countries (code, name) VALUES ('PT', 'Portugal') ON CONFLICT DO NOTHING`;
  await sql`
    INSERT INTO cities (id, country_code, name, slug, timezone, location)
    VALUES (${cities.lisbon}, 'PT', 'Lisbon', 'lisbon', 'Europe/Lisbon', ST_SetSRID(ST_MakePoint(-9.1393, 38.7223), 4326)::geography)
    ON CONFLICT DO NOTHING
  `;
});

afterAll(async () => {
  await sql.end();
});

describe("activity capacity", () => {
  it("gives the final place to one of two concurrent joins and ignores duplicate retries", async () => {
    const host = randomUUID();
    const first = randomUUID();
    const second = randomUUID();
    for (const id of [host, first, second]) {
      await sql`INSERT INTO users (id, status, onboarding_step, onboarding_completed_at, birth_date, adult_eligible) VALUES (${id}, 'active', 'complete', now(), '1992-01-01', true)`;
      await sql`INSERT INTO profiles (user_id, display_name) VALUES (${id}, 'Traveler')`;
      await sql`INSERT INTO preferences (user_id) VALUES (${id})`;
      await sql`INSERT INTO entitlements (user_id) VALUES (${id})`;
    }
    const starts = new Date(Date.now() + 86_400_000);
    const [activity] = await sql<{ id: string }[]>`
      INSERT INTO activities (host_user_id, city_id, category, emoji, title, description, starts_at, timezone, meeting_point, capacity, going_count, status)
      VALUES (${host}, ${cities.lisbon}, 'food', '🍝', 'final seat', 'test', ${starts}, 'Europe/Lisbon', ST_SetSRID(ST_MakePoint(-9.13, 38.71), 4326)::geography, 2, 1, 'published')
      RETURNING id
    `;
    const activityId = activity?.id ?? "";
    await sql`INSERT INTO activity_memberships (activity_id, user_id, status) VALUES (${activityId}, ${host}, 'host')`;
    await sql`INSERT INTO conversations (kind, activity_id, city_id, title) VALUES ('activity', ${activityId}, ${cities.lisbon}, 'final seat')`;

    const results = await Promise.allSettled([
      joinActivity(sql, { userId: first, activityId, idempotencyKey: `join-${first}` }),
      joinActivity(sql, { userId: second, activityId, idempotencyKey: `join-${second}` }),
    ]);
    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(DomainError);
    expect(((rejected[0] as PromiseRejectedResult).reason as DomainError).code).toBe("full");

    const retry = await joinActivity(sql, { userId: first, activityId, idempotencyKey: `join-${first}` });
    expect(retry.replayed).toBe(true);
    const counts = await sql<{ going_count: number }[]>`SELECT going_count FROM activities WHERE id = ${activityId}`;
    expect(counts[0]?.going_count).toBe(2);

    const winner = fulfilled[0].status === "fulfilled" ? fulfilled[0].value.body : null;
    const winnerId = winner && "alreadyMember" in winner ? (results[0].status === "fulfilled" ? first : second) : first;
    const joinedUser = results[0].status === "fulfilled" ? first : second;
    await leaveActivity(sql, { userId: joinedUser, activityId });
    const after = await sql<{ going_count: number }[]>`SELECT going_count FROM activities WHERE id = ${activityId}`;
    expect(after[0]?.going_count).toBe(1);
    expect(winnerId).toBeTruthy();
  });
});

describe("messages", () => {
  it("deduplicates a retried client message id", async () => {
    const host = randomUUID();
    await sql`INSERT INTO users (id, status, onboarding_step, onboarding_completed_at, birth_date, adult_eligible) VALUES (${host}, 'active', 'complete', now(), '1992-01-01', true)`;
    await sql`INSERT INTO profiles (user_id, display_name) VALUES (${host}, 'Host')`;
    const [conversation] = await sql<{ id: string }[]>`
      INSERT INTO conversations (kind, city_id, shard, title) VALUES ('city', ${cities.lisbon}, ${Math.floor(Math.random() * 1_000_000) + 1}, 'dedupe room') RETURNING id
    `;
    await sql`INSERT INTO conversation_members (conversation_id, user_id) VALUES (${conversation?.id ?? ""}, ${host})`;
    const clientMessageId = randomUUID();
    const first = await sendMessage(sql, { userId: host, conversationId: conversation?.id ?? "", clientMessageId, body: "hello" });
    const second = await sendMessage(sql, { userId: host, conversationId: conversation?.id ?? "", clientMessageId, body: "hello" });
    expect(second.id).toBe(first.id);
    expect(second.replayed).toBe(true);
    const count = await sql<{ count: string }[]>`SELECT count(*)::text AS count FROM messages WHERE conversation_id = ${conversation?.id ?? ""}`;
    expect(count[0]?.count).toBe("1");
  });
});

describe("trip dates", () => {
  it("matches the inclusive boundary used by the database overlap predicate", () => {
    expect(sharedDates({ start: "2026-10-01", end: "2026-10-05" }, { start: "2026-10-05", end: "2026-10-08" })?.start).toBe("2026-10-05");
  });
});
