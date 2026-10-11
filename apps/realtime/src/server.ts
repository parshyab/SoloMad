import type { Server as HttpServer } from "node:http";
import { createServer } from "node:http";
import { type AppEnv } from "@solomad/config";
import type { Sql } from "@solomad/db";
import { DomainError, sendMessage, type VerifiedIdentity } from "@solomad/domain";
import { createAdapter } from "@socket.io/redis-streams-adapter";
import { Redis } from "ioredis";
import { Server } from "socket.io";
import { verifyIdentity } from "./identity";

export type Gateway = { io: Server; httpServer: HttpServer; close: () => Promise<void> };

export async function createGateway(env: AppEnv, sql: Sql, verify: (token: string) => Promise<VerifiedIdentity>): Promise<Gateway> {
  const httpServer = createServer((req, res) => {
    if (req.url === "/health" && req.method === "GET") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end('{"ok":true}');
      return;
    }
    res.writeHead(404);
    res.end();
  });
  const redis = env.REDIS_URL
    ? new Redis(env.REDIS_URL, {
        maxRetriesPerRequest: 1,
        tls: env.REDIS_URL.startsWith("rediss://") ? {} : undefined,
      })
    : null;
  const io = new Server(httpServer, {
    transports: ["websocket"],
    cors: { origin: env.CORS_ORIGINS.split(",").map((item) => item.trim()) },
    adapter: redis ? createAdapter(redis) : undefined,
  });

  async function resolveUser(token: string): Promise<{ userId: string; expiresAt: number | undefined }> {
    const identity = await verify(token);
    const rows = await sql<{ user_id: string; status: string }[]>`
      SELECT i.user_id, u.status FROM identities i JOIN users u ON u.id = i.user_id
      WHERE i.provider = ${identity.provider} AND i.provider_subject = ${identity.subject}
    `;
    const user = rows[0];
    if (!user || user.status !== "active") throw new DomainError("unauthorized", 401, "Session is no longer valid");
    return { userId: user.user_id, expiresAt: identity.expiresAt };
  }

  io.use(async (socket, next) => {
    try {
      const token = typeof socket.handshake.auth.token === "string" ? socket.handshake.auth.token : "";
      const resolved = await resolveUser(token);
      socket.data.token = token;
      socket.data.userId = resolved.userId;
      socket.data.expiresAt = resolved.expiresAt;
      next();
    } catch {
      next(new Error("unauthorized"));
    }
  });

  io.on("connection", (socket) => {
    let expiryTimer: NodeJS.Timeout | undefined;
    function scheduleExpiry(expiresAt: number | undefined) {
      if (expiryTimer) clearTimeout(expiryTimer);
      if (!expiresAt) return;
      expiryTimer = setTimeout(() => {
        socket.emit("auth:expired", { code: "token_expired" });
        socket.disconnect(true);
      }, Math.max(0, Math.min(expiresAt - Date.now(), 2 ** 31 - 1)));
    }
    scheduleExpiry(socket.data.expiresAt as number | undefined);

    async function requireSession(): Promise<string> {
      const token = typeof socket.data.token === "string" ? socket.data.token : "";
      const { userId } = await resolveUser(token);
      if (userId !== socket.data.userId) throw new DomainError("unauthorized", 401, "Session is no longer valid");
      return userId;
    }

    socket.on("auth:refresh", async (payload: { token?: string }, ack?: (body: unknown) => void) => {
      try {
        const token = typeof payload?.token === "string" ? payload.token : "";
        const resolved = await resolveUser(token);
        if (resolved.userId !== socket.data.userId) throw new DomainError("unauthorized", 401, "A refreshed token must belong to the same user");
        socket.data.token = token;
        scheduleExpiry(resolved.expiresAt);
        ack?.({ ok: true });
      } catch (error) {
        ack?.({ error: { code: error instanceof DomainError ? error.code : "unauthorized" } });
        socket.disconnect(true);
      }
    });

    socket.on("room:join", async (conversationId: string, ack?: (body: unknown) => void) => {
      try {
        const userId = await requireSession();
        const allowed = await sql`
          SELECT 1 FROM conversation_members
          WHERE conversation_id = ${conversationId} AND user_id = ${userId} AND removed_at IS NULL
        `;
        if (!allowed[0]) {
          ack?.({ error: { code: "forbidden" } });
          return;
        }
        await socket.join(conversationId);
        ack?.({ ok: true });
      } catch (error) {
        ack?.({ error: { code: error instanceof DomainError ? error.code : "unauthorized" } });
        socket.disconnect(true);
      }
    });

    socket.on("message:send", async (payload: { conversationId?: string; clientMessageId?: string; body?: string; userId?: string }, ack?: (body: unknown) => void) => {
      try {
        const userId = await requireSession();
        if (!payload.conversationId || !payload.clientMessageId) throw new DomainError("invalid_message", 400, "Message is incomplete");
        const message = await sendMessage(sql, {
          userId,
          conversationId: payload.conversationId,
          clientMessageId: payload.clientMessageId,
          body: payload.body ?? "",
        });
        io.to(payload.conversationId).emit("message.created", {
          id: message.id,
          conversationId: payload.conversationId,
          senderId: userId,
          clientMessageId: payload.clientMessageId,
          body: payload.body ?? "",
          createdAt: message.createdAt,
        });
        ack?.({ ok: true, id: message.id, replayed: message.replayed });
      } catch (error) {
        const code = error instanceof DomainError ? error.code : "internal";
        ack?.({ error: { code } });
        if (["unauthorized", "invalid_token", "session_revoked", "account_banned"].includes(code)) socket.disconnect(true);
      }
    });

    socket.on("disconnect", () => {
      if (expiryTimer) clearTimeout(expiryTimer);
      socket.rooms.clear();
    });
  });

  return {
    io,
    httpServer,
    close: async () => {
      await new Promise<void>((resolve) => io.close(() => resolve()));
      httpServer.close();
      if (redis) await redis.quit();
    },
  };
}

export function localVerifier(env: AppEnv) {
  return (token: string) => verifyIdentity(token, env);
}
