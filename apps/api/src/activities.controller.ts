import type { Sql } from "@solomad/db";
import { cancelActivity, completeActivity, confirmAttendance, createActivity, DomainError, joinActivity, leaveActivity, submitFeedback, updateActivity, viewerState, type Category } from "@solomad/domain";
import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Req, UseGuards } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { actorOf, AuthGuard, idempotencyKey } from "./http";
import { SQL } from "./tokens";

const category = z.enum(["food", "coffee", "outdoors", "culture", "nightlife", "entertainment", "rideshare"]);

@Controller()
@UseGuards(AuthGuard)
export class ActivitiesController {
  constructor(@Inject(SQL) private readonly sql: Sql) {}

  @Post("/v1/activities")
  create(@Req() request: FastifyRequest, @Body() body: unknown) {
    const input = z.object({
      cityId: z.string().uuid(),
      category,
      emoji: z.string().min(1).max(8),
      title: z.string().min(3).max(80),
      description: z.string().max(2000).default(""),
      startsAt: z.string().datetime(),
      endsAt: z.string().datetime().nullable().optional(),
      timezone: z.string().min(1),
      venueName: z.string().min(2).max(120),
      latitude: z.number().gte(-90).lte(90),
      longitude: z.number().gte(-180).lte(180),
      capacity: z.number().int().gte(2).lte(50),
      expenseGuidance: z.string().max(240).nullable().optional(),
    }).parse(body);
    const actor = actorOf(request);
    if (!actor.adult_eligible) throw new DomainError("ineligible", 403, "Complete adult onboarding before hosting");
    return createActivity(this.sql, {
      hostUserId: actor.id,
      category: input.category as Category,
      emoji: input.emoji,
      title: input.title,
      description: input.description,
      startsAt: new Date(input.startsAt),
      endsAt: input.endsAt ? new Date(input.endsAt) : null,
      timezone: input.timezone,
      cityId: input.cityId,
      venueName: input.venueName,
      latitude: input.latitude,
      longitude: input.longitude,
      capacity: input.capacity,
      expenseGuidance: input.expenseGuidance ?? null,
      idempotencyKey: idempotencyKey(request),
    });
  }

