import type { Client } from "./db";
import { DomainError } from "./errors";

export async function blockUser(sql: Client, blockerId: string, blockedId: string) {
  if (blockerId === blockedId) throw new DomainError("invalid_block", 400, "You cannot block yourself");
  await sql`INSERT INTO blocks (blocker_id, blocked_id) VALUES (${blockerId}, ${blockedId}) ON CONFLICT DO NOTHING`;
  await sql`
    UPDATE conversation_members cm SET removed_at = now()
    FROM conversations c
    WHERE c.id = cm.conversation_id AND c.kind = 'direct'
      AND ((c.direct_low = ${blockerId} AND c.direct_high = ${blockedId}) OR (c.direct_low = ${blockedId} AND c.direct_high = ${blockerId}))
      AND cm.user_id IN (${blockerId}, ${blockedId})
  `;
  return { blocked: true };
}

export async function createReport(sql: Client, input: { reporterId: string; targetType: string; targetId: string; reason: string }) {
  if (input.reason.trim().length < 3) throw new DomainError("reason_required", 400, "Add a short reason");
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO reports (reporter_id, target_type, target_id, reason)
    VALUES (${input.reporterId}, ${input.targetType}, ${input.targetId}, ${input.reason.trim()})
    RETURNING id
  `;
  return { reportId: row?.id };
}

export async function createTicket(sql: Client, input: { userId: string; subject: string; body: string }) {
  return sql.begin(async (tx) => {
    const [ticket] = await tx<{ id: string }[]>`
      INSERT INTO support_tickets (user_id, subject) VALUES (${input.userId}, ${input.subject}) RETURNING id
    `;
    if (!ticket) throw new DomainError("create_failed", 500, "Ticket was not created");
    await tx`INSERT INTO support_messages (ticket_id, author_id, body) VALUES (${ticket.id}, ${input.userId}, ${input.body})`;
    return { ticketId: ticket.id };
  });
}
