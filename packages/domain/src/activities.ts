import type postgres from "postgres";
import { canonicalHash, type Client, type DB, withIdempotency } from "./db";
import { DomainError } from "./errors";

export const categories = ["food", "coffee", "outdoors", "culture", "nightlife", "entertainment", "rideshare"] as const;
export type Category = (typeof categories)[number];

export type CreateActivityInput = {
  hostUserId: string;
  cityId: string;
  category: Category;
  emoji: string;
  title: string;
  description: string;
  startsAt: Date;
  endsAt: Date | null;
  timezone: string;
  venueName: string;
  latitude: number;
  longitude: number;
  capacity: number;
  expenseGuidance: string | null;
  idempotencyKey?: string;
};

type ActivityCore = {
  id: string;
  host_user_id: string;
  city_id: string;
  status: string;
  capacity: number;
  going_count: number;
  starts_at: Date;
  version: number;
  title: string;
  timezone: string;
};

async function outbox(tx: DB, aggregateId: string, eventType: string, payload: Record<string, unknown>) {
  await tx`
    INSERT INTO outbox_events (aggregate_type, aggregate_id, event_type, payload)
    VALUES ('activity', ${aggregateId}, ${eventType}, ${tx.json(payload as postgres.JSONValue)})
  `;
}

async function assertNotBlocked(tx: DB, left: string, right: string) {
  const rows = await tx<{ blocker_id: string }[]>`
    SELECT blocker_id FROM blocks
    WHERE (blocker_id = ${left} AND blocked_id = ${right})
       OR (blocker_id = ${right} AND blocked_id = ${left})
    LIMIT 1
  `;
  if (rows[0]) throw new DomainError("blocked", 403, "This action is not available between these accounts");
}

export async function createActivity(sql: Client, input: CreateActivityInput) {
  if (!categories.includes(input.category)) throw new DomainError("invalid_category", 400, "Unknown activity category");
  if (input.capacity < 2 || input.capacity > 50) throw new DomainError("invalid_capacity", 400, "Capacity must be between 2 and 50");
  if (input.startsAt.getTime() <= Date.now()) throw new DomainError("past_time", 400, "Activities must start in the future");
  if (input.title.trim().length < 3) throw new DomainError("invalid_title", 400, "Add a title");
  const hash = canonicalHash({ ...input, startsAt: input.startsAt.toISOString(), hostUserId: input.hostUserId });
  return sql.begin(async (tx) => withIdempotency(tx, input.hostUserId, input.idempotencyKey, hash, async () => {
    const cities = await tx<{ id: string; timezone: string }[]>`
      SELECT id, timezone,
        ST_DWithin(location, ST_SetSRID(ST_MakePoint(${input.longitude}, ${input.latitude}), 4326)::geography, 80000) AS near
      FROM cities WHERE id = ${input.cityId}
    `;
    const city = cities[0] as { id: string; timezone: string; near: boolean } | undefined;
    if (!city) throw new DomainError("unknown_city", 400, "Choose a known city");
    if (!city.near) throw new DomainError("venue_outside_city", 400, "That pin is outside the selected city");
    const [venue] = await tx<{ id: string }[]>`
      INSERT INTO venues (city_id, name, location, provider, attribution)
      VALUES (
        ${input.cityId},
        ${input.venueName},
        ST_SetSRID(ST_MakePoint(${input.longitude}, ${input.latitude}), 4326)::geography,
        'user',
        'User-confirmed meeting point'
      )
      RETURNING id
    `;
    const [activity] = await tx<{ id: string }[]>`
      INSERT INTO activities (
        host_user_id, city_id, venue_id, category, emoji, title, description,
        starts_at, ends_at, timezone, meeting_point, capacity, going_count, expense_guidance, status
      ) VALUES (
        ${input.hostUserId}, ${input.cityId}, ${venue?.id ?? null}, ${input.category}, ${input.emoji},
        ${input.title.trim()}, ${input.description.trim()}, ${input.startsAt}, ${input.endsAt}, ${input.timezone},
        ST_SetSRID(ST_MakePoint(${input.longitude}, ${input.latitude}), 4326)::geography,
        ${input.capacity}, 1, ${input.expenseGuidance}, 'published'
      ) RETURNING id
    `;
    if (!activity) throw new DomainError("create_failed", 500, "Activity was not created");
    await tx`
      INSERT INTO activity_memberships (activity_id, user_id, status) VALUES (${activity.id}, ${input.hostUserId}, 'host')
    `;
    const [conversation] = await tx<{ id: string }[]>`
      INSERT INTO conversations (kind, activity_id, city_id, title)
      VALUES ('activity', ${activity.id}, ${input.cityId}, ${input.title.trim()})
      RETURNING id
    `;
    await tx`
      INSERT INTO conversation_members (conversation_id, user_id, role)
      VALUES (${conversation?.id ?? null}, ${input.hostUserId}, 'host')
    `;
    await outbox(tx, activity.id, "activity.published", { activityId: activity.id, conversationId: conversation?.id });
    return {
      statusCode: 201,
      body: { activityId: activity.id, conversationId: conversation?.id, goingCount: 1, capacity: input.capacity },
    };
  }));
}

