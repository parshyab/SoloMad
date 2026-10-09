import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { captureLocalSupabase, requireSupabaseBin } from "./supabase-env.mjs";
import { parseDotenv } from "./dotenv.mjs";

// Only Auth (GoTrue), its Postgres, and the Kong gateway are needed. Business data stays in the
// solomad PostGIS database from docker compose; PostgREST is excluded so no business table is exposed.
const excluded = ["realtime", "storage-api", "imgproxy", "postgrest", "postgres-meta", "studio", "edge-runtime", "logflare", "vector", "supavisor", "mailpit"];

const command = process.argv[2];
let bin;
try {
  bin = requireSupabaseBin();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

function localEnvironment() {
  if (!existsSync(".env")) return process.env;
  // config.toml's env(...) expressions are read by the CLI process. Shell and
  // CI values take precedence over the local dotenv file.
  return { ...parseDotenv(readFileSync(".env", "utf8")), ...process.env };
}

function run(args) {
  const result = spawnSync(bin, [...args, "--workdir", "."], { stdio: "inherit", env: localEnvironment() });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (command === "start") {
  run(["start", "-x", excluded.join(",")]);
  const values = captureLocalSupabase();
  console.log(`wrote .env.supabase.local (${Object.keys(values).join(", ")}; values hidden)`);
} else if (command === "stop") {
  // Keeps the Docker volume so local auth users survive restarts.
  run(["stop"]);
} else {
  console.error("usage: node scripts/supabase.mjs start|stop");
  process.exit(2);
}
