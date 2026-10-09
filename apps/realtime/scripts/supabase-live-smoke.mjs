// Hosted Supabase Auth smoke against a deployed API and gateway. Uses an owner-created test account
// in the hosted project. Tokens and passwords are never printed.
// When .env.supabase.staging.local exists, these names come only from that file so a local
// Supabase URL in the shell cannot be treated as the hosted project.
// Exit codes: 0 passed, 1 failed, 3 SKIPPED (hosted configuration absent; this is not a pass).
import { io } from "socket.io-client";
import { readStagingFile } from "../../../scripts/staging-env.mjs";

const required = [
  "SUPABASE_URL",
  "SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SMOKE_EMAIL",
  "SUPABASE_SMOKE_PASSWORD",
  "API_PUBLIC_ORIGIN",
  "REALTIME_PUBLIC_ORIGIN",
];
const staging = readStagingFile();
if (staging) {
  for (const name of required) delete process.env[name];
  for (const name of required) {
    if (staging[name]) process.env[name] = staging[name];
  }
}
const missing = required.filter((name) => !process.env[name]);
if (missing.length > 0) {
  console.log(`SKIPPED  supabase live smoke: missing ${missing.join(", ")}`);
  console.log("A skip is not hosted token verification and does not satisfy release checks.");
  process.exit(3);
}

const url = process.env.SUPABASE_URL.replace(/\/$/, "");
for (const [name, value] of [["SUPABASE_URL", url], ["API_PUBLIC_ORIGIN", process.env.API_PUBLIC_ORIGIN], ["REALTIME_PUBLIC_ORIGIN", process.env.REALTIME_PUBLIC_ORIGIN]]) {
  if (!value.startsWith("https://") || /localhost|127\.0\.0\.1|host\.docker\.internal/.test(value)) {
    console.error(`FAILED  ${name} must be a hosted https origin for the live smoke`);
    process.exit(1);
  }
}

let failed = 0;
function check(name, ok, detail = "") {
  if (!ok) failed += 1;
  console.log(`${ok ? "PASSED" : "FAILED"}  ${name}${detail ? ` (${detail})` : ""}`);
}

const headers = { apikey: process.env.SUPABASE_PUBLISHABLE_KEY, "content-type": "application/json" };
const signIn = await fetch(`${url}/auth/v1/token?grant_type=password`, {
  method: "POST",
  headers,
  body: JSON.stringify({ email: process.env.SUPABASE_SMOKE_EMAIL, password: process.env.SUPABASE_SMOKE_PASSWORD }),
});
check("hosted Supabase password sign-in", signIn.ok, `status ${signIn.status}`);
if (!signIn.ok) process.exit(1);
const session = await signIn.json();

const me = await fetch(`${process.env.API_PUBLIC_ORIGIN}/v1/me`, { headers: { authorization: `Bearer ${session.access_token}` } });
check("API accepts the hosted Supabase token", me.ok, `status ${me.status}`);

const socket = io(process.env.REALTIME_PUBLIC_ORIGIN, { transports: ["websocket"], auth: { token: session.access_token }, reconnection: false });
const connected = await new Promise((resolve) => {
  const timer = setTimeout(() => resolve(false), 15000);
  socket.once("connect", () => { clearTimeout(timer); resolve(true); });
  socket.once("connect_error", () => { clearTimeout(timer); resolve(false); });
});
check("gateway accepts the hosted Supabase token", connected);
socket.disconnect();

const logout = await fetch(`${url}/auth/v1/logout?scope=local`, {
  method: "POST",
  headers: { apikey: process.env.SUPABASE_PUBLISHABLE_KEY, authorization: `Bearer ${session.access_token}` },
});
check("hosted Supabase logout", logout.status === 204, `status ${logout.status}`);
const window = Number(process.env.SUPABASE_SESSION_CHECK_TTL_SECONDS ?? 30);
await new Promise((resolve) => setTimeout(resolve, (window + 1) * 1000));
const after = await fetch(`${process.env.API_PUBLIC_ORIGIN}/v1/me`, { headers: { authorization: `Bearer ${session.access_token}` } });
check(`API rejects the signed-out token within ${window}s`, after.status === 401, `status ${after.status}`);

console.log(failed ? `supabase live smoke: ${failed} failed` : "supabase live smoke passed");
process.exit(failed ? 1 : 0);
