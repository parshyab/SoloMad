import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseDotenv, serializeDotenv } from "./dotenv.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const operatorFile = join(root, ".env.staging.operator.local");
const envFile = join(root, ".env");
const keys = [
  "REVENUECAT_WEBHOOK_SECRET",
  "REVENUECAT_PUBLIC_SDK_KEY",
  "REVENUECAT_API_KEY",
  "APNS_TEAM_ID",
  "APNS_KEY_ID",
  "APNS_PRIVATE_KEY",
  "APNS_ENVIRONMENT",
];

if (!existsSync(operatorFile)) {
  console.error("missing .env.staging.operator.local (copy from .env.staging.operator.example)");
  process.exit(1);
}
const operator = parseDotenv(readFileSync(operatorFile, "utf8"));
const env = existsSync(envFile) ? parseDotenv(readFileSync(envFile, "utf8")) : {};
const missing = keys.filter((key) => !operator[key]);
if (missing.length > 0) {
  console.error(`operator file missing: ${missing.join(", ")}`);
  process.exit(1);
}
for (const key of keys) env[key] = operator[key];
writeFileSync(envFile, serializeDotenv(env), { mode: 0o600 });
console.log(`merged ${keys.length} operator secrets into .env`);
