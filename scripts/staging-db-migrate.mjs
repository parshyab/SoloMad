// Run migrations against staging Aurora (IAM auth when DATABASE_IAM_AUTH=true). Does not print secrets.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseDotenv } from "./dotenv.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const envPath = join(root, ".env");

function loadEnvFile() {
  if (!existsSync(envPath)) throw new Error("missing .env");
  return parseDotenv(readFileSync(envPath, "utf8"));
}

const fileEnv = loadEnvFile();
const databaseUrl = process.env.DATABASE_URL ?? fileEnv.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is not set");

const env = {
  ...process.env,
  ...fileEnv,
  DATABASE_URL: databaseUrl,
  DATABASE_IAM_AUTH: process.env.DATABASE_IAM_AUTH ?? fileEnv.DATABASE_IAM_AUTH ?? "true",
  AWS_REGION: process.env.AWS_REGION ?? fileEnv.AWS_REGION ?? "us-east-1",
  AWS_PROFILE: process.env.AWS_PROFILE ?? fileEnv.AWS_PROFILE ?? "solomad-staging-terraform",
};

execFileSync("node", ["packages/db/dist/migrate.js"], {
  cwd: root,
  stdio: "inherit",
  env,
});
console.log("staging database migrations applied");
