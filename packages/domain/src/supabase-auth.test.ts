import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWK } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { verifyIdentity } from "./identity";
import { createSupabaseVerifier } from "./supabase-auth";

const url = "https://fixture-project.supabase.co";
const issuer = `${url}/auth/v1`;
let privateKey: CryptoKey;
let otherKey: CryptoKey;
let jwks: ReturnType<typeof createLocalJWKSet>;

beforeAll(async () => {
  const pair = await generateKeyPair("ES256", { extractable: true });
  const other = await generateKeyPair("ES256", { extractable: true });
  privateKey = pair.privateKey;
  otherKey = other.privateKey;
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: "fixture", alg: "ES256" } as JWK;
  jwks = createLocalJWKSet({ keys: [jwk] });
});

function token(claims: Record<string, unknown> = {}, options: { key?: CryptoKey; iss?: string; aud?: string; exp?: number } = {}) {
  return new SignJWT({ role: "authenticated", session_id: "session-1", email: "fixture@solomad.test", ...claims })
    .setProtectedHeader({ alg: "ES256", kid: "fixture" })
    .setSubject("11111111-2222-4333-8444-555555555555")
    .setIssuer(options.iss ?? issuer)
    .setAudience(options.aud ?? "authenticated")
    .setIssuedAt()
    .setExpirationTime(options.exp ?? Math.floor(Date.now() / 1000) + 600)
    .sign(options.key ?? privateKey);
}

function statusFetch(user: number, banned?: string) {
  const calls: string[] = [];
  const fake = (async (input: string | URL | Request) => {
    const target = String(input);
    calls.push(target);
    if (target.endsWith("/auth/v1/user")) return new Response("{}", { status: user });
    return new Response(JSON.stringify({ banned_until: banned ?? null }), { status: 200 });
  }) as typeof fetch;
  return { fake, calls };
}

describe("supabase verifier", () => {
  it("accepts a signed token for an active session and derives identity from sub", async () => {
    const { fake } = statusFetch(200);
    const verify = createSupabaseVerifier({ url, publishableKey: "pk", keys: jwks, fetch: fake });
    const identity = await verify(await token({ userId: "someone-else" }));
    expect(identity).toMatchObject({ provider: "supabase", subject: "11111111-2222-4333-8444-555555555555", sessionId: "session-1" });
  });

  it("rejects missing, malformed, expired, wrong-issuer, wrong-audience, and wrong-key tokens", async () => {
    const { fake, calls } = statusFetch(200);
    const verify = createSupabaseVerifier({ url, publishableKey: "pk", keys: jwks, fetch: fake });
    await expect(verify("")).rejects.toMatchObject({ code: "invalid_token" });
    await expect(verify("not.a.jwt")).rejects.toMatchObject({ code: "invalid_token" });
    await expect(verify(await token({}, { exp: Math.floor(Date.now() / 1000) - 60 }))).rejects.toMatchObject({ code: "invalid_token" });
    await expect(verify(await token({}, { iss: "https://other-project.supabase.co/auth/v1" }))).rejects.toMatchObject({ code: "invalid_token" });
    await expect(verify(await token({}, { aud: "anon" }))).rejects.toMatchObject({ code: "invalid_token" });
    await expect(verify(await token({}, { key: otherKey }))).rejects.toMatchObject({ code: "invalid_token" });
    await expect(verify(await token({ role: "anon" }))).rejects.toMatchObject({ code: "invalid_token" });
    await expect(verify(await token({ session_id: undefined }))).rejects.toMatchObject({ code: "invalid_token" });
    expect(calls).toHaveLength(0);
  });

  it("rejects a validly signed token whose session was terminated, and caches the result", async () => {
    const { fake, calls } = statusFetch(403);
    const verify = createSupabaseVerifier({ url, publishableKey: "pk", keys: jwks, fetch: fake });
    const value = await token();
    await expect(verify(value)).rejects.toMatchObject({ code: "session_revoked" });
    await expect(verify(value)).rejects.toMatchObject({ code: "session_revoked" });
    expect(calls).toHaveLength(1);
  });

  it("rechecks after the propagation window", async () => {
    let clock = Date.now();
    let status = 200;
    const fake = (async () => new Response("{}", { status })) as typeof fetch;
    const verify = createSupabaseVerifier({ url, publishableKey: "pk", keys: jwks, fetch: fake, sessionCheckTtlMs: 1000, now: () => clock });
    const value = await token();
    await expect(verify(value)).resolves.toBeTruthy();
    status = 403;
    await expect(verify(value)).resolves.toBeTruthy();
    clock += 1500;
    await expect(verify(value)).rejects.toMatchObject({ code: "session_revoked" });
  });

  it("rejects banned users when the server-only admin check is configured", async () => {
    const { fake } = statusFetch(200, new Date(Date.now() + 86_400_000).toISOString());
    const verify = createSupabaseVerifier({ url, publishableKey: "pk", secretKey: "sk", keys: jwks, fetch: fake });
    await expect(verify(await token())).rejects.toMatchObject({ code: "account_banned" });
  });

  it("fails closed when Supabase Auth cannot be reached", async () => {
    const fake = (async () => { throw new Error("offline"); }) as typeof fetch;
    const verify = createSupabaseVerifier({ url, publishableKey: "pk", keys: jwks, fetch: fake });
    await expect(verify(await token())).rejects.toMatchObject({ code: "auth_unavailable" });
  });
});

describe("verifyIdentity", () => {
  it("returns auth_unconfigured for supabase mode without configuration", async () => {
    await expect(verifyIdentity("x.y.z", { APP_ENV: "production", AUTH_MODE: "supabase" })).rejects.toMatchObject({ code: "auth_unconfigured" });
    await expect(
      verifyIdentity("x.y.z", { APP_ENV: "production", AUTH_MODE: "supabase", SUPABASE_URL: url, SUPABASE_PUBLISHABLE_KEY: "pk" }),
    ).rejects.toMatchObject({ code: "auth_unconfigured" });
  });

  it("rejects development and test tokens outside their environments", async () => {
    await expect(verifyIdentity("x", { APP_ENV: "production", AUTH_MODE: "development", DEV_AUTH_SECRET: "s" })).rejects.toMatchObject({ code: "auth_unconfigured" });
    await expect(verifyIdentity("x", { APP_ENV: "staging", AUTH_MODE: "test", TEST_AUTH_SECRET: "s" })).rejects.toMatchObject({ code: "auth_unconfigured" });
    await expect(verifyIdentity("x", { APP_ENV: "production", AUTH_MODE: "firebase" })).rejects.toMatchObject({ code: "auth_unconfigured" });
  });
});