export async function joinActivity(sql: Client, input: { userId: string; activityId: string; idempotencyKey?: string }) {
  const hash = canonicalHash({ op: "join", activityId: input.activityId });
  return sql.begin(async (tx) => withIdempotency(tx, input.userId, input.idempotencyKey, hash, async () => {
    const locked = await tx<ActivityCore[]>`
      SELECT id, host_user_id, city_id, status, capacity, going_count, starts_at, version, title, timezone
      FROM activities WHERE id = ${input.activityId} FOR UPDATE
    `;
    const activity = locked[0];
    if (!activity) throw new DomainError("not_found", 404, "Activity not found");
    if (activity.host_user_id === input.userId) throw new DomainError("host_join", 409, "Hosts manage the activity instead of joining it");
    await assertNotBlocked(tx, input.userId, activity.host_user_id);
    const user = await tx<{ adult_eligible: boolean; status: string }[]>`
      SELECT adult_eligible, status FROM users WHERE id = ${input.userId}
    `;
    if (user[0]?.status !== "active" || !user[0]?.adult_eligible) {
      throw new DomainError("ineligible", 403, "Complete adult onboarding before joining");
    }
    if (activity.status !== "published") throw new DomainError("unavailable", 409, `This activity is ${activity.status}`);
    if (new Date(activity.starts_at).getTime() <= Date.now()) throw new DomainError("started", 409, "This activity has already started");

    const membership = await tx<{ status: string }[]>`
      SELECT status FROM activity_memberships
      WHERE activity_id = ${activity.id} AND user_id = ${input.userId}
      FOR UPDATE
    `;
    const current = membership[0];
    if (current?.status === "active") {
      const conversation = await conversationId(tx, activity.id);
      return { statusCode: 200, body: { activityId: activity.id, conversationId: conversation, goingCount: activity.going_count, capacity: activity.capacity, alreadyMember: true } };
    }
    const updated = await tx<{ going_count: number }[]>`
      UPDATE activities
      SET going_count = going_count + 1, version = version + 1, updated_at = now()
      WHERE id = ${activity.id} AND status = 'published' AND going_count < capacity
      RETURNING going_count
    `;
    if (!updated[0]) throw new DomainError("full", 409, "The last place was just taken");
    if (current) {
      await tx`
        UPDATE activity_memberships SET status = 'active', left_at = NULL, joined_at = now()
        WHERE activity_id = ${activity.id} AND user_id = ${input.userId}
      `;
    } else {
      await tx`
        INSERT INTO activity_memberships (activity_id, user_id, status) VALUES (${activity.id}, ${input.userId}, 'active')
      `;
    }
    const conversation = await conversationId(tx, activity.id);
    await tx`
      INSERT INTO conversation_members (conversation_id, user_id, role)
      VALUES (${conversation}, ${input.userId}, 'member')
      ON CONFLICT (conversation_id, user_id) DO UPDATE SET removed_at = NULL
    `;
    await outbox(tx, activity.id, "activity.joined", { activityId: activity.id, userId: input.userId, conversationId: conversation });
    return {
      statusCode: 200,
      body: { activityId: activity.id, conversationId: conversation, goingCount: updated[0].going_count, capacity: activity.capacity, alreadyMember: false },
    };
  }));
}

