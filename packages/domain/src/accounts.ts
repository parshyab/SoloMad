import type postgres from "postgres";
import type { Client } from "./db";
import { isAdult } from "./dates";
import { DomainError } from "./errors";
import type { Provider } from "./auth";

export async function upsertUserFromIdentity(sql: Client, identity: { provider: Provider; subject: string; email?: string | null; phone?: string | null }) {
  return sql.begin(async (tx) => {
    const existing = await tx<{ user_id: string }[]>`
      SELECT user_id FROM identities WHERE provider = ${identity.provider} AND provider_subject = ${identity.subject}
    `;
    if (existing[0]) {
      const users = await tx<UserRow[]>`SELECT id, status, onboarding_step, onboarding_completed_at, adult_eligible, pending_deep_link FROM users WHERE id = ${existing[0].user_id}`;
      const user = users[0];
      if (!user || user.status === "deleted") throw new DomainError("account_closed", 403, "This account is closed");
      if (user.status === "suspended") throw new DomainError("suspended", 403, "This account is suspended");
      return user;
    }
    const [user] = await tx<UserRow[]>`
      INSERT INTO users (onboarding_step) VALUES ('name')
      RETURNING id, status, onboarding_step, onboarding_completed_at, adult_eligible, pending_deep_link
    `;
    if (!user) throw new DomainError("create_failed", 500, "Account was not created");
    await tx`
      INSERT INTO identities (user_id, provider, provider_subject, email, phone_e164)
      VALUES (${user.id}, ${identity.provider}, ${identity.subject}, ${identity.email ?? null}, ${identity.phone ?? null})
    `;
    await tx`INSERT INTO profiles (user_id) VALUES (${user.id})`;
    await tx`INSERT INTO preferences (user_id) VALUES (${user.id})`;
    await tx`INSERT INTO entitlements (user_id) VALUES (${user.id})`;
    await tx`INSERT INTO user_roles (user_id, role) VALUES (${user.id}, 'member')`;
    return user;
  });
}

export async function linkIdentity(sql: Client, input: { userId: string; provider: Provider; subject: string; email?: string | null }) {
  const existing = await sql<{ user_id: string }[]>`
    SELECT user_id FROM identities WHERE provider = ${input.provider} AND provider_subject = ${input.subject}
  `;
  if (existing[0] && existing[0].user_id !== input.userId) {
    throw new DomainError("identity_conflict", 409, "That sign-in is already linked to another account");
  }
  if (existing[0]) return { linked: true, already: true };
  await sql`
    INSERT INTO identities (user_id, provider, provider_subject, email)
    VALUES (${input.userId}, ${input.provider}, ${input.subject}, ${input.email ?? null})
  `;
  return { linked: true, already: false };
}

export async function saveOnboarding(sql: Client, input: {
  userId: string;
  step: string;
  displayName?: string;
  birthDate?: string;
  gender?: string;
  homeCountry?: string;
  languages?: string[];
  interests?: string[];
  bio?: string;
  cityId?: string;
  locationPermission?: "granted" | "denied" | "manual";
  notificationsEnabled?: boolean;
  plusDismissed?: boolean;
}) {
  const user = await sql<{ onboarding_step: string }[]>`SELECT onboarding_step FROM users WHERE id = ${input.userId}`;
  if (!user[0]) throw new DomainError("not_found", 404, "Account not found");
  if (input.birthDate) {
    if (!isAdult(input.birthDate)) {
      await sql`UPDATE users SET adult_eligible = false, birth_date = ${input.birthDate}, onboarding_step = 'blocked_underage', updated_at = now() WHERE id = ${input.userId}`;
      throw new DomainError("underage", 403, "solomad is for adults 18 and older");
    }
    await sql`UPDATE users SET birth_date = ${input.birthDate}, adult_eligible = true, updated_at = now() WHERE id = ${input.userId}`;
  }
  if (input.displayName !== undefined) {
    if (input.displayName.trim().length < 2) throw new DomainError("invalid_name", 400, "Add your name");
    await sql`UPDATE profiles SET display_name = ${input.displayName.trim()}, updated_at = now() WHERE user_id = ${input.userId}`;
  }
  if (input.gender !== undefined) await sql`UPDATE profiles SET gender = ${input.gender}, updated_at = now() WHERE user_id = ${input.userId}`;
  if (input.homeCountry !== undefined) await sql`UPDATE profiles SET home_country_code = ${input.homeCountry}, updated_at = now() WHERE user_id = ${input.userId}`;
  if (input.bio !== undefined) {
    if (input.bio.length > 200) throw new DomainError("bio_too_long", 400, "Bio must be 200 characters or fewer");
    await sql`UPDATE profiles SET bio = ${input.bio}, updated_at = now() WHERE user_id = ${input.userId}`;
  }
  if (input.languages) {
    await sql`DELETE FROM profile_languages WHERE user_id = ${input.userId}`;
    for (const language of input.languages) {
      await sql`INSERT INTO profile_languages (user_id, language_code) VALUES (${input.userId}, ${language})`;
    }
  }
  if (input.interests) {
    await sql`DELETE FROM profile_interests WHERE user_id = ${input.userId}`;
    for (const interest of input.interests) {
      await sql`INSERT INTO profile_interests (user_id, interest) VALUES (${input.userId}, ${interest})`;
    }
  }
  if (input.cityId) await sql`UPDATE profiles SET current_city_id = ${input.cityId}, updated_at = now() WHERE user_id = ${input.userId}`;
  if (input.locationPermission) await sql`UPDATE profiles SET location_permission = ${input.locationPermission}, updated_at = now() WHERE user_id = ${input.userId}`;
  if (input.notificationsEnabled !== undefined) {
    await sql`UPDATE preferences SET push_enabled = ${input.notificationsEnabled}, updated_at = now() WHERE user_id = ${input.userId}`;
  }
  const next = nextStep(input);
  const completed = next === "complete";
  await sql`
    UPDATE users SET onboarding_step = ${next},
      onboarding_completed_at = CASE WHEN ${completed} THEN COALESCE(onboarding_completed_at, now()) ELSE onboarding_completed_at END,
      updated_at = now()
    WHERE id = ${input.userId}
  `;
  return { step: next, completed };
}

