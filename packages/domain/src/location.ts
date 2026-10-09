import type { Client } from "./db";
import { DomainError } from "./errors";
import { assertMember } from "./messages";

const MAX_MINUTES = 120;

export async function startLocationShare(sql: Client, input: { userId: string; conversationId: string; minutes: number }) {
  if (input.minutes < 5 || input.minutes > MAX_MINUTES) throw new DomainError("invalid_duration", 400, "Share location for 5 to 120 minutes");
  return sql.begin(async (tx) => {
    await assertMember(tx, input.conversationId, input.userId);
    await tx`UPDATE location_shares SET stopped_at = now() WHERE user_id = ${input.userId} AND conversation_id = ${input.conversationId} AND stopped_at IS NULL`;
    const [row] = await tx<{ id: string; expires_at: Date }[]>`
      INSERT INTO location_shares (conversation_id, user_id, expires_at)
      VALUES (${input.conversationId}, ${input.userId}, now() + (${input.minutes} * interval '1 minute'))
      RETURNING id, expires_at
    `;
    return row;
  });
}

export async function updateLocationShare(sql: Client, input: { userId: string; shareId: string; latitude: number; longitude: number }) {
  const rows = await sql<{ id: string }[]>`
    UPDATE location_shares
    SET latitude = ${input.latitude}, longitude = ${input.longitude}, updated_at = now()
    WHERE id = ${input.shareId}
      AND user_id = ${input.userId}
      AND stopped_at IS NULL
      AND expires_at > now()
    RETURNING id
  `;
  if (!rows[0]) throw new DomainError("share_inactive", 409, "Location sharing is not active");
  return { id: rows[0].id };
}

export async function stopLocationShare(sql: Client, input: { userId: string; shareId: string }) {
  await sql`
    UPDATE location_shares
    SET stopped_at = now(), latitude = NULL, longitude = NULL, updated_at = now()
    WHERE id = ${input.shareId} AND user_id = ${input.userId} AND stopped_at IS NULL
  `;
  return { stopped: true };
}

export async function listLocationShares(sql: Client, input: { userId: string; conversationId: string }) {
  await assertMember(sql, input.conversationId, input.userId);
  return sql<{ id: string; user_id: string; latitude: number | null; longitude: number | null; expires_at: Date; updated_at: Date; stopped_at: Date | null }[]>`
    SELECT id, user_id, latitude, longitude, expires_at, updated_at, stopped_at
    FROM location_shares
    WHERE conversation_id = ${input.conversationId}
      AND stopped_at IS NULL
      AND expires_at > now()
  `;
}
