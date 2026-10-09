import { spawnSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { derivedAuth, readStagingFile, validateStagingAuth, writeStagingClientConfig } from "./staging-env.mjs";

const values = readStagingFile();
const errors = validateStagingAuth(values ?? {});
if (!values || errors.length > 0) {
  console.error(`staging auth test not started: ${errors.join("; ") || "missing .env.supabase.staging.local"}`);
  process.exit(1);
}
writeStagingClientConfig(values);
const auth = derivedAuth(values);
const expectedHost = new URL(auth.SUPABASE_URL).hostname;
const udid = spawnSync("node", ["scripts/simulator.mjs"], { encoding: "utf8" }).stdout.trim();
const derived = "/tmp/solomad-dd-staging";
const result = spawnSync(
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
    "-only-testing:NomadTableTests/NomadTableTests/testKeychainSessionsStayWithTheirSupabaseProject",
    "-only-testing:NomadTableTests/NomadTableTests/testHostedStagingSignInRestoresFromKeychain",
    "test",
  ],
  {
    env: {
      ...process.env,
      TEST_RUNNER_SOLOMAD_STAGING_EMAIL: auth.SUPABASE_SMOKE_EMAIL,
      TEST_RUNNER_SOLOMAD_STAGING_PASSWORD: auth.SUPABASE_SMOKE_PASSWORD,
    },
    encoding: "utf8",
  },
);
process.stdout.write(result.stdout ?? "");
process.stderr.write(result.stderr ?? "");
if ((result.stdout ?? "").includes("Executed 0 tests")) {
  console.error("FAILED  staging tests did not run");
  process.exit(1);
}

const app = join(derived, "Build/Products/Staging-iphonesimulator/NomadTable.app");
const plist = join(app, "Info.plist");
if (statSync(plist, { throwIfNoEntry: false })) {
  const url = spawnSync("plutil", ["-extract", "SupabaseURL", "raw", "-o", "-", plist], { encoding: "utf8" }).stdout.trim();
  const key = spawnSync("plutil", ["-extract", "SupabasePublishableKey", "raw", "-o", "-", plist], { encoding: "utf8" }).stdout.trim();
  const api = spawnSync("plutil", ["-extract", "APIBaseURL", "raw", "-o", "-", plist], { encoding: "utf8" }).stdout.trim();
  const host = (() => { try { return new URL(url).hostname; } catch { return ""; } })();
  if (host !== expectedHost) {
    console.error(`FAILED  staging bundle Supabase host does not match the hosted project (got ${host || "empty"})`);
    process.exit(1);
  }
  if (!key.startsWith("sb_publishable_") || key.startsWith("sb_secret_")) {
    console.error("FAILED  staging bundle publishable key is missing or is a server secret");
    process.exit(1);
  }
  if (url.includes("127.0.0.1") || api.includes("127.0.0.1")) {
    console.error("FAILED  staging bundle fell back to localhost");
    process.exit(1);
  }
  const mainBinary = join(app, "NomadTable");
  const infoText = readFileSync(plist);
  if (infoText.includes("sb_secret_") || infoText.includes(auth.SUPABASE_SECRET_KEY) || infoText.includes(auth.SUPABASE_SMOKE_PASSWORD)) {
    console.error("FAILED  staging Info.plist contains a server secret or smoke password");
    process.exit(1);
  }
  const binary = readFileSync(mainBinary);
  if (binary.includes(auth.SUPABASE_SECRET_KEY) || binary.includes(auth.SUPABASE_SMOKE_PASSWORD)) {
    console.error("FAILED  staging app binary contains a server secret or smoke password");
    process.exit(1);
  }
  console.log(`PASSED  staging bundle uses hosted project ${host} and does not contain the server secret`);
  if (!auth.API_PUBLIC_ORIGIN) console.log("staging API address is still the unconfigured placeholder");
}

if ((result.status ?? 1) !== 0) process.exit(result.status ?? 1);
process.exit(0);
