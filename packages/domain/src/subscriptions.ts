import type postgres from "postgres";
import type { Client } from "./db";
import { DomainError } from "./errors";

export type RevenueEvent = {
  id: string;
  type: string;
  app_user_id?: string;
  product_id?: string;
  expiration_at_ms?: number;
  period_type?: string;
};

const ACTIVE = new Set(["INITIAL_PURCHASE", "RENEWAL", "UNCANCELLATION", "PRODUCT_CHANGE", "NON_RENEWING_PURCHASE"]);
const INACTIVE = new Set(["EXPIRATION", "REFUND", "SUBSCRIPTION_PAUSED"]);

export async function ingestRevenueEvent(sql: Client, input: { event: RevenueEvent; raw: unknown }) {
  if (!input.event.id) throw new DomainError("invalid_event", 400, "Event id is required");
  const inserted = await sql<{ id: string }[]>`
    INSERT INTO subscription_events (id, event_type, raw, user_id)
    VALUES (${input.event.id}, ${input.event.type}, ${sql.json(input.raw as postgres.JSONValue)}, ${isUuid(input.event.app_user_id) ? input.event.app_user_id! : null})
    ON CONFLICT (id) DO NOTHING
    RETURNING id
  `;
  if (!inserted[0]) return { duplicate: true };
  await applyRevenueEvent(sql, input.event);
  await sql`UPDATE subscription_events SET processed_at = now() WHERE id = ${input.event.id}`;
  return { duplicate: false };
}

export async function applyRevenueEvent(sql: Client, event: RevenueEvent) {
  const userId = event.app_user_id;
  if (!userId || !isUuid(userId)) return;
  const exists = await sql`SELECT 1 FROM users WHERE id = ${userId}`;
  if (!exists[0]) return;
  const expires = event.expiration_at_ms ? new Date(event.expiration_at_ms) : null;
  const active = ACTIVE.has(event.type) && (!expires || expires.getTime() > Date.now());
  const status = INACTIVE.has(event.type) ? "expired" : event.type === "BILLING_ISSUE" ? "billing_issue" : event.type === "CANCELLATION" ? "cancelled" : active ? "active" : "none";
  await sql`
    INSERT INTO entitlements (user_id, plus_active, status, product_id, expires_at, will_renew, updated_at)
    VALUES (${userId}, ${active}, ${status}, ${event.product_id ?? null}, ${expires}, ${event.type !== "CANCELLATION" && active}, now())
    ON CONFLICT (user_id) DO UPDATE SET
      plus_active = EXCLUDED.plus_active,
      status = EXCLUDED.status,
      product_id = COALESCE(EXCLUDED.product_id, entitlements.product_id),
      expires_at = EXCLUDED.expires_at,
      will_renew = EXCLUDED.will_renew,
      updated_at = now()
  `;
}

function isUuid(value: string | undefined): value is string {
  return !!value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