export async function leaveActivity(sql: Client, input: { userId: string; activityId: string; idempotencyKey?: string }) {
  const hash = canonicalHash({ op: "leave", activityId: input.activityId });
  return sql.begin(async (tx) => withIdempotency(tx, input.userId, input.idempotencyKey, hash, async () => {
    const locked = await tx<ActivityCore[]>`SELECT id, host_user_id, city_id, status, capacity, going_count, starts_at, version, title, timezone FROM activities WHERE id = ${input.activityId} FOR UPDATE`;
    const activity = locked[0];
    if (!activity) throw new DomainError("not_found", 404, "Activity not found");
    if (activity.host_user_id === input.userId) throw new DomainError("host_leave", 409, "Cancel the activity instead of leaving it");
    const membership = await tx<{ status: string }[]>`
      SELECT status FROM activity_memberships WHERE activity_id = ${activity.id} AND user_id = ${input.userId} FOR UPDATE
    `;
    if (membership[0]?.status !== "active") throw new DomainError("not_member", 409, "You are not going to this activity");
    const updated = await tx<{ going_count: number }[]>`
      UPDATE activities SET going_count = going_count - 1, version = version + 1, updated_at = now()
      WHERE id = ${activity.id} AND going_count > 1
      RETURNING going_count
    `;
    if (!updated[0]) throw new DomainError("capacity_invariant", 409, "Attendance could not be updated");
    await tx`UPDATE activity_memberships SET status = 'left', left_at = now() WHERE activity_id = ${activity.id} AND user_id = ${input.userId}`;
    const conversation = await conversationId(tx, activity.id);
    await tx`UPDATE conversation_members SET removed_at = now() WHERE conversation_id = ${conversation} AND user_id = ${input.userId}`;
    await outbox(tx, activity.id, "activity.left", { activityId: activity.id, userId: input.userId });
    return { statusCode: 200, body: { activityId: activity.id, goingCount: updated[0].going_count, capacity: activity.capacity } };
  }));
}

export async function updateActivity(sql: Client, input: {
  userId: string;
  activityId: string;
  expectedVersion: number;
  title?: string;
  description?: string;
  startsAt?: Date;
  capacity?: number;
  expenseGuidance?: string | null;
}) {
  return sql.begin(async (tx) => {
    const locked = await tx<ActivityCore[]>`SELECT id, host_user_id, city_id, status, capacity, going_count, starts_at, version, title, timezone FROM activities WHERE id = ${input.activityId} FOR UPDATE`;
    const activity = locked[0];
    if (!activity) throw new DomainError("not_found", 404, "Activity not found");
    if (activity.host_user_id !== input.userId) throw new DomainError("forbidden", 403, "Only the host can edit this activity");
    if (activity.status !== "published") throw new DomainError("unavailable", 409, "Only a published activity can be edited");
    if (activity.version !== input.expectedVersion) throw new DomainError("version_conflict", 409, "This activity changed. Refresh and try again");
    if (input.capacity !== undefined && (input.capacity < activity.going_count || input.capacity > 50)) {
      throw new DomainError("invalid_capacity", 409, "Capacity cannot drop below the number of people going");
    }
    if (input.startsAt && input.startsAt.getTime() <= Date.now()) throw new DomainError("past_time", 400, "Pick a future time");
    const [updated] = await tx<{ version: number }[]>`
      UPDATE activities SET
        title = COALESCE(${input.title ?? null}, title),
        description = COALESCE(${input.description ?? null}, description),
        starts_at = COALESCE(${input.startsAt ?? null}, starts_at),
        capacity = COALESCE(${input.capacity ?? null}, capacity),
        expense_guidance = COALESCE(${input.expenseGuidance ?? null}, expense_guidance),
        version = version + 1,
        updated_at = now()
      WHERE id = ${activity.id} AND version = ${input.expectedVersion}
      RETURNING version
    `;
    if (!updated) throw new DomainError("version_conflict", 409, "This activity changed. Refresh and try again");
    await outbox(tx, activity.id, "activity.updated", { activityId: activity.id, version: updated.version });
    return updated;
  });
}

export async function cancelActivity(sql: Client, input: { userId: string; activityId: string; reason: string }) {
  if (input.reason.trim().length < 3) throw new DomainError("reason_required", 400, "Add a cancellation reason");
  return sql.begin(async (tx) => {
    const locked = await tx<ActivityCore[]>`SELECT id, host_user_id, city_id, status, capacity, going_count, starts_at, version, title, timezone FROM activities WHERE id = ${input.activityId} FOR UPDATE`;
    const activity = locked[0];
    if (!activity) throw new DomainError("not_found", 404, "Activity not found");
    if (activity.host_user_id !== input.userId) throw new DomainError("forbidden", 403, "Only the host can cancel this activity");
    if (activity.status === "cancelled" || activity.status === "completed") throw new DomainError("unavailable", 409, "This activity can no longer be cancelled");
    await tx`UPDATE activities SET status = 'cancelled', cancel_reason = ${input.reason.trim()}, version = version + 1, updated_at = now() WHERE id = ${activity.id}`;
    await outbox(tx, activity.id, "activity.cancelled", { activityId: activity.id, reason: input.reason.trim() });
    return { status: "cancelled" as const };
  });
}

