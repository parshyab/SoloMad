import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const missing = [];

function gap(name, purpose) {
  missing.push({ name, purpose });
}

function values(path) {
  if (!existsSync(path)) return new Map();
  const map = new Map();
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line || line.trim().startsWith("#") || !line.includes("=")) continue;
    const index = line.indexOf("=");
    map.set(line.slice(0, index).trim(), line.slice(index + 1).trim());
  }
  return map;
}

const env = values(".env");
function filled(name) {
  const value = env.get(name) ?? "";
  return value.length > 0 && !value.startsWith("replace-with") && !value.includes("REPLACE_WITH");
}

if (env.get("APP_ENV") !== "staging" && env.get("APP_ENV") !== "production") {
  gap("APP_ENV", "staging or production for a release runtime");
}
if (env.get("AUTH_MODE") !== "supabase") gap("AUTH_MODE", "must be supabase; development tokens are local only");
const supabaseUrl = env.get("SUPABASE_URL") ?? "";
if (!filled("SUPABASE_URL") || !supabaseUrl.startsWith("https://") || /localhost|127\.0\.0\.1|:5[45]421\b/.test(supabaseUrl)) {
  gap("SUPABASE_URL", "hosted Supabase project URL (https, not the local CLI stack)");
}
for (const [name, purpose] of [
  ["SUPABASE_PUBLISHABLE_KEY", "public client key for the hosted project; the only key allowed in iOS"],
  ["SUPABASE_SECRET_KEY", "server-only key for ban/deletion checks; never in the app or Git"],
  ["APNS_TEAM_ID", "APNs token authentication"],
  ["APNS_KEY_ID", "APNs token authentication"],
  ["APNS_PRIVATE_KEY", "APNs .p8 contents stored as a server secret"],
  ["REVENUECAT_WEBHOOK_SECRET", "server verification of entitlement changes"],
  ["REVENUECAT_PUBLIC_SDK_KEY", "public iOS SDK key; not a server secret"],
  ["APPLE_TEAM_ID", "10-character signing prefix for the association file"],
]) {
  if (!filled(name)) gap(name, purpose);
}
if (!filled("ANTHROPIC_API_KEY")) {
  console.log("optional  ANTHROPIC_API_KEY: recommendations stay on the database fallback");
}
if (env.get("LEGAL_STATUS") !== "approved") gap("LEGAL_STATUS", "draft pages must stay drafts until counsel-approved text exists");
const contact = env.get("LEGAL_CONTACT_EMAIL") ?? "";
if (!contact || contact.endsWith(".invalid") || contact.includes("example")) {
  gap("LEGAL_CONTACT_EMAIL", "real operator contact; placeholder addresses are not published as support");
}
const releaseXcconfig = (existsSync("ios/Config/Release.xcconfig") ? readFileSync("ios/Config/Release.xcconfig", "utf8") : "")
  .split("\n")
  .filter((line) => !line.trim().startsWith("//"))
  .join("\n");
const iosSupabaseUrl = releaseXcconfig.match(/^SUPABASE_URL[ \t]*=[ \t]*(.*)$/m)?.[1]?.trim() ?? "";
const iosSupabaseKey = releaseXcconfig.match(/^SUPABASE_PUBLISHABLE_KEY[ \t]*=[ \t]*(.*)$/m)?.[1]?.trim() ?? "";
if (!iosSupabaseUrl.includes(".") || iosSupabaseUrl.includes("REPLACE_WITH")) gap("ios Release SUPABASE_URL", "hosted project host in ios/Config/Release.xcconfig");
if (!iosSupabaseKey || iosSupabaseKey.includes("REPLACE_WITH")) gap("ios Release SUPABASE_PUBLISHABLE_KEY", "publishable key in ios/Config/Release.xcconfig");
if (/sb_secret_|service_role/.test(releaseXcconfig)) gap("ios Release xcconfig", "contains a server-only Supabase key; remove it");

const live = spawnSync("node", ["apps/realtime/scripts/supabase-live-smoke.mjs"], { encoding: "utf8", env: process.env });
process.stdout.write(`${live.stdout ?? ""}${live.stderr ?? ""}`);
if (live.status !== 0) gap("supabase-live-smoke", live.status === 3 ? "SKIPPED: hosted Supabase smoke values are not set" : "hosted Supabase smoke failed");

let identities;
try {
  identities = execFileSync("security", ["find-identity", "-v", "-p", "codesigning"], { encoding: "utf8" });
} catch {
  identities = "";
}
const identityCount = Number(identities.match(/(\d+) valid identities found/)?.[1] ?? 0);
if (identityCount === 0) gap("Apple code-signing identity", "device and distribution signing; simulator Debug does not use it");

const terraformFiles = [
  "infra/terraform/environments/staging/main.tf",
  "infra/terraform/environments/production/main.tf",
];
for (const file of terraformFiles) {
  const text = existsSync(file) ? readFileSync(file, "utf8") : "";
  if (text.includes("REPLACE_WITH_")) gap(file, "state bucket, lock table, and domain are still placeholders");
}

const verification = spawnSync("node", ["scripts/verify-release.mjs"], {
  env: { ...process.env, VERIFY_APP_ENV: "production", VERIFY_EXPECT_REJECTION: "1" },
  encoding: "utf8",
});
const verificationOutput = `${verification.stdout ?? ""}${verification.stderr ?? ""}`;
process.stdout.write(verificationOutput);
if (verification.status !== 0 || !verificationOutput.includes("release configuration rejected")) {
  gap("verify-release", "production configuration was accepted from this process environment");
}

if (missing.length === 0) {
  console.log("release check passed");
  process.exit(0);
}
console.log("release check failed");
for (const item of missing) console.log(`missing  ${item.name}: ${item.purpose}`);
process.exit(1);
