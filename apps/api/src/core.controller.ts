import { type AppEnv } from "@solomad/config";
import { openApiDocument } from "@solomad/contracts";
import type { Sql } from "@solomad/db";
import { DomainError, linkIdentity, recordProfileView, saveOnboarding, searchDiscovery, searchPlaces, upsertUserFromIdentity, viewerState } from "@solomad/domain";
import { Body, Controller, Get, Inject, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { actorOf, AuthGuard } from "./http";
import { verifyIdentity } from "./identity";
import { ENV, REDIS, SQL } from "./tokens";
import type { Redis } from "ioredis";

@Controller()
export class CoreController {
  constructor(
    @Inject(SQL) private readonly sql: Sql,
    @Inject(ENV) private readonly env: AppEnv,
    @Inject(REDIS) private readonly redis: Redis | null,
  ) {}

  @Get("/health")
  health() {
    return { ok: true };
  }

  @Get("/ready")
  async ready() {
    await this.sql`SELECT 1`;
    return { ok: true, database: "up" };
  }

  @Get("/v1/openapi.json")
  spec() {
    return openApiDocument();
  }

  @Get("/v1/public/stats")
  async stats() {
    const rows = await this.sql<{ count: string }[]>`
      SELECT count(*)::text AS count FROM users
      WHERE status = 'active' AND onboarding_completed_at IS NOT NULL AND adult_eligible
    `;
    return { activeTravelerCount: Number(rows[0]?.count ?? 0), source: "database" };
  }

  @Get("/v1/public/activities/:id")
  async publicActivity(@Param("id") id: string) {
    const rows = await this.sql<PublicActivity[]>`
      SELECT a.id, a.title, a.emoji, a.category, a.starts_at, a.timezone, a.capacity, a.going_count, a.status,
             c.name AS city_name, v.name AS venue_name, p.display_name AS host_name
      FROM activities a
      JOIN cities c ON c.id = a.city_id
      LEFT JOIN venues v ON v.id = a.venue_id
      JOIN profiles p ON p.user_id = a.host_user_id
      WHERE a.id = ${id}
    `;
    const row = rows[0];
    if (!row || row.status === "draft") throw new DomainError("not_found", 404, "Activity not found");
    return {
      id: row.id,
      title: row.title,
      emoji: row.emoji,
      category: row.category,
      startsAt: row.starts_at,
      timezone: row.timezone,
      cityName: row.city_name,
      venueName: row.venue_name,
      capacity: row.capacity,
      goingCount: row.going_count,
      status: row.status,
      hostName: row.host_name,
      shareUrl: `https://${this.env.SHARE_HOST}/a/${row.id}`,
    };
  }

  @Post("/v1/auth/session")
  async session(@Body() body: unknown) {
    const input = z.object({ idToken: z.string().min(10) }).parse(body);
    const identity = await verifyIdentity(input.idToken, this.env);
    const user = await upsertUserFromIdentity(this.sql, identity);
    return { account: await this.account(user.id) };
  }

  @Get("/v1/me")
  @UseGuards(AuthGuard)
  async me(@Req() request: FastifyRequest) {
    return { account: await this.account(actorOf(request).id) };
  }

  @Patch("/v1/me/onboarding")
  @UseGuards(AuthGuard)
  async onboarding(@Req() request: FastifyRequest, @Body() body: unknown) {
    const input = onboardingSchema.parse(body);
    const actor = actorOf(request);
    const result = await saveOnboarding(this.sql, { userId: actor.id, ...input });
    return { ...result, account: await this.account(actor.id) };
  }

  @Patch("/v1/me/profile")
  @UseGuards(AuthGuard)
  async profile(@Req() request: FastifyRequest, @Body() body: unknown) {
    const input = onboardingSchema.partial().parse(body);
    const actor = actorOf(request);
    await saveOnboarding(this.sql, { userId: actor.id, step: actor.onboarding_step, ...input });
    return { account: await this.account(actor.id) };
  }

  @Post("/v1/me/identities/link")
  @UseGuards(AuthGuard)
  async link(@Req() request: FastifyRequest, @Body() body: unknown) {
    const input = z.object({ idToken: z.string().min(10) }).parse(body);
    const identity = await verifyIdentity(input.idToken, this.env);
    return linkIdentity(this.sql, { userId: actorOf(request).id, ...identity });
  }

  @Get("/v1/cities")
  @UseGuards(AuthGuard)
  cities(@Query("q") q = "") {
    const pattern = `%${q.trim().slice(0, 80)}%`;
    return this.sql`
      SELECT id, name, slug, country_code, timezone,
             ST_Y(location::geometry) AS latitude, ST_X(location::geometry) AS longitude
      FROM cities
      WHERE ${q.trim()} = '' OR name ILIKE ${pattern}
      ORDER BY name
    `;
  }

  @Get("/v1/discovery")
  @UseGuards(AuthGuard)
  async discovery(@Req() request: FastifyRequest, @Query() query: Record<string, string | undefined>) {
    const actor = actorOf(request);
    const parsed = {
      userId: actor.id,
      category: query.category && query.category !== "all" ? query.category : undefined,
      north: numberOrUndefined(query.north),
      south: numberOrUndefined(query.south),
      east: numberOrUndefined(query.east),
      west: numberOrUndefined(query.west),
      latitude: numberOrUndefined(query.latitude),
      longitude: numberOrUndefined(query.longitude),
      radiusMeters: numberOrUndefined(query.radiusMeters),
      availableOnly: query.availableOnly === "true",
      zoom: numberOrUndefined(query.zoom),
      limit: numberOrUndefined(query.limit),
    };
    const cacheKey = `disc:${JSON.stringify({ ...parsed, userId: undefined })}`;
    if (this.redis) {
      const cached = await this.redis.get(cacheKey).catch(() => null);
      if (cached) {
        const payload = JSON.parse(cached) as { mode: string; items: Array<Record<string, unknown>> };
        return this.personalize(payload, actor.id);
      }
    }
    const result = await searchDiscovery(this.sql, parsed);
    if (this.redis && result.mode === "items") {
      const publicItems = result.items.map((item) => ({ ...item, membership: null }));
      await this.redis.set(cacheKey, JSON.stringify({ mode: result.mode, items: publicItems, clusters: result.clusters }), "EX", 30).catch(() => undefined);
    }
    return {
      mode: result.mode,
      clusters: result.clusters,
      items: result.items.map((item) => this.card(item, actor.id)),
    };
  }

  @Get("/v1/search")
  @UseGuards(AuthGuard)
  search(@Query("q") q = "") {
    if (q.trim().length < 2) return { cities: [], activities: [], venues: [] };
    return searchPlaces(this.sql, q);
  }

  @Get("/v1/profiles/:id")
  @UseGuards(AuthGuard)
  async profileById(@Req() request: FastifyRequest, @Param("id") id: string) {
    const actor = actorOf(request);
    const blocked = await this.sql`SELECT 1 FROM blocks WHERE (blocker_id = ${actor.id} AND blocked_id = ${id}) OR (blocker_id = ${id} AND blocked_id = ${actor.id})`;
    if (blocked[0]) throw new DomainError("not_found", 404, "Profile not available");
    const rows = await this.sql<ProfileRow[]>`
      SELECT p.user_id, p.display_name, p.bio, p.gender, p.home_country_code, p.verification_status, p.visibility,
             (SELECT count(*) FROM feedback f WHERE f.subject_id = p.user_id AND f.rating = 'up')::text AS thumbs_up
      FROM profiles p JOIN users u ON u.id = p.user_id
      WHERE p.user_id = ${id} AND u.status = 'active' AND p.visibility <> 'hidden'
    `;
    const profile = rows[0];
    if (!profile) throw new DomainError("not_found", 404, "Profile not available");
    await recordProfileView(this.sql, { profileUserId: id, viewerUserId: actor.id });
    const languages = await this.sql<{ language_code: string }[]>`SELECT language_code FROM profile_languages WHERE user_id = ${id}`;
    const interests = await this.sql<{ interest: string }[]>`SELECT interest FROM profile_interests WHERE user_id = ${id}`;
    return {
      id: profile.user_id,
      displayName: profile.display_name,
      bio: profile.bio,
      gender: profile.gender,
      homeCountry: profile.home_country_code,
      verificationStatus: profile.verification_status,
      thumbsUpCount: Number(profile.thumbs_up),
      languages: languages.map((row) => row.language_code),
      interests: interests.map((row) => row.interest),
    };
  }

  private async personalize(payload: { mode: string; items?: Array<Record<string, unknown>> }, userId: string) {
    const items = payload.items ?? [];
    const ids = items.map((item) => String(item.id));
    const memberships = ids.length
      ? await this.sql<{ activity_id: string; status: string }[]>`
          SELECT activity_id, status FROM activity_memberships WHERE user_id = ${userId} AND activity_id = ANY(${ids}::uuid[])
        `
      : [];
    const byId = new Map(memberships.map((row) => [row.activity_id, row.status]));
    return {
      ...payload,
      items: items.map((item) => this.card({ ...item, membership: byId.get(String(item.id)) ?? null } as DiscoveryLike, userId)),
    };
  }

  private card(item: DiscoveryLike, userId: string) {
    return {
      id: item.id,
      title: item.title,
      emoji: item.emoji,
      category: item.category,
      startsAt: item.starts_at,
      timezone: item.timezone,
      cityName: item.city_name,
      venueName: item.venue_name,
      latitude: item.latitude,
      longitude: item.longitude,
      goingCount: item.going_count,
      capacity: item.capacity,
      host: { id: item.host_user_id, displayName: item.host_name },
      viewerState: viewerState({
        status: item.status,
        startsAt: new Date(item.starts_at),
        hostId: item.host_user_id,
        userId,
        membership: item.membership,
        going: item.going_count,
        capacity: item.capacity,
      }),
    };
  }

  private async account(userId: string) {
    const rows = await this.sql<AccountRow[]>`
      SELECT u.id, u.status, u.onboarding_step, u.onboarding_completed_at, u.adult_eligible, u.pending_deep_link,
             p.display_name, p.bio, p.gender, p.home_country_code, p.verification_status, p.current_city_id, p.location_permission,
             e.plus_active, e.status AS entitlement_status
      FROM users u
      JOIN profiles p ON p.user_id = u.id
      JOIN entitlements e ON e.user_id = u.id
      WHERE u.id = ${userId}
    `;
    const row = rows[0];
    if (!row) throw new DomainError("not_found", 404, "Account not found");
    const languages = await this.sql<{ language_code: string }[]>`SELECT language_code FROM profile_languages WHERE user_id = ${userId}`;
    const interests = await this.sql<{ interest: string }[]>`SELECT interest FROM profile_interests WHERE user_id = ${userId}`;
    return {
      id: row.id,
      status: row.status,
      onboardingStep: row.onboarding_step,
      onboardingComplete: Boolean(row.onboarding_completed_at),
      adultEligible: row.adult_eligible,
      pendingDeepLink: row.pending_deep_link,
      displayName: row.display_name,
      bio: row.bio,
      gender: row.gender,
      homeCountry: row.home_country_code,
      verificationStatus: row.verification_status,
      currentCityId: row.current_city_id,
      locationPermission: row.location_permission,
      plusActive: row.plus_active,
      entitlementStatus: row.entitlement_status,
      languages: languages.map((item) => item.language_code),
      interests: interests.map((item) => item.interest),
    };
  }
}

const onboardingSchema = z.object({
  step: z.string(),
  displayName: z.string().optional(),
  birthDate: z.string().optional(),
  gender: z.string().optional(),
  homeCountry: z.string().length(2).optional(),
  languages: z.array(z.string()).optional(),
  interests: z.array(z.string()).optional(),
  bio: z.string().max(200).optional(),
  cityId: z.string().uuid().optional(),
  locationPermission: z.enum(["granted", "denied", "manual"]).optional(),
  notificationsEnabled: z.boolean().optional(),
  plusDismissed: z.boolean().optional(),
});

function numberOrUndefined(value: string | undefined): number | undefined {
  if (value === undefined || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

type PublicActivity = {
  id: string; title: string; emoji: string; category: string; starts_at: Date; timezone: string;
  capacity: number; going_count: number; status: string; city_name: string; venue_name: string | null; host_name: string;
};
type ProfileRow = {
  user_id: string; display_name: string; bio: string | null; gender: string | null; home_country_code: string | null;
  verification_status: string; visibility: string; thumbs_up: string;
};
type AccountRow = {
  id: string; status: string; onboarding_step: string; onboarding_completed_at: Date | null; adult_eligible: boolean;
  pending_deep_link: string | null; display_name: string; bio: string | null; gender: string | null; home_country_code: string | null;
  verification_status: string; current_city_id: string | null; location_permission: string; plus_active: boolean; entitlement_status: string;
};
type DiscoveryLike = {
  id: string; title: string; emoji: string; category: string; starts_at: Date | string; timezone: string; city_name: string;
  venue_name: string | null; latitude: number; longitude: number; going_count: number; capacity: number; host_user_id: string;
  host_name: string; status: string; membership: string | null;
};
