import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { type AppEnv } from "@solomad/config";
import type { Sql } from "@solomad/db";
import { acceptRecommendations, blockUser, createReport, createTicket, DomainError, listProfileViewers, rankVenues, requestDeletion } from "@solomad/domain";
import { Body, Controller, Get, Inject, Param, Post, Req, UseGuards } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { actorOf, AuthGuard, type AppRequest } from "./http";
import { ENV, SQL } from "./tokens";

@Controller()
export class AccountController {
  constructor(@Inject(SQL) private readonly sql: Sql, @Inject(ENV) private readonly env: AppEnv) {}

  @Post("/v1/uploads")
  @UseGuards(AuthGuard)
  async startUpload(@Req() request: FastifyRequest, @Body() body: unknown) {
    const input = z.object({
      kind: z.enum(["avatar", "verification", "chat"]),
      contentType: z.enum(["image/jpeg", "image/png", "image/webp"]),
      byteSize: z.number().int().positive().max(8_000_000),
    }).parse(body);
    const actor = actorOf(request);
    const visibility = input.kind === "avatar" ? "public" : "private";
    const storageKey = `${input.kind}/${actor.id}/${randomUUID()}`;
    const [media] = await this.sql<{ id: string }[]>`
      INSERT INTO media_objects (owner_id, kind, status, content_type, byte_size, storage_key, visibility)
      VALUES (${actor.id}, ${input.kind}, 'pending', ${input.contentType}, ${input.byteSize}, ${storageKey}, ${visibility})
      RETURNING id
    `;
    if (!media) throw new DomainError("upload_failed", 500, "Upload could not be started");
    if (this.env.MEDIA_PROVIDER === "s3") {
      if (!this.env.S3_BUCKET) throw new DomainError("media_unconfigured", 503, "S3 is not configured");
      const client = new S3Client({
        region: this.env.S3_REGION,
        endpoint: this.env.S3_ENDPOINT || undefined,
        forcePathStyle: this.env.S3_FORCE_PATH_STYLE === "true",
        credentials: this.env.S3_ACCESS_KEY_ID && this.env.S3_SECRET_ACCESS_KEY ? {
          accessKeyId: this.env.S3_ACCESS_KEY_ID,
          secretAccessKey: this.env.S3_SECRET_ACCESS_KEY,
        } : undefined,
      });
      const uploadUrl = await getSignedUrl(client, new PutObjectCommand({
        Bucket: this.env.S3_BUCKET,
        Key: storageKey,
        ContentType: input.contentType,
        ContentLength: input.byteSize,
      }), { expiresIn: 300 });
      return { mediaId: media.id, uploadUrl, method: "PUT" };
    }
    return { mediaId: media.id, uploadUrl: `${this.env.API_PUBLIC_ORIGIN}/v1/uploads/${media.id}/content`, method: "PUT" };
  }

  @Post("/v1/uploads/:id/finalize")
  @UseGuards(AuthGuard)
  async finalize(@Req() request: FastifyRequest, @Param("id") id: string, @Body() body: unknown) {
    const input = z.object({ width: z.number().int().positive(), height: z.number().int().positive() }).parse(body);
    const actor = actorOf(request);
    const rows = await this.sql<{ id: string; kind: string }[]>`
      UPDATE media_objects SET status = 'ready', width = ${input.width}, height = ${input.height}
      WHERE id = ${id} AND owner_id = ${actor.id} AND status = 'pending'
      RETURNING id, kind
    `;
    if (!rows[0]) throw new DomainError("not_found", 404, "Upload not found");
    if (rows[0].kind === "avatar") {
      await this.sql`UPDATE profiles SET avatar_media_id = ${id}, updated_at = now() WHERE user_id = ${actor.id}`;
    }
    return { mediaId: id, status: "ready" };
  }

  @Post("/v1/verification")
  @UseGuards(AuthGuard)
  async verification(@Req() request: FastifyRequest, @Body() body: unknown) {
    const input = z.object({ mediaId: z.string().uuid() }).parse(body);
    const actor = actorOf(request);
    const media = await this.sql`SELECT 1 FROM media_objects WHERE id = ${input.mediaId} AND owner_id = ${actor.id} AND kind = 'verification' AND status = 'ready'`;
    if (!media[0]) throw new DomainError("invalid_media", 400, "Submit a processed verification photo");
    const [row] = await this.sql<{ id: string }[]>`
      INSERT INTO verification_requests (user_id, media_id, status) VALUES (${actor.id}, ${input.mediaId}, 'pending') RETURNING id
    `;
    await this.sql`UPDATE profiles SET verification_status = 'pending', updated_at = now() WHERE user_id = ${actor.id}`;
    return { requestId: row?.id, status: "pending" };
  }

