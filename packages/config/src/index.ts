import { z } from "zod";

const schema = z.object({
  APP_ENV: z.enum(["development", "test", "staging", "production"]).default("development"),
  NODE_ENV: z.string().default("development"),
  LOG_LEVEL: z.string().default("info"),
  AUTH_MODE: z.enum(["supabase", "development", "test"]).default("development"),
  DEV_AUTH_SECRET: z.string().optional(),
  TEST_AUTH_SECRET: z.string().optional(),
  SUPABASE_URL: z.string().optional(),
  SUPABASE_PUBLISHABLE_KEY: z.string().optional(),
  SUPABASE_SECRET_KEY: z.string().optional(),
  SUPABASE_JWT_ISSUER: z.string().optional(),
  SUPABASE_JWT_AUDIENCE: z.string().default("authenticated"),
  SUPABASE_JWKS_URL: z.string().optional(),
  SUPABASE_SESSION_CHECK_TTL_SECONDS: z.coerce.number().int().min(0).max(300).default(30),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().optional(),
  API_HOST: z.string().default("0.0.0.0"),
  API_PORT: z.coerce.number().default(3000),
  REALTIME_PORT: z.coerce.number().default(3001),
  WORKER_PORT: z.coerce.number().default(3002),
  ADMIN_PORT: z.coerce.number().default(3010),
  WEB_PORT: z.coerce.number().default(3020),
  API_PUBLIC_ORIGIN: z.string().default("http://127.0.0.1:3000"),
  REALTIME_PUBLIC_ORIGIN: z.string().default("http://127.0.0.1:3001"),
  SHARE_HOST: z.string().default("localhost:3020"),
  WEB_ORIGIN: z.string().default("http://127.0.0.1:3020"),
  ADMIN_ORIGIN: z.string().default("http://127.0.0.1:3010"),
  CORS_ORIGINS: z.string().default("http://127.0.0.1:3010,http://127.0.0.1:3020"),
  MEDIA_PROVIDER: z.enum(["s3", "local"]).default("local"),
  MEDIA_LOCAL_DIR: z.string().default("var/media"),
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().default("us-east-1"),
  S3_ENDPOINT: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: z.enum(["true", "false"]).default("true"),
  CDN_PUBLIC_BASE_URL: z.string().optional(),
  QUEUE_PROVIDER: z.enum(["sqs", "database"]).default("database"),
  SQS_ENDPOINT: z.string().optional(),
  SQS_REGION: z.string().default("us-east-1"),
  SQS_QUEUE_URL: z.string().optional(),
  SQS_DLQ_URL: z.string().optional(),
  SQS_ACCESS_KEY_ID: z.string().optional(),
  SQS_SECRET_ACCESS_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default("claude-sonnet-4-5"),
  AI_DAILY_QUOTA_FREE: z.coerce.number().default(3),
  AI_DAILY_QUOTA_PLUS: z.coerce.number().default(30),
  AI_GLOBAL_DAILY_TOKEN_BUDGET: z.coerce.number().default(200_000),
  REVENUECAT_WEBHOOK_SECRET: z.string().optional(),
  REVENUECAT_API_KEY: z.string().optional(),
  REVENUECAT_PUBLIC_SDK_KEY: z.string().optional(),
  APNS_TEAM_ID: z.string().optional(),
  APNS_KEY_ID: z.string().optional(),
  APNS_BUNDLE_ID: z.string().default("app.solomad.ios"),
  APNS_PRIVATE_KEY: z.string().optional(),
  APNS_ENVIRONMENT: z.enum(["sandbox", "production"]).default("sandbox"),
  ADMIN_EMAIL: z.string().default("admin@solomad.invalid"),
  ADMIN_PASSWORD: z.string().optional(),
  ADMIN_SESSION_SECRET: z.string().optional(),
  CITY_ROOM_MEMBER_LIMIT: z.coerce.number().default(500),
  PARTNERS_URL: z.string().default("https://solomad.app/partners"),
  LEGAL_CONTACT_EMAIL: z.string().default("privacy@solomad.invalid"),
  LEGAL_STATUS: z.enum(["draft", "approved"]).default("draft"),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().optional(),
  SENTRY_DSN: z.string().optional(),
  SMTP_HOST: z.string().default("127.0.0.1"),
  SMTP_PORT: z.coerce.number().default(1025),
  EMAIL_FROM: z.string().default("noreply@solomad.invalid"),
});

export type AppEnv = z.infer<typeof schema>;

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

const LOCAL_AUTH_MARKERS = [/localhost/, /127\.0\.0\.1/, /host\.docker\.internal/, /:5[45]421\b/];

