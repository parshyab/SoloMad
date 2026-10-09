import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { readLocalSupabase } from "./supabase-env.mjs";

function parse(file) {
  return Object.fromEntries(
    readFileSync(file, "utf8")
      .split("\n")
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
  );
}

export function devEnv() {
  const local = readLocalSupabase();
  if (!local?.SUPABASE_URL || !local.SUPABASE_PUBLISHABLE_KEY) {
    throw new Error(".env.supabase.local is missing. Run make supabase-start first.");
  }
  const auth = { ...local };
  delete auth.SOLOMAD_LOCAL_PASSWORD;
  return { ...process.env, ...parse(".env"), ...auth, APP_ENV: "development", AUTH_MODE: "supabase" };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const env = devEnv();
  const children = [
    spawn("node", ["apps/api/dist/main.js"], { env, stdio: "inherit" }),
    spawn("node", ["apps/realtime/dist/main.js"], { env, stdio: "inherit" }),
  ];
  console.log(`api :${env.API_PORT} and realtime :${env.REALTIME_PORT} running with AUTH_MODE=supabase (${env.SUPABASE_URL})`);
  const stop = () => children.forEach((child) => child.kill("SIGTERM"));
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  for (const child of children) {
    child.on("exit", (code) => {
      stop();
      process.exitCode = code ?? 1;
    });
  }
}