  @Get("/v1/recommendations")
  @UseGuards(AuthGuard)
  recommendations(@Req() request: FastifyRequest) {
    return this.recommend(actorOf(request).id, request);
  }

  @Get("/v1/notifications")
  @UseGuards(AuthGuard)
  notifications(@Req() request: FastifyRequest) {
    return this.sql`
      SELECT id, type, title, body, resource_type, resource_id, read_at, created_at
      FROM notifications WHERE user_id = ${actorOf(request).id}
      ORDER BY created_at DESC LIMIT 50
    `;
  }

  @Post("/v1/devices")
  @UseGuards(AuthGuard)
  async device(@Req() request: FastifyRequest, @Body() body: unknown) {
    const input = z.object({
      token: z.string().min(8),
      environment: z.enum(["sandbox", "production"]),
      bundleId: z.string().min(3),
    }).parse(body);
    await this.sql`
      INSERT INTO device_tokens (user_id, token, environment, bundle_id)
      VALUES (${actorOf(request).id}, ${input.token}, ${input.environment}, ${input.bundleId})
      ON CONFLICT (token) DO UPDATE SET user_id = EXCLUDED.user_id, environment = EXCLUDED.environment, disabled_at = NULL, updated_at = now()
    `;
    return { registered: true };
  }

  @Get("/v1/entitlements")
  @UseGuards(AuthGuard)
  async entitlements(@Req() request: FastifyRequest) {
    const rows = await this.sql<{ plus_active: boolean; status: string; product_id: string | null; expires_at: Date | null; will_renew: boolean }[]>`
      SELECT plus_active, status, product_id, expires_at, will_renew FROM entitlements WHERE user_id = ${actorOf(request).id}
    `;
    const row = rows[0];
    return {
      plusActive: Boolean(row?.plus_active),
      status: row?.status ?? "none",
      productId: row?.product_id ?? null,
      expiresAt: row?.expires_at ?? null,
      willRenew: Boolean(row?.will_renew),
      source: "server",
    };
  }

  @Get("/v1/me/viewers")
  @UseGuards(AuthGuard)
  viewers(@Req() request: FastifyRequest) {
    return listProfileViewers(this.sql, actorOf(request).id);
  }

  @Post("/v1/reports")
  @UseGuards(AuthGuard)
  report(@Req() request: FastifyRequest, @Body() body: unknown) {
    const input = z.object({ targetType: z.string(), targetId: z.string().uuid(), reason: z.string() }).parse(body);
    return createReport(this.sql, { reporterId: actorOf(request).id, ...input });
  }

  @Post("/v1/blocks")
  @UseGuards(AuthGuard)
  block(@Req() request: FastifyRequest, @Body() body: unknown) {
    const input = z.object({ userId: z.string().uuid() }).parse(body);
    return blockUser(this.sql, actorOf(request).id, input.userId);
  }

  @Get("/v1/blocks")
  @UseGuards(AuthGuard)
  blocks(@Req() request: FastifyRequest) {
    return this.sql`
      SELECT b.blocked_id, p.display_name, b.created_at
      FROM blocks b JOIN profiles p ON p.user_id = b.blocked_id
      WHERE b.blocker_id = ${actorOf(request).id}
    `;
  }

  @Post("/v1/support/tickets")
  @UseGuards(AuthGuard)
  ticket(@Req() request: FastifyRequest, @Body() body: unknown) {
    const input = z.object({ subject: z.string().min(3), body: z.string().min(3) }).parse(body);
    return createTicket(this.sql, { userId: actorOf(request).id, subject: input.subject, body: input.body });
  }

  @Post("/v1/me/export")
  @UseGuards(AuthGuard)
  async exportAccount(@Req() request: FastifyRequest) {
    const [job] = await this.sql<{ id: string }[]>`
      INSERT INTO export_jobs (user_id, status) VALUES (${actorOf(request).id}, 'queued') RETURNING id
    `;
    return { jobId: job?.id, status: "queued" };
  }

  @Post("/v1/me/deletion")
  @UseGuards(AuthGuard)
  deletion(@Req() request: FastifyRequest) {
    return requestDeletion(this.sql, actorOf(request).id);
  }

