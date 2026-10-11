// Writes staging infrastructure values into gitignored env files. Never prints secrets.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseDotenv, serializeDotenv } from "./dotenv.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const stagingSupabase = join(root, ".env.supabase.staging.local");
const envFile = join(root, ".env");
const terraformDir = join(root, "infra/terraform/environments/staging");
const terraformBin = join(root, "tools/terraform/terraform");

const domain = process.env.STAGING_DOMAIN ?? "staging.solomad.app";
const apiOrigin = process.env.STAGING_API_ORIGIN ?? `https://api.${domain}`;
const realtimeOrigin = process.env.STAGING_REALTIME_ORIGIN ?? `https://realtime.${domain}`;
const expressClusterId = process.env.STAGING_AURORA_EXPRESS_CLUSTER_ID ?? "solomad-staging-express";

function terraformOutput() {
  if (!existsSync(terraformBin)) {
    throw new Error("tools/terraform/terraform is missing; run make terraform-check first");
  }
  const json = execFileSync(terraformBin, ["output", "-json"], {
    cwd: terraformDir,
    env: { ...process.env, AWS_REGION: process.env.AWS_REGION ?? "us-east-1" },
    encoding: "utf8",
  });
  const parsed = JSON.parse(json);
  for (const [key, value] of Object.entries(parsed)) {
    parsed[key] = value?.value ?? value;
  }
  return parsed;
}

function awsJson(args) {
  const aws = process.env.AWS_CLI ?? "aws";
  const out = execFileSync(aws, [...args, "--no-cli-pager", "--output", "json"], {
    encoding: "utf8",
    env: process.env,
  });
  return JSON.parse(out);
}

function mergeEnvFile(path, updates) {
  const current = existsSync(path) ? parseDotenv(readFileSync(path, "utf8")) : {};
  const next = { ...current, ...updates };
  writeFileSync(path, serializeDotenv(next), { mode: 0o600 });
}

const outputs = terraformOutput();
const albDns = outputs.alb_dns_name?.value;
const mediaBucket = outputs.media_bucket?.value;
const queueUrl = outputs.queue_url?.value;
const redisHost = outputs.redis_primary_endpoint?.value;

const cluster = awsJson([
  "rds",
  "describe-db-clusters",
  "--db-cluster-identifier",
  expressClusterId,
  "--region",
  process.env.AWS_REGION ?? "us-east-1",
]).DBClusters[0];
const dbHost = cluster.Endpoint;
const dbUser = cluster.MasterUsername ?? "postgres";
const dbName = cluster.DatabaseName ?? "postgres";
const databaseUrl = `postgres://${dbUser}@${dbHost}:5432/${dbName}?sslmode=require`;

if (!existsSync(stagingSupabase)) {
  throw new Error("missing .env.supabase.staging.local");
}
mergeEnvFile(stagingSupabase, {
  API_PUBLIC_ORIGIN: apiOrigin,
  REALTIME_PUBLIC_ORIGIN: realtimeOrigin,
});

const dlqUrl = queueUrl?.replace(/\/[^/]+$/, "/solomad-staging-dlq");
mergeEnvFile(envFile, {
  APP_ENV: "staging",
  AUTH_MODE: "supabase",
  DATABASE_URL: databaseUrl,
  DATABASE_IAM_AUTH: "true",
  REDIS_URL: redisHost ? `rediss://${redisHost}:6379` : undefined,
  MEDIA_PROVIDER: "s3",
  S3_BUCKET: mediaBucket,
  S3_REGION: "us-east-1",
  QUEUE_PROVIDER: "sqs",
  SQS_REGION: "us-east-1",
  SQS_QUEUE_URL: queueUrl,
  SQS_DLQ_URL: dlqUrl,
  STAGING_ALB_DNS_NAME: albDns ? `http://${albDns}` : "",
});

console.log("updated .env.supabase.staging.local: API_PUBLIC_ORIGIN, REALTIME_PUBLIC_ORIGIN");
console.log("updated .env: DATABASE_URL, REDIS_URL, S3_BUCKET, SQS_QUEUE_URL, SQS_DLQ_URL");
if (albDns) console.log(`staging ALB (no TLS yet): http://${albDns}`);
