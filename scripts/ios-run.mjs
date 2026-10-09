import { execSync } from "node:child_process";

function available(command) {
  try {
    execSync(command, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

if (!available("xcodebuild -version")) {
  console.error("Native launch was not run. xcodebuild requires a full Xcode installation.");
  console.error(`Active developer directory: ${execSync("xcode-select -p", { encoding: "utf8" }).trim()}`);
  process.exit(1);
}

const udid = execSync("node scripts/simulator.mjs", { encoding: "utf8" }).trim();
try {
  execSync(`xcrun simctl boot ${udid}`, { stdio: "ignore" });
} catch {
  // Already booted simulators return a non-zero status.
}
execSync(`xcrun simctl bootstatus ${udid} -b`, { stdio: "inherit" });
execSync(`xcrun simctl location ${udid} set 38.7223,-9.1393`, { stdio: "inherit" });
execSync(
  `xcodebuild -project ios/NomadTable.xcodeproj -scheme NomadTable -destination 'platform=iOS Simulator,id=${udid}' -configuration Debug -sdk iphonesimulator CODE_SIGN_IDENTITY=- CODE_SIGNING_ALLOWED=YES CODE_SIGNING_REQUIRED=NO DEVELOPMENT_TEAM= build`,
  { stdio: "inherit" },
);
const settings = execSync(
  `xcodebuild -project ios/NomadTable.xcodeproj -scheme NomadTable -destination 'platform=iOS Simulator,id=${udid}' -configuration Debug -showBuildSettings`,
  { encoding: "utf8" },
);
const products = settings.match(/^\s*BUILT_PRODUCTS_DIR = (.+)$/m)?.[1];
if (!products) {
  console.error("The build finished, but BUILT_PRODUCTS_DIR was not found.");
  process.exit(1);
}
const app = `${products}/NomadTable.app`;
execSync(`xcrun simctl install ${udid} ${JSON.stringify(app)}`, { stdio: "inherit" });
// SOLOMAD_TEST_EMAIL/SOLOMAD_TEST_PASSWORD (Debug only) sign in to the local Supabase stack at launch.
const launchEnv = { ...process.env };
for (const name of ["SOLOMAD_TEST_EMAIL", "SOLOMAD_TEST_PASSWORD"]) {
  if (process.env[name]) launchEnv[`SIMCTL_CHILD_${name}`] = process.env[name];
}
const launched = execSync(`xcrun simctl launch --terminate-running-process ${udid} app.solomad.ios`, { encoding: "utf8", env: launchEnv });
console.log(`booted ${udid}`);
console.log(`installed ${app}`);
console.log(launched.trim());
