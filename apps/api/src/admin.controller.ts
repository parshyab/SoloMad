import { timingSafeEqual, createHash } from "node:crypto";
import { type AppEnv } from "@solomad/config";
import type { Sql } from "@solomad/db";
import { anonymizeUser, DomainError } from "@solomad/domain";
import { Body, Controller, Get, Inject, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { SignJWT } from "jose";
import { z } from "zod";
import { actorOf, AdminGuard, AuthGuard } from "./http";
import { ENV, SQL } from "./tokens";

@Controller()
export class AdminController {
  constructor(@Inject(SQL) private readonly sql: Sql, @Inject(ENV) private readonly env: AppEnv) {}

  @Post("/v1/admin/session")
  async session(@Body() body: unknown) {
    const input = z.object({ email: z.string().email(), password: z.string() }).parse(body);
    if (!this.env.ADMIN_PASSWORD || !this.env.ADMIN_SESSION_SECRET) {
      throw new DomainError("admin_unconfigured", 503, "Admin sign-in is not configured");
    }
    const emailOk = safeEqual(input.email.toLowerCase(), this.env.ADMIN_EMAIL.toLowerCase());
    const passwordOk = safeEqual(input.password, this.env.ADMIN_PASSWORD);
    if (!emailOk || !passwordOk) throw new DomainError("unauthorized", 401, "Admin sign-in was rejected");
    const token = await new SignJWT({ role: "admin" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(this.env.ADMIN_EMAIL)
      .setIssuer("solomad-admin")
      .setAudience("solomad-admin")
      .setExpirationTime("30m")
      .sign(new TextEncoder().encode(this.env.ADMIN_SESSION_SECRET));
    return { token, expiresIn: 1800 };
  }

  @Get("/v1/admin/health")
  @UseGuards(AuthGuard, AdminGuard)
  async health() {
    const [users] = await this.sql<{ count: string }[]>`SELECT count(*)::text AS count FROM users`;
    const [outbox] = await this.sql<{ count: string }[]>`SELECT count(*)::text AS count FROM outbox_events WHERE published_at IS NULL AND dead_lettered_at IS NULL`;
    const [reports] = await this.sql<{ count: string }[]>`SELECT count(*)::text AS count FROM reports WHERE status = 'open'`;
    return {
      users: Number(users?.count ?? 0),
      pendingOutbox: Number(outbox?.count ?? 0),
      openReports: Number(reports?.count ?? 0),
    };
  }

  @Get("/v1/admin/users")
  @UseGuards(AuthGuard, AdminGuard)
  users(@Query("q") q = "") {
    const pattern = `%${q.trim().slice(0, 80)}%`;
    return this.sql`
      SELECT u.id, u.status, p.display_name, u.created_at
      FROM users u JOIN profiles p ON p.user_id = u.id
      WHERE ${q.trim()} = '' OR p.display_name ILIKE ${pattern}
      ORDER BY u.created_at DESC
      LIMIT 50
    `;
  }

  @Post("/v1/admin/reports/:id")
  @UseGuards(AuthGuard, AdminGuard)
  async moderate(@Req() request: FastifyRequest, @Param("id") id: string, @Body() body: unknown) {
    const input = z.object({ action: z.enum(["dismiss", "suspend"]), notes: z.string().max(500).optional() }).parse(body);
    const actor = actorOf(request);
    const reports = await this.sql<{ target_id: string; target_type: string }[]>`SELECT target_id, target_type FROM reports WHERE id = ${id}`;
    const report = reports[0];
    if (!report) throw new DomainError("not_found", 404, "Report not found");
    await this.sql`UPDATE reports SET status = ${input.action === "dismiss" ? "dismissed" : "actioned"} WHERE id = ${id}`;
    const [action] = await this.sql<{ id: string }[]>`
      INSERT INTO moderation_actions (actor_id, report_id, target_user_id, action, notes)
      VALUES (${actor.id}, ${id}, ${report.target_type === "user" ? report.target_id : null}, ${input.action}, ${input.notes ?? null})
      RETURNING id
    `;
    if (input.action === "suspend" && report.target_type === "user") {
      await this.sql`UPDATE users SET status = 'suspended', updated_at = now() WHERE id = ${report.target_id}`;
    }
    await this.sql`INSERT INTO audit_logs (actor_id, action, target_type, target_id, metadata) VALUES (${actor.id}, ${`report.${input.action}`}, 'report', ${id}, ${this.sql.json({ notes: input.notes ?? null })})`;
    return { actionId: action?.id };
  }

  @Post("/v1/admin/verification/:id")
  @UseGuards(AuthGuard, AdminGuard)
  async review(@Req() request: FastifyRequest, @Param("id") id: string, @Body() body: unknown) {
    const input = z.object({ decision: z.enum(["approved", "rejected"]), reason: z.string().max(300).optional() }).parse(body);
    const actor = actorOf(request);
    const rows = await this.sql<{ user_id: string }[]>`
      UPDATE verification_requests
      SET status = ${input.decision}, reviewer_id = ${actor.id}, reason = ${input.reason ?? null}, reviewed_at = now()
      WHERE id = ${id} AND status = 'pending'
      RETURNING user_id
    `;
    if (!rows[0]) throw new DomainError("not_found", 404, "Verification request is not pending");
    await this.sql`UPDATE profiles SET verification_status = ${input.decision}, updated_at = now() WHERE user_id = ${rows[0].user_id}`;
    await this.sql`INSERT INTO audit_logs (actor_id, action, target_type, target_id) VALUES (${actor.id}, ${`verification.${input.decision}`}, 'verification', ${id})`;
    return { status: input.decision };
  }

  @Get("/v1/admin/audit")
  @UseGuards(AuthGuard, AdminGuard)
  audit() {
    return this.sql`SELECT id, actor_id, action, target_type, target_id, created_at FROM audit_logs ORDER BY created_at DESC LIMIT 100`;
  }

  @Post("/v1/admin/deletion/:userId")
  @UseGuards(AuthGuard, AdminGuard)
  async runDeletion(@Param("userId") userId: string) {
    await anonymizeUser(this.sql, userId);
    return { status: "completed" };
  }
}

function safeEqual(left: string, right: string): boolean {
  const a = createHash("sha256").update(left).digest();
  const b = createHash("sha256").update(right).digest();
  return timingSafeEqual(a, b);
}
