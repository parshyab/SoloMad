import { createHash } from "node:crypto";
import type postgres from "postgres";
import { DomainError } from "./errors";

export type Client = postgres.Sql;
export type DB = postgres.Sql | postgres.TransactionSql;

export function canonicalHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export async function withIdempotency<T>(
  tx: DB,
  userId: string,
  key: string | undefined,
  requestHash: string,
  work: () => Promise<{ statusCode: number; body: T }>,
): Promise<{ statusCode: number; body: T; replayed: boolean }> {
  if (!key) {
    const result = await work();
    return { ...result, replayed: false };
  }
  const existing = await tx<{ request_hash: string; status_code: number; response: T }[]>`
    SELECT request_hash, status_code, response
    FROM idempotency_records
    WHERE user_id = ${userId} AND key = ${key}
  `;
  const row = existing[0];
  if (row) {
    if (row.request_hash !== requestHash) {
      throw new DomainError("idempotency_conflict", 409, "This idempotency key was already used for a different request");
    }
    return { statusCode: row.status_code, body: row.response, replayed: true };
  }
  const result = await work();
  await tx`
    INSERT INTO idempotency_records (user_id, key, request_hash, status_code, response)
    VALUES (${userId}, ${key}, ${requestHash}, ${result.statusCode}, ${tx.json(result.body as postgres.JSONValue)})
    ON CONFLICT (user_id, key) DO NOTHING
  `;
  return { ...result, replayed: false };
}
