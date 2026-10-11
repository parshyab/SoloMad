import { spawn } from "node:child_process";
import { join } from "node:path";

const entry = process.argv[2];
const appRoot = "/app";
if (!entry) {
  console.error("missing app entrypoint");
  process.exit(2);
}

if (process.env.RUNTIME_SECRET_JSON) {
  try {
    const payload = JSON.parse(process.env.RUNTIME_SECRET_JSON);
    for (const [key, value] of Object.entries(payload)) {
      if (value === undefined || value === null) continue;
      process.env[key] = String(value);
    }
  } catch (error) {
    console.error("invalid RUNTIME_SECRET_JSON");
    process.exit(1);
  }
}

const child = spawn(process.execPath, [join(appRoot, entry)], {
  stdio: "inherit",
  env: process.env,
});
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
