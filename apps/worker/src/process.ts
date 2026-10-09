import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { type AppEnv } from "@solomad/config";
import type { Sql } from "@solomad/db";
import { anonymizeUser } from "@solomad/domain";

export async function processOutboxBatch(sql: Sql, env: AppEnv, limit = 20): Promise<number> {
  const events = await sql.begin(async (tx) => tx<{ id: string; event_type: string; payload: { userId?: string }; attempts: number }[]>`
    UPDATE outbox_events
    SET available_at = now() + interval '2 minutes'
    WHERE id IN (
      SELECT id FROM outbox_events
      WHERE published_at IS NULL AND dead_lettered_at IS NULL AND available_at <= now()
      ORDER BY created_at
      FOR UPDATE SKIP LOCKED
      LIMIT ${limit}
    )
    RETURNING id, event_type, payload, attempts
  `);
  for (const event of events) {
    try {
      if (event.event_type === "user.deletion_requested" && event.payload.userId) {
        await anonymizeUser(sql, event.payload.userId);
      }
      if (env.QUEUE_PROVIDER === "sqs" && env.SQS_QUEUE_URL) {
        const client = new SQSClient({
          region: env.SQS_REGION,
          endpoint: env.SQS_ENDPOINT || undefined,
          credentials: env.SQS_ACCESS_KEY_ID && env.SQS_SECRET_ACCESS_KEY ? {
            accessKeyId: env.SQS_ACCESS_KEY_ID,
            secretAccessKey: env.SQS_SECRET_ACCESS_KEY,
          } : undefined,
        });
        await client.send(new SendMessageCommand({
          QueueUrl: env.SQS_QUEUE_URL,
          MessageBody: JSON.stringify({ id: event.id, type: event.event_type }),
        }));
      }
      await sql`UPDATE outbox_events SET published_at = now() WHERE id = ${event.id}`;
      await sql`INSERT INTO processed_jobs (id) VALUES (${event.id}) ON CONFLICT DO NOTHING`;
    } catch (error) {
      const attempts = event.attempts + 1;
      const dead = attempts >= 5;
      await sql`
        UPDATE outbox_events
        SET attempts = ${attempts},
            available_at = now() + interval '15 seconds',
            last_error = ${(error instanceof Error ? error.message : "failed").slice(0, 300)},
            dead_lettered_at = CASE WHEN ${dead} THEN now() ELSE NULL END
        WHERE id = ${event.id}
      `;
    }
  }
  await sql`
    UPDATE activities SET status = 'started', updated_at = now()
    WHERE status = 'published' AND starts_at <= now()
  `;
  return events.length;
}
