import type { Sql } from "@solomad/db";
import { assertMember, closePoll, createPoll, createTrip, deleteTrip, DomainError, listLocationShares, overlapsForTrip, sendMessage, startLocationShare, stopLocationShare, updateLocationShare, updateTrip, votePoll } from "@solomad/domain";
import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { actorOf, AuthGuard } from "./http";
import { SQL } from "./tokens";

@Controller()
@UseGuards(AuthGuard)
export class SocialController {
  constructor(@Inject(SQL) private readonly sql: Sql) {}

  @Get("/v1/trips")
  async trips(@Req() request: FastifyRequest) {
    const userId = actorOf(request).id;
    const rows = await this.sql`
      SELECT t.id, t.city_id, c.name AS city_name, c.timezone, t.start_date::text, t.end_date::text,
             CASE WHEN t.end_date < CURRENT_DATE THEN 'past' ELSE 'upcoming' END AS bucket
      FROM trips t JOIN cities c ON c.id = t.city_id
      WHERE t.user_id = ${userId}
      ORDER BY t.start_date
    `;
    return { trips: rows };
  }

  @Post("/v1/trips")
  create(@Req() request: FastifyRequest, @Body() body: unknown) {
    const input = z.object({ cityId: z.string().uuid(), startDate: z.string(), endDate: z.string() }).parse(body);
    return createTrip(this.sql, { userId: actorOf(request).id, ...input });
  }

  @Get("/v1/trips/:id")
  async trip(@Req() request: FastifyRequest, @Param("id") id: string) {
    const userId = actorOf(request).id;
    const rows = await this.sql<{ id: string; city_id: string; city_name: string; timezone: string; start_date: string; end_date: string }[]>`
      SELECT t.id, t.city_id, c.name AS city_name, c.timezone, t.start_date::text, t.end_date::text
      FROM trips t JOIN cities c ON c.id = t.city_id
      WHERE t.id = ${id} AND t.user_id = ${userId}
    `;
    const trip = rows[0];
    if (!trip) throw new DomainError("not_found", 404, "Trip not found");
    const overlaps = await overlapsForTrip(this.sql, { userId, tripId: id });
    const chat = await this.sql<{ id: string }[]>`
      SELECT c.id FROM conversations c
      JOIN conversation_members cm ON cm.conversation_id = c.id AND cm.user_id = ${userId} AND cm.removed_at IS NULL
      WHERE c.kind = 'city' AND c.city_id = ${trip.city_id}
      LIMIT 1
    `;
    return { ...trip, overlaps, cityConversationId: chat[0]?.id ?? null };
  }

  @Patch("/v1/trips/:id")
  edit(@Req() request: FastifyRequest, @Param("id") id: string, @Body() body: unknown) {
    const input = z.object({ startDate: z.string(), endDate: z.string() }).parse(body);
    return updateTrip(this.sql, { userId: actorOf(request).id, tripId: id, ...input });
  }

  @Delete("/v1/trips/:id")
  remove(@Req() request: FastifyRequest, @Param("id") id: string) {
    return deleteTrip(this.sql, { userId: actorOf(request).id, tripId: id });
  }

  @Get("/v1/trips/:id/overlaps")
  overlaps(@Req() request: FastifyRequest, @Param("id") id: string) {
    return overlapsForTrip(this.sql, { userId: actorOf(request).id, tripId: id });
  }

  @Get("/v1/conversations")
  inbox(@Req() request: FastifyRequest, @Query("q") q = "") {
    const userId = actorOf(request).id;
    const pattern = `%${q.trim().slice(0, 80)}%`;
    return this.sql`
      SELECT c.id, c.kind, c.title, c.activity_id, c.city_id,
             m.body AS last_body, m.created_at AS last_at,
             (
               SELECT count(*) FROM messages unread
               WHERE unread.conversation_id = c.id
                 AND unread.sender_id <> ${userId}
                 AND unread.created_at > COALESCE((SELECT last_read_at FROM read_cursors rc WHERE rc.conversation_id = c.id AND rc.user_id = ${userId}), '-infinity'::timestamptz)
             )::text AS unread_count
      FROM conversation_members cm
      JOIN conversations c ON c.id = cm.conversation_id
      LEFT JOIN LATERAL (
        SELECT body, created_at FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1
      ) m ON true
      WHERE cm.user_id = ${userId} AND cm.removed_at IS NULL
        AND (${q.trim()} = '' OR c.title ILIKE ${pattern})
      ORDER BY COALESCE(m.created_at, c.created_at) DESC
    `;
  }

