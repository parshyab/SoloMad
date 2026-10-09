import { execFileSync, spawnSync } from "node:child_process";
import { writeStagingClientConfig, readStagingFile, validateStagingAuth } from "./staging-env.mjs";

const values = readStagingFile();
const errors = validateStagingAuth(values ?? {});
if (!values || errors.some((error) => error.includes("SUPABASE_URL") || error.includes("SUPABASE_PUBLISHABLE_KEY") || error.includes("server secret"))) {
  console.error(`staging launch not started: ${errors.join("; ") || "missing .env.supabase.staging.local"}`);
  process.exit(1);
}
writeStagingClientConfig(values);
const udid = execFileSync("node", ["scripts/simulator.mjs"], { encoding: "utf8" }).trim();
const derived = "/tmp/solomad-dd-staging";
const build = spawnSync(
  "xcodebuild",
  [
    "-project", "ios/NomadTable.xcodeproj",
    "-scheme", "NomadTable-Staging",
    "-destination", `platform=iOS Simulator,id=${udid}`,
    "-configuration", "Staging",
    "-sdk", "iphonesimulator",
    "CODE_SIGN_IDENTITY=-",
    "CODE_SIGNING_ALLOWED=YES",
    "CODE_SIGNING_REQUIRED=NO",
    "DEVELOPMENT_TEAM=",
    "-derivedDataPath", derived,
    "build",
  ],
  { stdio: "inherit" },
);
if (build.status !== 0) process.exit(build.status ?? 1);
spawnSync("xcrun", ["simctl", "boot", udid], { stdio: "ignore" });
execFileSync("xcrun", ["simctl", "bootstatus", udid, "-b"], { stdio: "inherit" });
const app = `${derived}/Build/Products/Staging-iphonesimulator/NomadTable.app`;
execFileSync("xcrun", ["simctl", "install", udid, app], { stdio: "inherit" });
const launchEnv = { ...process.env };
if (process.argv.includes("--sign-in")) {
  launchEnv.SIMCTL_CHILD_SOLOMAD_STAGING_EMAIL = values.SUPABASE_SMOKE_EMAIL;
  launchEnv.SIMCTL_CHILD_SOLOMAD_STAGING_PASSWORD = values.SUPABASE_SMOKE_PASSWORD;
}
const launched = execFileSync("xcrun", ["simctl", "launch", "--terminate-running-process", udid, "app.solomad.ios"], { encoding: "utf8", env: launchEnv });
console.log(`booted ${udid}`);
console.log(`installed staging build`);
console.log(launched.trim());
