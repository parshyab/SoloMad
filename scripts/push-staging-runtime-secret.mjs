// Upload merged staging runtime env to Secrets Manager (JSON blob for ECS entrypoint).
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { derivedAuth, readStagingFile } from "./staging-env.mjs";
import { parseDotenv } from "./dotenv.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const envFile = join(root, ".env");
const terraformDir = join(root, "infra/terraform/environments/staging");
const terraformBin = join(root, "tools/terraform/terraform");

function terraformOutput(name) {
  const parsed = JSON.parse(execFileSync(terraformBin, ["output", "-json", name], { cwd: terraformDir, encoding: "utf8" }));
  return parsed?.value ?? parsed;
}

const staging = readStagingFile();
if (!staging) throw new Error("missing .env.supabase.staging.local");
const fileEnv = existsSync(envFile) ? parseDotenv(readFileSync(envFile, "utf8")) : {};
const auth = derivedAuth(staging);
const runtime = {
  ...fileEnv,
  ...auth,
  APP_ENV: "staging",
  AUTH_MODE: "supabase",
  NODE_ENV: "production",
  API_HOST: "0.0.0.0",
  API_PORT: "3000",
  REALTIME_PORT: "3001",
  DATABASE_IAM_AUTH: "true",
  AWS_REGION: process.env.AWS_REGION ?? "us-east-1",
};

const secretArn = terraformOutput("runtime_secret_arn");
if (!secretArn) throw new Error("runtime_secret_arn is empty; run terraform apply with enable_public_edge");

const aws = process.env.AWS_CLI ?? "aws";
execFileSync(
  aws,
  ["secretsmanager", "put-secret-value", "--secret-id", secretArn, "--secret-string", JSON.stringify(runtime), "--no-cli-pager"],
  { stdio: "inherit", env: process.env },
);
console.log("staging runtime secret updated in Secrets Manager");