  @Get("/v1/conversations/:id/messages")
  async messages(@Req() request: FastifyRequest, @Param("id") id: string, @Query("before") before?: string) {
    const userId = actorOf(request).id;
    await assertMember(this.sql, id, userId);
    const cursor = before ? new Date(before) : null;
    const rows = await this.sql`
      SELECT id, sender_id, client_message_id, body, kind, created_at
      FROM messages
      WHERE conversation_id = ${id}
        AND (${cursor}::timestamptz IS NULL OR created_at < ${cursor})
      ORDER BY created_at DESC
      LIMIT 50
    `;
    return { messages: [...rows].reverse() };
  }

  @Post("/v1/conversations/:id/messages")
  send(@Req() request: FastifyRequest, @Param("id") id: string, @Body() body: unknown) {
    const input = z.object({
      clientMessageId: z.string().min(8).max(80),
      body: z.string().max(4000).default(""),
      kind: z.enum(["text", "image"]).default("text"),
      mediaId: z.string().uuid().optional(),
    }).parse(body);
    return sendMessage(this.sql, { userId: actorOf(request).id, conversationId: id, ...input });
  }

  @Post("/v1/conversations/:id/read")
  async read(@Req() request: FastifyRequest, @Param("id") id: string) {
    const userId = actorOf(request).id;
    await assertMember(this.sql, id, userId);
    await this.sql`
      INSERT INTO read_cursors (conversation_id, user_id, last_read_at)
      VALUES (${id}, ${userId}, now())
      ON CONFLICT (conversation_id, user_id) DO UPDATE SET last_read_at = now()
    `;
    return { ok: true };
  }

  @Post("/v1/polls")
  poll(@Req() request: FastifyRequest, @Body() body: unknown) {
    const input = z.object({
      conversationId: z.string().uuid(),
      question: z.string().min(3).max(200),
      options: z.array(z.string().min(1).max(80)).min(2).max(6),
    }).parse(body);
    return createPoll(this.sql, { userId: actorOf(request).id, ...input });
  }

  @Post("/v1/polls/:id/votes")
  vote(@Req() request: FastifyRequest, @Param("id") id: string, @Body() body: unknown) {
    const input = z.object({ optionId: z.string().uuid() }).parse(body);
    return votePoll(this.sql, { userId: actorOf(request).id, pollId: id, optionId: input.optionId });
  }

  @Post("/v1/polls/:id/close")
  close(@Req() request: FastifyRequest, @Param("id") id: string) {
    return closePoll(this.sql, { userId: actorOf(request).id, pollId: id });
  }

  @Post("/v1/location-shares")
  startShare(@Req() request: FastifyRequest, @Body() body: unknown) {
    const input = z.object({ conversationId: z.string().uuid(), minutes: z.number().int() }).parse(body);
    return startLocationShare(this.sql, { userId: actorOf(request).id, ...input });
  }

  @Post("/v1/location-shares/:id")
  updateShare(@Req() request: FastifyRequest, @Param("id") id: string, @Body() body: unknown) {
    const input = z.object({ latitude: z.number(), longitude: z.number() }).parse(body);
    return updateLocationShare(this.sql, { userId: actorOf(request).id, shareId: id, ...input });
  }

  @Post("/v1/location-shares/:id/stop")
  stop(@Req() request: FastifyRequest, @Param("id") id: string) {
    return stopLocationShare(this.sql, { userId: actorOf(request).id, shareId: id });
  }

  @Get("/v1/conversations/:id/location-shares")
  shares(@Req() request: FastifyRequest, @Param("id") id: string) {
    return listLocationShares(this.sql, { userId: actorOf(request).id, conversationId: id });
  }
}
