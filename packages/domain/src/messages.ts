import type postgres from "postgres";
import type { Client, DB } from "./db";
import { DomainError } from "./errors";

const MAX_PER_MINUTE = 30;

export async function sendMessage(sql: Client, input: {
  userId: string;
  conversationId: string;
  clientMessageId: string;
  body: string;
  kind?: "text" | "image";
  mediaId?: string;
}) {
  const body = input.body.trim();
  if (input.kind !== "image" && (body.length < 1 || body.length > 4000)) {
    throw new DomainError("invalid_message", 400, "Message must be between 1 and 4000 characters");
  }
  return sql.begin(async (tx) => {
    await assertMember(tx, input.conversationId, input.userId);
    const recent = await tx<{ count: string }[]>`
      SELECT count(*)::text AS count FROM messages
      WHERE sender_id = ${input.userId} AND created_at > now() - interval '1 minute'
    `;
    if (Number(recent[0]?.count ?? 0) >= MAX_PER_MINUTE) throw new DomainError("rate_limited", 429, "Slow down a little and try again");
    if (input.mediaId) {
      const media = await tx<{ id: string }[]>`
        SELECT id FROM media_objects WHERE id = ${input.mediaId} AND owner_id = ${input.userId} AND status = 'ready' AND kind = 'chat'
      `;
      if (!media[0]) throw new DomainError("invalid_attachment", 403, "That attachment is not available");
    }
    const inserted = await tx<{ id: string; created_at: Date }[]>`
      INSERT INTO messages (conversation_id, sender_id, client_message_id, body, kind)
      VALUES (${input.conversationId}, ${input.userId}, ${input.clientMessageId}, ${body || null}, ${input.kind ?? "text"})
      ON CONFLICT (conversation_id, client_message_id) DO NOTHING
      RETURNING id, created_at
    `;
    const message = inserted[0] ?? (await tx<{ id: string; created_at: Date }[]>`
      SELECT id, created_at FROM messages WHERE conversation_id = ${input.conversationId} AND client_message_id = ${input.clientMessageId}
    `)[0];
    if (!message) throw new DomainError("send_failed", 500, "Message was not stored");
    if (inserted[0]) {
      if (input.mediaId) {
        await tx`INSERT INTO message_attachments (message_id, media_id) VALUES (${message.id}, ${input.mediaId}) ON CONFLICT DO NOTHING`;
      }
      await tx`
        INSERT INTO outbox_events (aggregate_type, aggregate_id, event_type, payload)
        VALUES ('message', ${message.id}, 'message.created', ${tx.json({
          messageId: message.id,
          conversationId: input.conversationId,
          senderId: input.userId,
          clientMessageId: input.clientMessageId,
        } as postgres.JSONValue)})
      `;
    }
    return { id: message.id, createdAt: message.created_at, replayed: !inserted[0] };
  });
}

export async function assertMember(tx: DB, conversationId: string, userId: string) {
  const rows = await tx<{ removed_at: Date | null; status: string }[]>`
    SELECT cm.removed_at, u.status
    FROM conversation_members cm
    JOIN users u ON u.id = cm.user_id
    WHERE cm.conversation_id = ${conversationId} AND cm.user_id = ${userId}
  `;
  if (!rows[0] || rows[0].removed_at || rows[0].status !== "active") {
    throw new DomainError("forbidden", 403, "You do not have access to this conversation");
  }
  const activity = await tx<{ status: string }[]>`
    SELECT a.status FROM conversations c
    JOIN activities a ON a.id = c.activity_id
    WHERE c.id = ${conversationId} AND c.kind = 'activity'
  `;
  if (activity[0] && (activity[0].status === "cancelled")) {
    throw new DomainError("conversation_closed", 403, "This activity chat is closed");
  }
}

export async function createPoll(sql: Client, input: { userId: string; conversationId: string; question: string; options: string[] }) {
  if (input.options.length < 2 || input.options.length > 6) throw new DomainError("invalid_poll", 400, "Add between 2 and 6 options");
  return sql.begin(async (tx) => {
    await assertMember(tx, input.conversationId, input.userId);
    const clientMessageId = `poll-${crypto.randomUUID()}`;
    const [message] = await tx<{ id: string }[]>`
      INSERT INTO messages (conversation_id, sender_id, client_message_id, body, kind)
      VALUES (${input.conversationId}, ${input.userId}, ${clientMessageId}, ${input.question}, 'poll')
      RETURNING id
    `;
    if (!message) throw new DomainError("send_failed", 500, "Poll message was not stored");
    const [poll] = await tx<{ id: string }[]>`
      INSERT INTO polls (conversation_id, message_id, creator_id, question)
      VALUES (${input.conversationId}, ${message.id}, ${input.userId}, ${input.question})
      RETURNING id
    `;
    if (!poll) throw new DomainError("poll_failed", 500, "Poll was not created");
    for (const [index, label] of input.options.entries()) {
      await tx`INSERT INTO poll_options (poll_id, label, position) VALUES (${poll.id}, ${label}, ${index})`;
    }
    return { pollId: poll.id, messageId: message.id };
  });
}

export async function votePoll(sql: Client, input: { userId: string; pollId: string; optionId: string }) {
  return sql.begin(async (tx) => {
    const polls = await tx<{ conversation_id: string; closed_at: Date | null; creator_id: string }[]>`
      SELECT conversation_id, closed_at, creator_id FROM polls WHERE id = ${input.pollId} FOR UPDATE
    `;
    const poll = polls[0];
    if (!poll) throw new DomainError("not_found", 404, "Poll not found");
    if (poll.closed_at) throw new DomainError("poll_closed", 409, "This poll is closed");
    await assertMember(tx, poll.conversation_id, input.userId);
    const option = await tx`SELECT 1 FROM poll_options WHERE id = ${input.optionId} AND poll_id = ${input.pollId}`;
    if (!option[0]) throw new DomainError("invalid_option", 400, "That option is not part of this poll");
    await tx`
      INSERT INTO poll_votes (poll_id, user_id, option_id)
      VALUES (${input.pollId}, ${input.userId}, ${input.optionId})
      ON CONFLICT (poll_id, user_id) DO UPDATE SET option_id = EXCLUDED.option_id, updated_at = now()
    `;
    return { pollId: input.pollId, optionId: input.optionId };
  });
}

export async function closePoll(sql: Client, input: { userId: string; pollId: string }) {
  const rows = await sql<{ creator_id: string }[]>`SELECT creator_id FROM polls WHERE id = ${input.pollId}`;
  if (rows[0]?.creator_id !== input.userId) throw new DomainError("forbidden", 403, "Only the poll creator can close it");
  await sql`UPDATE polls SET closed_at = now() WHERE id = ${input.pollId} AND closed_at IS NULL`;
  return { closed: true };
}