function nextStep(input: { step: string; plusDismissed?: boolean; notificationsEnabled?: boolean; locationPermission?: string }): string {
  const order = ["name", "photo", "gender", "country", "languages", "interests", "bio", "location", "notifications", "plus", "complete"];
  const index = order.indexOf(input.step);
  if (input.step === "plus" || input.plusDismissed) return "complete";
  if (index < 0) return "name";
  return order[Math.min(index + 1, order.length - 1)] ?? "complete";
}

export async function recordProfileView(sql: Client, input: { profileUserId: string; viewerUserId: string }) {
  if (input.profileUserId === input.viewerUserId) return { recorded: false };
  const blocked = await sql`SELECT 1 FROM blocks WHERE (blocker_id = ${input.profileUserId} AND blocked_id = ${input.viewerUserId}) OR (blocker_id = ${input.viewerUserId} AND blocked_id = ${input.profileUserId})`;
  if (blocked[0]) return { recorded: false };
  const profile = await sql<{ visibility: string }[]>`SELECT visibility FROM profiles WHERE user_id = ${input.profileUserId}`;
  if (profile[0]?.visibility === "hidden") return { recorded: false };
  await sql`
    INSERT INTO profile_views (profile_user_id, viewer_user_id, viewed_on)
    VALUES (${input.profileUserId}, ${input.viewerUserId}, CURRENT_DATE)
    ON CONFLICT DO NOTHING
  `;
  return { recorded: true };
}

export async function listProfileViewers(sql: Client, userId: string) {
  const plus = await sql<{ plus_active: boolean }[]>`SELECT plus_active FROM entitlements WHERE user_id = ${userId}`;
  if (!plus[0]?.plus_active) throw new DomainError("plus_required", 403, "Profile viewers are a Plus feature");
  return sql<{ viewer_user_id: string; display_name: string; viewed_on: string }[]>`
    SELECT pv.viewer_user_id, p.display_name, pv.viewed_on::text
    FROM profile_views pv
    JOIN profiles p ON p.user_id = pv.viewer_user_id
    WHERE pv.profile_user_id = ${userId}
      AND NOT EXISTS (
        SELECT 1 FROM blocks b
        WHERE (b.blocker_id = ${userId} AND b.blocked_id = pv.viewer_user_id)
           OR (b.blocker_id = pv.viewer_user_id AND b.blocked_id = ${userId})
      )
    ORDER BY pv.viewed_on DESC
    LIMIT 50
  `;
}

export async function requestDeletion(sql: Client, userId: string) {
  const [job] = await sql<{ id: string }[]>`
    INSERT INTO deletion_jobs (user_id, status) VALUES (${userId}, 'queued') RETURNING id
  `;
  await sql`UPDATE users SET deletion_requested_at = now(), updated_at = now() WHERE id = ${userId}`;
  await sql`
    INSERT INTO outbox_events (aggregate_type, aggregate_id, event_type, payload)
    VALUES ('user', ${userId}, 'user.deletion_requested', ${sql.json({ userId, jobId: job?.id } as postgres.JSONValue)})
  `;
  return { jobId: job?.id };
}

export async function anonymizeUser(sql: Client, userId: string) {
  await sql.begin(async (tx) => {
    await tx`UPDATE profiles SET display_name = 'Deleted member', bio = NULL, avatar_media_id = NULL, gender = NULL, home_country_code = NULL, visibility = 'hidden', updated_at = now() WHERE user_id = ${userId}`;
    await tx`DELETE FROM profile_languages WHERE user_id = ${userId}`;
    await tx`DELETE FROM profile_interests WHERE user_id = ${userId}`;
    await tx`DELETE FROM identities WHERE user_id = ${userId}`;
    await tx`UPDATE users SET status = 'deleted', birth_date = NULL, adult_eligible = false, deleted_at = now(), updated_at = now() WHERE id = ${userId}`;
    await tx`UPDATE messages SET body = NULL WHERE sender_id = ${userId} AND kind = 'text'`;
    await tx`UPDATE device_tokens SET disabled_at = now() WHERE user_id = ${userId}`;
    await tx`UPDATE location_shares SET stopped_at = now(), latitude = NULL, longitude = NULL WHERE user_id = ${userId}`;
    await tx`DELETE FROM profile_views WHERE profile_user_id = ${userId} OR viewer_user_id = ${userId}`;
    await tx`UPDATE deletion_jobs SET status = 'completed', completed_at = now() WHERE user_id = ${userId} AND status <> 'completed'`;
    await tx`INSERT INTO audit_logs (actor_id, action, target_type, target_id) VALUES (${userId}, 'account.deleted', 'user', ${userId})`;
  });
}

type UserRow = {
  id: string;
  status: string;
  onboarding_step: string;
  onboarding_completed_at: Date | null;
  adult_eligible: boolean;
  pending_deep_link: string | null;
};
