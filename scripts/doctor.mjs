import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import net from "node:net";
import { readLocalSupabase, SUPABASE_CLI_VERSION, supabaseApiPort, supabaseBin } from "./supabase-env.mjs";

const isMac = process.platform === "darwin";
let failed = 0;

function check(name, ok, detail) {
  console.log(`${ok ? "ok" : "missing"}  ${name}${detail ? `: ${detail}` : ""}`);
  if (!ok) failed += 1;
}

function capture(command) {
  try {
    return execSync(command, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch (error) {
    const stdout = error && typeof error === "object" && "stdout" in error ? String(error.stdout ?? "") : "";
    const stderr = error && typeof error === "object" && "stderr" in error ? String(error.stderr ?? "") : "";
    return `${stdout}\n${stderr}`.trim();
  }
}

console.log(`platform ${process.platform}`);
check("node", Number(process.versions.node.split(".")[0]) >= 22, process.version);
const pnpm = capture("pnpm --version");
check("pnpm", Boolean(pnpm), pnpm || "not installed");
check("docker", Boolean(capture("docker --version")), capture("docker --version"));
const daemon = capture("docker info --format '{{.ServerVersion}}'");
check("docker daemon", Boolean(daemon), daemon || "Docker.app is installed but the daemon is not accepting connections");
if (isMac) {
  const xcode = capture("xcodebuild -version");
  const developerDir = capture("xcode-select -p");
  console.log(`${xcode ? "ok" : "blocked"}  xcodebuild: ${xcode.split("\n")[0] || "full Xcode is not selected"}`);
  console.log(`info  xcode-select: ${developerDir || "unset"}`);
  const simulators = capture("xcrun simctl list devices available");
  console.log(`${/iPhone|iOS/.test(simulators) ? "ok" : "blocked"}  simulator runtime: ${simulators ? "listed" : "simctl unavailable"}`);
  check("xcode project", existsSync("ios/NomadTable.xcodeproj/project.pbxproj"), "ios/NomadTable.xcodeproj is maintained directly; XcodeGen is not required");
  const identities = capture("security find-identity -v -p codesigning");
  const identityCount = identities.match(/(\d+) valid identities found/)?.[1] ?? "0";
  console.log(`${identityCount === "0" ? "blocked" : "ok"}  code-signing identities: ${identityCount} (device and distribution only; simulator Debug does not need one)`);
  if (!xcode) console.log("blocked  native compile, test, launch, and archive");
} else {
  console.log("skip  native iOS gates are macOS-only");
}

const cli = supabaseBin();
check("supabase CLI", cli?.version === SUPABASE_CLI_VERSION, cli ? `${cli.version} at ${cli.bin} (pinned ${SUPABASE_CLI_VERSION})` : `not found; pinned ${SUPABASE_CLI_VERSION}, set SUPABASE_BIN`);
const authPort = supabaseApiPort();
const authHealth = await fetch(`http://127.0.0.1:${authPort}/auth/v1/health`, { headers: { apikey: readLocalSupabase()?.SUPABASE_PUBLISHABLE_KEY ?? "" }, signal: AbortSignal.timeout(3000) })
  .then((response) => response.status)
  .catch(() => 0);
check("local Supabase Auth", authHealth === 200, authHealth ? `GET :${authPort}/auth/v1/health -> ${authHealth}` : "not running; make supabase-start");
check(".env.supabase.local", Boolean(readLocalSupabase()?.SUPABASE_PUBLISHABLE_KEY), "captured from supabase status (values hidden)");
const terraform = capture("tools/terraform/terraform version") || capture("terraform version");
const terraformOk = /Terraform v1\.(1[0-9]|[2-9]\d)\./.test(terraform);
console.log(`${terraformOk ? "ok" : "blocked"}  terraform: ${terraform.split("\n")[0] || "not installed"} (need >= 1.10 for S3 lockfile)`);

const ports = [5432, 6379, 4566, 3000, 3001, 8025, authPort];
for (const port of ports) {
  const open = await portOpen(port);
  console.log(`${open ? "open" : "free"}  port ${port}`);
}

const envPath = existsSync(".env") ? ".env" : existsSync(".env.example") ? ".env.example" : "";
check("environment file", Boolean(envPath), envPath || "create .env from .env.example");
if (envPath) {
  const keys = readFileSync(envPath, "utf8").split("\n").map((line) => line.split("=")[0]).filter((key) => key && !key.startsWith("#"));
  console.log(`info  environment keys present: ${keys.length} (values hidden)`);
  const required = ["DATABASE_URL", "AUTH_MODE", "APP_ENV"];
  for (const key of required) check(`env ${key}`, keys.includes(key));
}

function portOpen(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: "127.0.0.1" });
    socket.once("connect", () => {
      socket.end();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}

if (failed) {
  console.log(`doctor finished with ${failed} missing checks`);
  process.exitCode = isMac ? 1 : 0;
}
