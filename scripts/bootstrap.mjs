import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

if (!existsSync(".env")) {
  const secret = randomBytes(24).toString("hex");
  const example = existsSync(".env.example") ? "" : "";
  writeFileSync(".env", `APP_ENV=development
AUTH_MODE=development
DEV_AUTH_SECRET=${secret}
DATABASE_URL=postgres://solomad:solomad@127.0.0.1:5432/solomad
REDIS_URL=redis://127.0.0.1:6379
ADMIN_EMAIL=admin@solomad.invalid
ADMIN_PASSWORD=${randomBytes(18).toString("hex")}
ADMIN_SESSION_SECRET=${randomBytes(24).toString("hex")}
MEDIA_PROVIDER=local
QUEUE_PROVIDER=database
API_PUBLIC_ORIGIN=http://127.0.0.1:3000
${example}`);
  console.log("wrote .env with local-only secrets (values not printed)");
}

execSync("docker compose -f infra/local/docker-compose.yml up -d", { stdio: "inherit" });
execSync("node scripts/wait-ready.mjs", { stdio: "inherit" });
execSync("pnpm --filter @solomad/db build && pnpm db:migrate && pnpm db:seed", { stdio: "inherit", env: { ...process.env, ...loadEnv(".env") } });
console.log("bootstrap complete");
console.log("api http://127.0.0.1:3000");
console.log("realtime http://127.0.0.1:3001");
console.log("mailpit http://127.0.0.1:8025");
console.log("A physical iPhone must use this computer's LAN address, not 127.0.0.1.");

function loadEnv(file) {
  const env = {};
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const index = line.indexOf("=");
    env[line.slice(0, index)] = line.slice(index + 1);
  }
  return env;
}
