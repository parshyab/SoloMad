import { describe, expect, it } from "vitest";
import { ConfigError, loadEnv } from "./index";

// Fixture values for schema tests only. They are not real project identifiers or keys.
const productionBase = {
  APP_ENV: "production",
  AUTH_MODE: "supabase",
  DATABASE_URL: "postgres://user:pw@aurora.internal:5432/solomad",
  REDIS_URL: "rediss://cache.internal:6379",
  API_PUBLIC_ORIGIN: "https://api.fixture.invalid",
  MEDIA_PROVIDER: "s3",
  QUEUE_PROVIDER: "sqs",
  SUPABASE_URL: "https://fixture-project.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_fixture",
  SUPABASE_SECRET_KEY: "sb_secret_fixture",
  S3_BUCKET: "solomad-media-fixture",
  S3_ENDPOINT: "",
  SQS_QUEUE_URL: "https://sqs.us-east-1.amazonaws.com/123/solomad",
  SQS_DLQ_URL: "https://sqs.us-east-1.amazonaws.com/123/solomad-dlq",
  SQS_ENDPOINT: "",
  REVENUECAT_WEBHOOK_SECRET: "whsec",
  APNS_TEAM_ID: "TEAM",
  APNS_KEY_ID: "KEY",
  APNS_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----\\n",
  APNS_ENVIRONMENT: "production",
  ADMIN_PASSWORD: "not-a-real-password",
  ADMIN_SESSION_SECRET: "session-secret",
};

const local = { DATABASE_URL: "postgres://solomad:solomad@127.0.0.1:5432/solomad" };

describe("runtime safety", () => {
  it("accepts a complete hosted Supabase configuration", () => {
    expect(loadEnv(productionBase).AUTH_MODE).toBe("supabase");
  });

  it("rejects development auth, local Supabase, and fixture providers in production", () => {
    expect(() => loadEnv({ ...productionBase, AUTH_MODE: "development", DEV_AUTH_SECRET: "x" })).toThrow(/AUTH_MODE=supabase/);
    expect(() => loadEnv({ ...productionBase, AUTH_MODE: "firebase" })).toThrow(ConfigError);
    expect(() => loadEnv({ ...productionBase, SUPABASE_URL: "http://127.0.0.1:55421" })).toThrow(/local or non-https/);
    expect(() => loadEnv({ ...productionBase, SUPABASE_URL: "https://host.docker.internal:55421" })).toThrow(/local or non-https/);
    expect(() => loadEnv({ ...productionBase, SUPABASE_SECRET_KEY: "" })).toThrow(/SUPABASE_SECRET_KEY/);
    expect(() => loadEnv({ ...productionBase, FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099" })).toThrow(/emulator/);
    expect(() => loadEnv({ ...productionBase, MEDIA_PROVIDER: "local" })).toThrow(/MEDIA_PROVIDER/);
    expect(() => loadEnv({ ...productionBase, QUEUE_PROVIDER: "database" })).toThrow(/QUEUE_PROVIDER/);
    expect(() => loadEnv({ ...productionBase, API_PUBLIC_ORIGIN: "http://api.fixture.invalid" })).toThrow(/https/);
    expect(() => loadEnv({ ...productionBase, TEST_ENTITLEMENT_OVERRIDE: "plus" })).toThrow(/entitlement/);
    expect(() => loadEnv({ ...productionBase, APP_ENV: "staging", AUTH_MODE: "test", TEST_AUTH_SECRET: "x" })).toThrow(/AUTH_MODE=supabase/);
  });

  it("requires Supabase client configuration for local supabase mode", () => {
    expect(() => loadEnv({ ...local, APP_ENV: "development", AUTH_MODE: "supabase" })).toThrow(/SUPABASE_URL/);
    const env = loadEnv({
      ...local,
      APP_ENV: "development",
      AUTH_MODE: "supabase",
      SUPABASE_URL: "http://127.0.0.1:55421",
      SUPABASE_PUBLISHABLE_KEY: "sb_publishable_local",
    });
    expect(env.SUPABASE_JWT_AUDIENCE).toBe("authenticated");
  });

  it("allows labelled development auth only outside locked environments", () => {
    expect(loadEnv({ ...local, APP_ENV: "development", AUTH_MODE: "development", DEV_AUTH_SECRET: "local-secret" }).AUTH_MODE).toBe("development");
    expect(() => loadEnv({ ...local, APP_ENV: "development", AUTH_MODE: "test", TEST_AUTH_SECRET: "x" })).toThrow(/APP_ENV=test/);
  });
});