export function assertRuntimeSafe(env: AppEnv, processEnv: NodeJS.ProcessEnv = process.env): void {
  const locked = env.APP_ENV === "production" || env.APP_ENV === "staging";
  if (!locked) {
    if (env.AUTH_MODE === "test" && env.APP_ENV !== "test") {
      throw new ConfigError("AUTH_MODE=test is only valid when APP_ENV=test");
    }
    if (env.AUTH_MODE === "development" && !env.DEV_AUTH_SECRET) {
      throw new ConfigError("DEV_AUTH_SECRET is required for development auth");
    }
    if (env.AUTH_MODE === "test" && !env.TEST_AUTH_SECRET) {
      throw new ConfigError("TEST_AUTH_SECRET is required for test auth");
    }
    if (env.AUTH_MODE === "supabase" && (!env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY)) {
      throw new ConfigError("AUTH_MODE=supabase requires SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY");
    }
    return;
  }

  if (env.AUTH_MODE !== "supabase") {
    throw new ConfigError(`${env.APP_ENV} requires AUTH_MODE=supabase`);
  }
  if (processEnv.AUTH_BYPASS || processEnv.TEST_ENTITLEMENT_OVERRIDE) {
    throw new ConfigError(`${env.APP_ENV} rejects authentication bypasses and entitlement overrides`);
  }
  if (processEnv.FIREBASE_AUTH_EMULATOR_HOST) {
    throw new ConfigError(`${env.APP_ENV} rejects emulator endpoints`);
  }
  if (!env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY || !env.SUPABASE_SECRET_KEY) {
    throw new ConfigError(`${env.APP_ENV} requires SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, and SUPABASE_SECRET_KEY`);
  }
  for (const value of [env.SUPABASE_URL, env.SUPABASE_JWT_ISSUER ?? "", env.SUPABASE_JWKS_URL ?? ""]) {
    if (value && (!value.startsWith("https://") || LOCAL_AUTH_MARKERS.some((marker) => marker.test(value)))) {
      throw new ConfigError(`${env.APP_ENV} rejects a local or non-https Supabase Auth endpoint`);
    }
  }
  if (env.MEDIA_PROVIDER !== "s3") {
    throw new ConfigError(`${env.APP_ENV} requires MEDIA_PROVIDER=s3`);
  }
  if (env.QUEUE_PROVIDER !== "sqs") {
    throw new ConfigError(`${env.APP_ENV} requires QUEUE_PROVIDER=sqs`);
  }
  if (!env.API_PUBLIC_ORIGIN.startsWith("https://")) {
    throw new ConfigError(`${env.APP_ENV} requires an https API_PUBLIC_ORIGIN`);
  }
  if (!env.DATABASE_URL || /localhost|127\.0\.0\.1/.test(env.DATABASE_URL)) {
    throw new ConfigError(`${env.APP_ENV} rejects a local database URL`);
  }
  if (!env.REDIS_URL || /localhost|127\.0\.0\.1/.test(env.REDIS_URL)) {
    throw new ConfigError(`${env.APP_ENV} rejects a local Redis URL`);
  }
  if (!env.S3_BUCKET || env.S3_ENDPOINT?.includes("localhost") || env.S3_ENDPOINT?.includes("4566")) {
    throw new ConfigError(`${env.APP_ENV} rejects LocalStack or missing S3 configuration`);
  }
  if (!env.SQS_QUEUE_URL || !env.SQS_DLQ_URL || env.SQS_ENDPOINT?.includes("localhost")) {
    throw new ConfigError(`${env.APP_ENV} requires SQS queue and dead-letter queue URLs`);
  }
  if (!env.REVENUECAT_WEBHOOK_SECRET) {
    throw new ConfigError(`${env.APP_ENV} requires REVENUECAT_WEBHOOK_SECRET`);
  }
  if (!env.APNS_TEAM_ID || !env.APNS_KEY_ID || !env.APNS_PRIVATE_KEY) {
    throw new ConfigError(`${env.APP_ENV} requires APNs token authentication configuration`);
  }
  if (!env.ADMIN_SESSION_SECRET || !env.ADMIN_PASSWORD) {
    throw new ConfigError(`${env.APP_ENV} requires admin session configuration`);
  }
  if (env.APNS_ENVIRONMENT === "sandbox" && env.APP_ENV === "production") {
    throw new ConfigError("production rejects the APNs sandbox environment");
  }
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const issue = parsed.error.issues.map((item) => `${item.path.join(".")}: ${item.message}`).join("; ");
    throw new ConfigError(`Invalid environment: ${issue}`);
  }
  assertRuntimeSafe(parsed.data, source);
  return parsed.data;
}

export function corsOrigins(env: AppEnv): string[] {
  return env.CORS_ORIGINS.split(",").map((item) => item.trim()).filter(Boolean);
}