export async function completeActivity(sql: Client, input: { userId: string; activityId: string }) {
  return sql.begin(async (tx) => {
    const locked = await tx<ActivityCore[]>`SELECT id, host_user_id, city_id, status, capacity, going_count, starts_at, version, title, timezone FROM activities WHERE id = ${input.activityId} FOR UPDATE`;
    const activity = locked[0];
    if (!activity) throw new DomainError("not_found", 404, "Activity not found");
    if (activity.host_user_id !== input.userId) throw new DomainError("forbidden", 403, "Only the host can complete this activity");
    if (new Date(activity.starts_at).getTime() > Date.now()) throw new DomainError("not_started", 409, "This activity has not started");
    if (activity.status === "cancelled" || activity.status === "completed") throw new DomainError("unavailable", 409, "This activity cannot be completed");
    await tx`UPDATE activities SET status = 'completed', version = version + 1, updated_at = now() WHERE id = ${activity.id}`;
    await tx`
      INSERT INTO attendance (activity_id, user_id)
      SELECT activity_id, user_id FROM activity_memberships
      WHERE activity_id = ${activity.id} AND status IN ('host', 'active')
      ON CONFLICT DO NOTHING
    `;
    await outbox(tx, activity.id, "activity.completed", { activityId: activity.id });
    return { status: "completed" as const };
  });
}

export async function confirmAttendance(sql: Client, input: { userId: string; activityId: string; subjectUserId?: string; confirmed: boolean }) {
  return sql.begin(async (tx) => {
    const activity = await tx<{ host_user_id: string; status: string }[]>`SELECT host_user_id, status FROM activities WHERE id = ${input.activityId}`;
    if (activity[0]?.status !== "completed") throw new DomainError("unavailable", 409, "Attendance opens after the activity is completed");
    const target = input.subjectUserId ?? input.userId;
    if (target !== input.userId && activity[0]?.host_user_id !== input.userId) {
      throw new DomainError("forbidden", 403, "Only the host can confirm someone else");
    }
    const member = await tx`SELECT 1 FROM attendance WHERE activity_id = ${input.activityId} AND user_id = ${target}`;
    if (!member[0]) throw new DomainError("ineligible", 403, "That person is not eligible for attendance");
    if (target === input.userId) {
      await tx`UPDATE attendance SET attendee_confirmed = ${input.confirmed}, updated_at = now() WHERE activity_id = ${input.activityId} AND user_id = ${target}`;
    } else {
      await tx`UPDATE attendance SET host_confirmed = ${input.confirmed}, updated_at = now() WHERE activity_id = ${input.activityId} AND user_id = ${target}`;
    }
    return { ok: true };
  });
}

export async function submitFeedback(sql: Client, input: { userId: string; activityId: string; subjectUserId: string; rating: "up" | "down" }) {
  if (input.userId === input.subjectUserId) throw new DomainError("self_feedback", 400, "You cannot rate yourself");
  if (input.rating !== "up" && input.rating !== "down") throw new DomainError("invalid_rating", 400, "Rating must be up or down");
  return sql.begin(async (tx) => {
    const rows = await tx<{ author_ok: boolean; subject_ok: boolean }[]>`
      SELECT
        EXISTS (SELECT 1 FROM attendance WHERE activity_id = ${input.activityId} AND user_id = ${input.userId} AND host_confirmed AND attendee_confirmed) AS author_ok,
        EXISTS (SELECT 1 FROM attendance WHERE activity_id = ${input.activityId} AND user_id = ${input.subjectUserId} AND host_confirmed AND attendee_confirmed) AS subject_ok
    `;
    if (!rows[0]?.author_ok || !rows[0]?.subject_ok) {
      throw new DomainError("ineligible", 403, "Feedback is limited to people who both confirmed attendance");
    }
    const inserted = await tx<{ id: string }[]>`
      INSERT INTO feedback (activity_id, author_id, subject_id, rating)
      VALUES (${input.activityId}, ${input.userId}, ${input.subjectUserId}, ${input.rating})
      ON CONFLICT (activity_id, author_id, subject_id) DO NOTHING
      RETURNING id
    `;
    if (!inserted[0]) throw new DomainError("duplicate_feedback", 409, "You already sent feedback for this person");
    return { id: inserted[0].id };
  });
}

async function conversationId(tx: DB, activityId: string): Promise<string> {
  const rows = await tx<{ id: string }[]>`SELECT id FROM conversations WHERE activity_id = ${activityId} AND kind = 'activity'`;
  if (!rows[0]) throw new DomainError("missing_conversation", 500, "Activity conversation is missing");
  return rows[0].id;
}

export function viewerState(input: { status: string; startsAt: Date; hostId: string; userId: string | null; membership: string | null; going: number; capacity: number }) {
  if (input.userId && input.userId === input.hostId) return "manage";
  if (input.status === "cancelled") return "cancelled";
  if (input.status === "completed") return "completed";
  if (input.status === "started" || input.startsAt.getTime() <= Date.now()) return "started";
  if (input.membership === "active" || input.membership === "host") return "joined";
  if (input.going >= input.capacity) return "full";
  return "join";
}
