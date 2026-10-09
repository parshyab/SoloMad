import { verifyLocalToken, type VerifiedIdentity } from "./auth";
import { DomainError } from "./errors";
import { createSupabaseVerifier } from "./supabase-auth";

export type IdentityEnv = {
  APP_ENV: string;
  AUTH_MODE: string;
  DEV_AUTH_SECRET?: string | undefined;
  TEST_AUTH_SECRET?: string | undefined;
  SUPABASE_URL?: string | undefined;
  SUPABASE_PUBLISHABLE_KEY?: string | undefined;
  SUPABASE_SECRET_KEY?: string | undefined;
  SUPABASE_JWT_ISSUER?: string | undefined;
  SUPABASE_JWT_AUDIENCE?: string | undefined;
  SUPABASE_JWKS_URL?: string | undefined;
  SUPABASE_SESSION_CHECK_TTL_SECONDS?: number | undefined;
};

const verifiers = new Map<string, ReturnType<typeof createSupabaseVerifier>>();

// The API and the realtime gateway both call this function; keep a single implementation.
export async function verifyIdentity(token: string, env: IdentityEnv): Promise<VerifiedIdentity> {
  if (env.AUTH_MODE === "test") {
    if (env.APP_ENV !== "test") throw new DomainError("auth_unconfigured", 503, "Test auth is only valid when APP_ENV=test");
    return verifyLocalToken(token, required(env.TEST_AUTH_SECRET, "TEST_AUTH_SECRET"), "solomad-test");
  }
  if (env.AUTH_MODE === "development") {
    if (env.APP_ENV !== "development" && env.APP_ENV !== "test") {
      throw new DomainError("auth_unconfigured", 503, "Development auth is rejected outside development");
    }
    return verifyLocalToken(token, required(env.DEV_AUTH_SECRET, "DEV_AUTH_SECRET"), "solomad-dev");
  }
  if (env.AUTH_MODE !== "supabase") throw new DomainError("auth_unconfigured", 503, "AUTH_MODE is not supported");
  const identity = await supabaseVerifier(env)(token);
  return { provider: identity.provider, subject: identity.subject, email: identity.email, phone: identity.phone, sessionId: identity.sessionId, expiresAt: identity.expiresAt };
}

function supabaseVerifier(env: IdentityEnv) {
  const url = required(env.SUPABASE_URL, "SUPABASE_URL");
  const publishableKey = required(env.SUPABASE_PUBLISHABLE_KEY, "SUPABASE_PUBLISHABLE_KEY");
  if ((env.APP_ENV === "staging" || env.APP_ENV === "production") && !env.SUPABASE_SECRET_KEY) {
    throw new DomainError("auth_unconfigured", 503, "SUPABASE_SECRET_KEY is not configured");
  }
  const key = [url, env.SUPABASE_JWT_ISSUER, env.SUPABASE_JWT_AUDIENCE, env.SUPABASE_JWKS_URL, Boolean(env.SUPABASE_SECRET_KEY)].join("|");
  let verifier = verifiers.get(key);
  if (!verifier) {
    verifier = createSupabaseVerifier({
      url,
      publishableKey,
      secretKey: env.SUPABASE_SECRET_KEY,
      issuer: env.SUPABASE_JWT_ISSUER,
      audience: env.SUPABASE_JWT_AUDIENCE,
      jwksUrl: env.SUPABASE_JWKS_URL,
      sessionCheckTtlMs: (env.SUPABASE_SESSION_CHECK_TTL_SECONDS ?? 30) * 1000,
    });
    verifiers.set(key, verifier);
  }
  return verifier;
}

function required(value: string | undefined, name: string): string {
  if (!value) throw new DomainError("auth_unconfigured", 503, `${name} is not configured`);
  return value;
}