  @Post("/v1/webhooks/revenuecat")
  async revenuecat(@Req() request: AppRequest, @Body() body: unknown) {
    const secret = this.env.REVENUECAT_WEBHOOK_SECRET;
    if (!secret) throw new DomainError("webhook_unconfigured", 503, "RevenueCat webhook secret is not configured");
    const header = request.headers.authorization ?? "";
    const provided = header.startsWith("Bearer ") ? header.slice(7) : header;
    if (!safeEqual(provided, secret)) throw new DomainError("unauthorized", 401, "Webhook signature was rejected");
    const event = z.object({
      event: z.object({
        id: z.string(),
        type: z.string(),
        app_user_id: z.string().optional(),
        product_id: z.string().optional(),
        expiration_at_ms: z.number().optional(),
      }),
    }).parse(body).event;
    const { ingestRevenueEvent } = await import("@solomad/domain");
    const raw = Buffer.isBuffer(request.rawBody) ? request.rawBody.toString("utf8") : JSON.stringify(body);
    return ingestRevenueEvent(this.sql, { event, raw: JSON.parse(raw) as unknown });
  }

  private async recommend(userId: string, request: FastifyRequest) {
    const cityId = typeof request.query === "object" && request.query && "cityId" in request.query ? String(request.query.cityId) : "";
    const venues = await this.sql<{ id: string; name: string; category_hint: string; latitude: number; longitude: number }[]>`
      SELECT id, name, COALESCE(provider, 'venue') AS category_hint,
             ST_Y(location::geometry) AS latitude, ST_X(location::geometry) AS longitude
      FROM venues
      WHERE ${cityId} = '' OR city_id = ${cityId || null}
      LIMIT 20
    `;
    const interests = await this.sql<{ interest: string }[]>`SELECT interest FROM profile_interests WHERE user_id = ${userId}`;
    const interestNames = interests.map((row) => row.interest);
    const ranked = rankVenues(venues.map((venue) => ({
      id: venue.id,
      name: venue.name,
      categoryHint: interestNames.includes("coffee") && venue.name.toLowerCase().includes("coffee") ? "coffee" : "food",
      latitude: venue.latitude,
      longitude: venue.longitude,
    })), interestNames);
    const fallback = ranked.map((venue) => ({
      venueId: venue.id,
      title: `meet at ${venue.name}`,
      emoji: "🍝",
      category: "food" as const,
      reason: "Suggested from places already in solomad. Confirm the time before you publish.",
    }));
    if (!this.env.ANTHROPIC_API_KEY) return { source: "database", ai: "unavailable", ideas: fallback };
    const plus = await this.sql<{ plus_active: boolean }[]>`SELECT plus_active FROM entitlements WHERE user_id = ${userId}`;
    const quota = plus[0]?.plus_active ? this.env.AI_DAILY_QUOTA_PLUS : this.env.AI_DAILY_QUOTA_FREE;
    const usage = await this.sql<{ requests: number }[]>`SELECT requests FROM ai_usage WHERE user_id = ${userId} AND used_on = CURRENT_DATE`;
    if ((usage[0]?.requests ?? 0) >= quota) return { source: "database", ideas: fallback, limited: true };
    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": this.env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: this.env.ANTHROPIC_MODEL,
          max_tokens: 600,
          messages: [{
            role: "user",
            content: `Return JSON {"ideas":[{"venueId","title","emoji","category","reason"}]} using only these venues: ${JSON.stringify(ranked)}. Do not invent places, coordinates, or opening hours. Interests: ${interestNames.join(", ")}`,
          }],
        }),
      });
      if (!response.ok) return { source: "database", ideas: fallback };
      const payload = await response.json() as { content?: Array<{ text?: string }>; usage?: { input_tokens?: number; output_tokens?: number } };
      const text = payload.content?.map((part) => part.text ?? "").join("") ?? "";
      const match = text.match(/\{[\s\S]*\}/);
      const ideas = acceptRecommendations(JSON.parse(match?.[0] ?? "{}"), new Set(ranked.map((venue) => venue.id)));
      const tokens = (payload.usage?.input_tokens ?? 0) + (payload.usage?.output_tokens ?? 0);
      await this.sql`
        INSERT INTO ai_usage (user_id, used_on, requests, tokens) VALUES (${userId}, CURRENT_DATE, 1, ${tokens})
        ON CONFLICT (user_id, used_on) DO UPDATE SET requests = ai_usage.requests + 1, tokens = ai_usage.tokens + ${tokens}
      `;
      return { source: "anthropic", ideas };
    } catch {
      return { source: "database", ideas: fallback };
    }
  }
}

function safeEqual(left: string, right: string): boolean {
  const a = createHash("sha256").update(left).digest();
  const b = createHash("sha256").update(right).digest();
  return timingSafeEqual(a, b);
}
