import { readFileSync } from "node:fs";
import { createSql } from "@solomad/db";
import { signLocalToken } from "@solomad/domain";

const env = Object.fromEntries(
  readFileSync(new URL("../../../.env", import.meta.url), "utf8")
    .split("\n")
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
);
const api = "http://127.0.0.1:3000";
const dinner = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const chat = "dddddddd-dddd-4ddd-8ddd-ddddddddddd1";
const leila = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3";
const sql = createSql(env.DATABASE_URL);
const { readLocalSupabase } = await import(new URL("../../../scripts/supabase-env.mjs", import.meta.url).href);
const local = readLocalSupabase();
async function supabaseToken(email) {
  const response = await fetch(`${local.SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: local.SUPABASE_PUBLISHABLE_KEY, "content-type": "application/json" },
    body: JSON.stringify({ email, password: local.SOLOMAD_LOCAL_PASSWORD }),
  });
  if (!response.ok) throw new Error(`local Supabase sign-in for ${email} failed with ${response.status}`);
  return (await response.json()).access_token;
}
// The API under make dev runs AUTH_MODE=supabase; LOCAL_FLOW_AUTH=development targets a development-mode API.
const useSupabase = process.env.LOCAL_FLOW_AUTH !== "development" && Boolean(local?.SOLOMAD_LOCAL_PASSWORD);
const mina = useSupabase ? await supabaseToken("mina@solomad.test") : await signLocalToken(env.DEV_AUTH_SECRET, "solomad-dev", "apple", "dev:mina");
const leilaToken = useSupabase ? await supabaseToken("leila@solomad.test") : await signLocalToken(env.DEV_AUTH_SECRET, "solomad-dev", "apple", "dev:leila");
console.log(`auth: ${useSupabase ? "local Supabase sessions" : "development tokens"}`);

async function call(token, method, path, body) {
  const response = await fetch(`${api}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body ? { "content-type": "application/json" } : {}),
      "idempotency-key": `${method}:${path}:${Date.now()}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { unparsed: true };
  }
  return { status: response.status, payload };
}

function line(name, status, detail) {
  console.log(`${status}  ${name}${detail ? `: ${detail}` : ""}`);
}

const health = await fetch(`${api}/health`);
line("health", health.status);
const ready = await fetch(`${api}/ready`);
line("ready", ready.status);
const stats = await fetch(`${api}/v1/public/stats`);
const statsBody = await stats.json();
line("public stats", stats.status, `source=${statsBody.source ?? "unknown"}`);

const me = await call(mina, "GET", "/v1/me");
line("mina profile", me.status, me.payload?.profile?.displayName ?? me.payload?.displayName ?? me.payload?.code ?? "ok");
const discovery = await call(mina, "GET", "/v1/discovery?latitude=38.7139&longitude=-9.1334&radiusMeters=5000&zoom=13");
const items = discovery.payload?.items?.length ?? discovery.payload?.clusters?.length ?? 0;
line("discovery", discovery.status, `mode=${discovery.payload?.mode ?? "none"} count=${items}`);
const trips = await call(mina, "GET", "/v1/trips");
line("trips", trips.status, `count=${trips.payload?.trips?.length ?? 0}`);
const created = await call(leilaToken, "POST", "/v1/trips", {
  cityId: "22222222-2222-4222-8222-222222222222",
  startDate: "2026-11-02",
  endDate: "2026-11-06",
});
line("leila trip", created.status, created.payload?.tripId ? "created" : created.payload?.message ?? created.payload?.code ?? "no id");
if (created.payload?.tripId) {
  const removed = await call(leilaToken, "DELETE", `/v1/trips/${created.payload.tripId}`);
  line("leila trip delete", removed.status);
}
const joined = await call(leilaToken, "POST", `/v1/activities/${dinner}/join`);
line("leila join dinner", joined.status, joined.payload?.message ?? joined.payload?.code ?? joined.payload?.status ?? "ok");
const left = await call(leilaToken, "POST", `/v1/activities/${dinner}/leave`);
line("leila leave dinner", left.status, left.payload?.message ?? left.payload?.code ?? "ok");
const inbox = await call(mina, "GET", "/v1/conversations");
line("mina inbox", inbox.status, `count=${inbox.payload?.conversations?.length ?? inbox.payload?.length ?? 0}`);
const history = await call(mina, "GET", `/v1/conversations/${chat}/messages`);
line("dinner history", history.status, `count=${history.payload?.messages?.length ?? history.payload?.length ?? 0}`);
const recommendations = await call(mina, "GET", "/v1/recommendations");
line("recommendations", recommendations.status, `source=${recommendations.payload?.source} ai=${recommendations.payload?.ai ?? "unset"}`);
const entitlements = await call(mina, "GET", "/v1/entitlements");
line("entitlements", entitlements.status, `plus=${entitlements.payload?.plusActive === true}`);
const report = await call(mina, "POST", "/v1/reports", { targetType: "activity", targetId: dinner, reason: "local development check" });
line("report", report.status, report.payload?.code ?? "accepted");
const blocked = await call(mina, "POST", "/v1/blocks", { userId: leila });
line("block", blocked.status, blocked.payload?.code ?? "accepted");
await sql`DELETE FROM blocks WHERE blocker_id = ${"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1"} AND blocked_id = ${leila}`;
line("block cleanup", 200, "seed block row removed");
const missing = await fetch(`${api}/v1/me`);
line("missing token", missing.status);
await sql.end();
