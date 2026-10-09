import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { DomainError } from "./errors";

export type SupabaseAuthConfig = {
  url: string;
  publishableKey: string;
  secretKey?: string;
  issuer?: string;
  audience?: string;
  jwksUrl?: string;
  sessionCheckTtlMs?: number;
  fetch?: typeof fetch;
  keys?: JWTVerifyGetKey;
  now?: () => number;
};

export type SupabaseIdentity = {
  provider: "supabase";
  subject: string;
  sessionId: string;
  expiresAt: number;
  email: string | null;
  phone: string | null;
};

type SessionCheck = { until: number; ok: true } | { until: number; ok: false; code: "session_revoked" | "account_banned" };

const MAX_CACHED_SESSIONS = 10_000;

export function createSupabaseVerifier(config: SupabaseAuthConfig) {
  const base = config.url.replace(/\/+$/, "");
  const issuer = config.issuer ?? `${base}/auth/v1`;
  const audience = config.audience ?? "authenticated";
  const keys = config.keys ?? createRemoteJWKSet(new URL(config.jwksUrl ?? `${issuer}/.well-known/jwks.json`), {
    cacheMaxAge: 10 * 60_000,
    cooldownDuration: 30_000,
    timeoutDuration: 5_000,
  });
  const ttl = config.sessionCheckTtlMs ?? 30_000;
  const fetcher = config.fetch ?? fetch;
  const now = config.now ?? Date.now;
  const sessions = new Map<string, SessionCheck>();

  function rejection(code: "session_revoked" | "account_banned") {
    return code === "account_banned"
      ? new DomainError(code, 403, "This account is suspended")
      : new DomainError(code, 401, "Session is no longer active");
  }

  async function checkSession(token: string, subject: string, sessionId: string): Promise<void> {
    const cached = sessions.get(sessionId);
    if (cached && cached.until > now()) {
      if (!cached.ok) throw rejection(cached.code);
      return;
    }
    let result: SessionCheck;
    try {
      const response = await fetcher(`${base}/auth/v1/user`, {
        headers: { apikey: config.publishableKey, authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(5_000),
      });
      if (response.status === 401 || response.status === 403 || response.status === 404) {
        result = { until: now() + ttl, ok: false, code: "session_revoked" };
      } else if (!response.ok) {
        throw new Error(`auth status ${response.status}`);
      } else if (config.secretKey) {
        const admin = await fetcher(`${base}/auth/v1/admin/users/${encodeURIComponent(subject)}`, {
          headers: { apikey: config.secretKey, authorization: `Bearer ${config.secretKey}` },
          signal: AbortSignal.timeout(5_000),
        });
        if (admin.status === 404) {
          result = { until: now() + ttl, ok: false, code: "session_revoked" };
        } else if (!admin.ok) {
          throw new Error(`admin status ${admin.status}`);
        } else {
          const body = await admin.json() as { banned_until?: string | null };
          const banned = body.banned_until ? Date.parse(body.banned_until) > now() : false;
          result = banned ? { until: now() + ttl, ok: false, code: "account_banned" } : { until: now() + ttl, ok: true };
        }
      } else {
        result = { until: now() + ttl, ok: true };
      }
    } catch (error) {
      if (error instanceof DomainError) throw error;
      throw new DomainError("auth_unavailable", 503, "Supabase Auth could not confirm the session");
    }
    if (sessions.size >= MAX_CACHED_SESSIONS) {
      const oldest = sessions.keys().next().value;
      if (oldest) sessions.delete(oldest);
    }
    sessions.set(sessionId, result);
    if (!result.ok) throw rejection(result.code);
  }

  return async function verify(token: string): Promise<SupabaseIdentity> {
    if (!token || token.split(".").length !== 3) throw new DomainError("invalid_token", 401, "Token could not be verified");
    let payload;
    try {
      ({ payload } = await jwtVerify(token, keys, {
        issuer,
        audience,
        algorithms: ["ES256", "RS256"],
        currentDate: new Date(now()),
      }));
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
      if (code === "ERR_JWKS_TIMEOUT" || code === "ERR_JOSE_GENERIC") {
        throw new DomainError("auth_unavailable", 503, "Supabase signing keys could not be loaded");
      }
      throw new DomainError("invalid_token", 401, "Token could not be verified");
    }
    const subject = typeof payload.sub === "string" ? payload.sub : "";
    const sessionId = typeof payload.session_id === "string" ? payload.session_id : "";
    if (!subject || !sessionId || payload.role !== "authenticated" || payload.is_anonymous === true) {
      throw new DomainError("invalid_token", 401, "Token identity is incomplete");
    }
    await checkSession(token, subject, sessionId);
    return {
      provider: "supabase",
      subject,
      sessionId,
      expiresAt: (payload.exp ?? 0) * 1000,
      email: typeof payload.email === "string" && payload.email ? payload.email : null,
      phone: typeof payload.phone === "string" && payload.phone ? payload.phone : null,
    };
  };
}
