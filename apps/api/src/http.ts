import { type AppEnv } from "@solomad/config";
import type { Sql } from "@solomad/db";
import { DomainError, isDomainError, upsertUserFromIdentity } from "@solomad/domain";
import { type CanActivate, type ExceptionFilter, type ExecutionContext, Catch, HttpException, Inject, Injectable, ArgumentsHost } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { jwtVerify } from "jose";
import { ZodError } from "zod";
import { verifyIdentity } from "./identity";
import { ENV, SQL } from "./tokens";

export type Actor = {
  id: string;
  status: string;
  onboarding_step: string;
  onboarding_completed_at: Date | null;
  adult_eligible: boolean;
  pending_deep_link: string | null;
  roles: string[];
};

export type AppRequest = FastifyRequest & { actor?: Actor; rawBody?: string | Buffer };

export function actorOf(request: FastifyRequest): Actor {
  const actor = (request as AppRequest).actor;
  if (!actor) throw new DomainError("unauthorized", 401, "Sign in required");
  return actor;
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(@Inject(SQL) private readonly sql: Sql, @Inject(ENV) private readonly env: AppEnv) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AppRequest>();
    const header = request.headers.authorization;
    if (!header?.startsWith("Bearer ")) throw new DomainError("unauthorized", 401, "Sign in required");
    const identity = await verifyIdentity(header.slice("Bearer ".length), this.env);
    const user = await upsertUserFromIdentity(this.sql, identity);
    const roles = await this.sql<{ role: string }[]>`SELECT role FROM user_roles WHERE user_id = ${user.id}`;
    request.actor = { ...user, roles: roles.map((row) => row.role) };
    return true;
  }
}

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(@Inject(ENV) private readonly env: AppEnv) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AppRequest>();
    const actor = actorOf(request);
    if (!actor.roles.includes("admin")) throw new DomainError("forbidden", 403, "Admin role required");
    const session = request.headers["x-admin-session"];
    if (typeof session !== "string" || !this.env.ADMIN_SESSION_SECRET) {
      throw new DomainError("admin_session_required", 401, "Admin session required");
    }
    try {
      await jwtVerify(session, new TextEncoder().encode(this.env.ADMIN_SESSION_SECRET), {
        issuer: "solomad-admin",
        audience: "solomad-admin",
      });
    } catch {
      throw new DomainError("admin_session_required", 401, "Admin session was rejected");
    }
    return true;
  }
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const reply = host.switchToHttp().getResponse<FastifyReply>();
    if (isDomainError(exception)) {
      void reply.status(exception.status).send({ error: { code: exception.code, message: exception.message } });
      return;
    }
    if (exception instanceof ZodError) {
      void reply.status(400).send({ error: { code: "invalid_request", message: "Check the submitted fields", details: exception.issues.map((issue) => issue.path.join(".")) } });
      return;
    }
    if (exception instanceof HttpException) {
      void reply.status(exception.getStatus()).send({ error: { code: "http", message: exception.message } });
      return;
    }
    const message = exception instanceof Error ? exception.message : "unknown";
    console.error(JSON.stringify({ level: "error", msg: "unhandled", error: message.slice(0, 300) }));
    void reply.status(500).send({ error: { code: "internal", message: "Something went wrong" } });
  }
}

export function idempotencyKey(request: FastifyRequest): string | undefined {
  const value = request.headers["idempotency-key"];
  return typeof value === "string" && value.length > 0 ? value.slice(0, 200) : undefined;
}
