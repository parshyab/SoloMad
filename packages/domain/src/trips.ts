import type { Client } from "./db";
import { DomainError } from "./errors";
import { assertIsoDate } from "./dates";

export async function createTrip(sql: Client, input: { userId: string; cityId: string; startDate: string; endDate: string }) {
  assertIsoDate(input.startDate, "startDate");
  assertIsoDate(input.endDate, "endDate");
  if (input.endDate < input.startDate) throw new DomainError("invalid_dates", 400, "The end date must be on or after the start date");
  const cities = await sql<{ id: string }[]>`SELECT id FROM cities WHERE id = ${input.cityId}`;
  if (!cities[0]) throw new DomainError("unknown_city", 400, "Choose a known destination");
  const [trip] = await sql<{ id: string }[]>`
    INSERT INTO trips (user_id, city_id, start_date, end_date)
    VALUES (${input.userId}, ${input.cityId}, ${input.startDate}, ${input.endDate})
    RETURNING id
  `;
  if (!trip) throw new DomainError("create_failed", 500, "Trip was not saved");
  await ensureCityRoom(sql, input.userId, input.cityId);
  await sql`
    INSERT INTO outbox_events (aggregate_type, aggregate_id, event_type, payload)
    VALUES ('trip', ${trip.id}, 'trip.created', ${sql.json({ tripId: trip.id, userId: input.userId, cityId: input.cityId })})
  `;
  return { tripId: trip.id };
}

export async function updateTrip(sql: Client, input: { userId: string; tripId: string; startDate: string; endDate: string }) {
  assertIsoDate(input.startDate, "startDate");
  assertIsoDate(input.endDate, "endDate");
  if (input.endDate < input.startDate) throw new DomainError("invalid_dates", 400, "The end date must be on or after the start date");
  const rows = await sql<{ id: string }[]>`
    UPDATE trips SET start_date = ${input.startDate}, end_date = ${input.endDate}, updated_at = now()
    WHERE id = ${input.tripId} AND user_id = ${input.userId}
    RETURNING id
  `;
  if (!rows[0]) throw new DomainError("not_found", 404, "Trip not found");
  return { tripId: rows[0].id };
}

export async function deleteTrip(sql: Client, input: { userId: string; tripId: string }) {
  const rows = await sql<{ id: string; city_id: string }[]>`
    DELETE FROM trips WHERE id = ${input.tripId} AND user_id = ${input.userId} RETURNING id, city_id
  `;
  if (!rows[0]) throw new DomainError("not_found", 404, "Trip not found");
  const remaining = await sql`SELECT 1 FROM trips WHERE user_id = ${input.userId} AND city_id = ${rows[0].city_id} LIMIT 1`;
  if (!remaining[0]) {
    await sql`
      UPDATE conversation_members cm SET removed_at = now()
      FROM conversations c
      WHERE c.id = cm.conversation_id AND c.kind = 'city' AND c.city_id = ${rows[0].city_id} AND cm.user_id = ${input.userId}
    `;
  }
  return {
    deleted: true,
    effect: "City chat access stays while another trip overlaps that city. Message history you were allowed to see remains.",
  };
}

export async function overlapsForTrip(sql: Client, input: { userId: string; tripId: string }) {
  const trips = await sql<{ id: string; user_id: string; city_id: string }[]>`
    SELECT id, user_id, city_id FROM trips WHERE id = ${input.tripId}
  `;
  const trip = trips[0];
  if (!trip) throw new DomainError("not_found", 404, "Trip not found");
  if (trip.user_id !== input.userId) throw new DomainError("forbidden", 403, "You can only view overlaps for your trip");
  return sql<{
    user_id: string;
    display_name: string;
    trip_id: string;
    shared_start: string;
    shared_end: string;
  }[]>`
    SELECT other.user_id,
           p.display_name,
           other.id AS trip_id,
           GREATEST(mine.start_date, other.start_date)::text AS shared_start,
           LEAST(mine.end_date, other.end_date)::text AS shared_end
    FROM trips mine
    JOIN trips other
      ON other.city_id = mine.city_id
     AND other.user_id <> mine.user_id
     AND daterange(mine.start_date, mine.end_date, '[]') && daterange(other.start_date, other.end_date, '[]')
    JOIN users u ON u.id = other.user_id AND u.status = 'active' AND u.adult_eligible
    JOIN profiles p ON p.user_id = other.user_id AND p.visibility <> 'hidden'
    WHERE mine.id = ${input.tripId}
      AND NOT EXISTS (
        SELECT 1 FROM blocks b
        WHERE (b.blocker_id = mine.user_id AND b.blocked_id = other.user_id)
           OR (b.blocker_id = other.user_id AND b.blocked_id = mine.user_id)
      )
    ORDER BY shared_start
  `;
}

export async function ensureCityRoom(sql: Client, userId: string, cityId: string, memberLimit = 500) {
  const open = await sql<{ id: string; members: string }[]>`
    SELECT c.id, count(cm.user_id) FILTER (WHERE cm.removed_at IS NULL)::text AS members
    FROM conversations c
    LEFT JOIN conversation_members cm ON cm.conversation_id = c.id
    WHERE c.kind = 'city' AND c.city_id = ${cityId}
    GROUP BY c.id
    ORDER BY c.shard
  `;
  let conversation = open.find((row) => Number(row.members) < memberLimit);
  if (!conversation) {
    const shard = open.length;
    const city = await sql<{ name: string }[]>`SELECT name FROM cities WHERE id = ${cityId}`;
    const [created] = await sql<{ id: string }[]>`
      INSERT INTO conversations (kind, city_id, shard, title, member_limit)
      VALUES ('city', ${cityId}, ${shard}, ${(city[0]?.name ?? "City") + " travelers"}, ${memberLimit})
      ON CONFLICT DO NOTHING
      RETURNING id
    `;
    const id = created?.id ?? open[0]?.id;
    if (!id) throw new DomainError("city_room_failed", 500, "City chat could not be opened");
    conversation = { id, members: "0" };
  }
  await sql`
    INSERT INTO conversation_members (conversation_id, user_id)
    VALUES (${conversation.id}, ${userId})
    ON CONFLICT (conversation_id, user_id) DO UPDATE SET removed_at = NULL
  `;
  return conversation.id;
}