  @Get("/v1/activities/:id")
  async detail(@Req() request: FastifyRequest, @Param("id") id: string) {
    const actor = actorOf(request);
    const rows = await this.sql<Detail[]>`
      SELECT a.*, c.name AS city_name, v.name AS venue_name, p.display_name AS host_name,
             ST_Y(a.meeting_point::geometry) AS latitude, ST_X(a.meeting_point::geometry) AS longitude,
             m.status AS membership
      FROM activities a
      JOIN cities c ON c.id = a.city_id
      LEFT JOIN venues v ON v.id = a.venue_id
      JOIN profiles p ON p.user_id = a.host_user_id
      LEFT JOIN activity_memberships m ON m.activity_id = a.id AND m.user_id = ${actor.id}
      WHERE a.id = ${id}
    `;
    const row = rows[0];
    if (!row) throw new DomainError("not_found", 404, "Activity not found");
    const people = await this.sql<{ user_id: string; display_name: string; status: string }[]>`
      SELECT am.user_id, p.display_name, am.status
      FROM activity_memberships am JOIN profiles p ON p.user_id = am.user_id
      WHERE am.activity_id = ${id} AND am.status IN ('host', 'active')
      ORDER BY am.joined_at
    `;
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      emoji: row.emoji,
      category: row.category,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      timezone: row.timezone,
      cityName: row.city_name,
      venueName: row.venue_name,
      latitude: row.latitude,
      longitude: row.longitude,
      capacity: row.capacity,
      goingCount: row.going_count,
      expenseGuidance: row.expense_guidance,
      status: row.status,
      cancelReason: row.cancel_reason,
      version: row.version,
      host: { id: row.host_user_id, displayName: row.host_name },
      participants: people,
      viewerState: viewerState({
        status: row.status,
        startsAt: new Date(row.starts_at),
        hostId: row.host_user_id,
        userId: actor.id,
        membership: row.membership,
        going: row.going_count,
        capacity: row.capacity,
      }),
      directionsUrl: `http://maps.apple.com/?daddr=${row.latitude},${row.longitude}`,
    };
  }

  @Post("/v1/activities/:id/join")
  join(@Req() request: FastifyRequest, @Param("id") id: string) {
    return joinActivity(this.sql, { userId: actorOf(request).id, activityId: id, idempotencyKey: idempotencyKey(request) });
  }

  @Post("/v1/activities/:id/leave")
  leave(@Req() request: FastifyRequest, @Param("id") id: string) {
    return leaveActivity(this.sql, { userId: actorOf(request).id, activityId: id, idempotencyKey: idempotencyKey(request) });
  }

  @Patch("/v1/activities/:id")
  edit(@Req() request: FastifyRequest, @Param("id") id: string, @Body() body: unknown) {
    const input = z.object({
      expectedVersion: z.number().int(),
      title: z.string().min(3).max(80).optional(),
      description: z.string().max(2000).optional(),
      startsAt: z.string().datetime().optional(),
      capacity: z.number().int().optional(),
      expenseGuidance: z.string().max(240).nullable().optional(),
    }).parse(body);
    return updateActivity(this.sql, {
      userId: actorOf(request).id,
      activityId: id,
      expectedVersion: input.expectedVersion,
      title: input.title,
      description: input.description,
      startsAt: input.startsAt ? new Date(input.startsAt) : undefined,
      capacity: input.capacity,
      expenseGuidance: input.expenseGuidance,
    });
  }

  @Post("/v1/activities/:id/cancel")
  cancel(@Req() request: FastifyRequest, @Param("id") id: string, @Body() body: unknown) {
    const input = z.object({ reason: z.string().min(3) }).parse(body);
    return cancelActivity(this.sql, { userId: actorOf(request).id, activityId: id, reason: input.reason });
  }

  @Post("/v1/activities/:id/complete")
  complete(@Req() request: FastifyRequest, @Param("id") id: string) {
    return completeActivity(this.sql, { userId: actorOf(request).id, activityId: id });
  }

  @Post("/v1/activities/:id/attendance")
  attendance(@Req() request: FastifyRequest, @Param("id") id: string, @Body() body: unknown) {
    const input = z.object({ subjectUserId: z.string().uuid().optional(), confirmed: z.boolean() }).parse(body);
    return confirmAttendance(this.sql, { userId: actorOf(request).id, activityId: id, subjectUserId: input.subjectUserId, confirmed: input.confirmed });
  }

  @Post("/v1/activities/:id/feedback")
  feedback(@Req() request: FastifyRequest, @Param("id") id: string, @Body() body: unknown) {
    const input = z.object({ subjectUserId: z.string().uuid(), rating: z.enum(["up", "down"]) }).parse(body);
    return submitFeedback(this.sql, { userId: actorOf(request).id, activityId: id, subjectUserId: input.subjectUserId, rating: input.rating });
  }

  @Post("/v1/activities/:id/save")
  async save(@Req() request: FastifyRequest, @Param("id") id: string) {
    await this.sql`INSERT INTO activity_saves (user_id, activity_id) VALUES (${actorOf(request).id}, ${id}) ON CONFLICT DO NOTHING`;
    return { saved: true };
  }

  @Delete("/v1/activities/:id/save")
  async unsave(@Req() request: FastifyRequest, @Param("id") id: string) {
    await this.sql`DELETE FROM activity_saves WHERE user_id = ${actorOf(request).id} AND activity_id = ${id}`;
    return { saved: false };
  }

  @Get("/v1/me/activities")
  mine(@Req() request: FastifyRequest) {
    return this.sql`
      SELECT a.id, a.title, a.emoji, a.starts_at, a.status, am.status AS membership
      FROM activity_memberships am
      JOIN activities a ON a.id = am.activity_id
      WHERE am.user_id = ${actorOf(request).id} AND am.status IN ('host', 'active')
      ORDER BY a.starts_at
    `;
  }

  @Get("/v1/me/saves")
  saves(@Req() request: FastifyRequest) {
    return this.sql`
      SELECT a.id, a.title, a.emoji, a.starts_at, a.status
      FROM activity_saves s JOIN activities a ON a.id = s.activity_id
      WHERE s.user_id = ${actorOf(request).id}
      ORDER BY s.created_at DESC
    `;
  }

  @Post("/v1/drafts")
  async draft(@Req() request: FastifyRequest, @Body() body: unknown) {
    const payload = z.record(z.unknown()).parse(body);
    const [row] = await this.sql<{ id: string }[]>`
      INSERT INTO activity_drafts (user_id, payload) VALUES (${actorOf(request).id}, ${this.sql.json(payload as never)}) RETURNING id
    `;
    return { draftId: row?.id };
  }
}

type Detail = {
  id: string; title: string; description: string; emoji: string; category: string; starts_at: Date; ends_at: Date | null;
  timezone: string; city_name: string; venue_name: string | null; latitude: number; longitude: number; capacity: number;
  going_count: number; expense_guidance: string | null; status: string; cancel_reason: string | null; version: number;
  host_user_id: string; host_name: string; membership: string | null;
};
