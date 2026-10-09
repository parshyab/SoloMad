// Local Supabase Auth smoke: real GoTrue sessions from the local CLI stack against the real API
// process and the Socket.IO gateway. Tokens and passwords are never printed.
import { spawn } from "node:child_process";
import { loadEnv } from "@solomad/config";
import { createSql } from "@solomad/db";
import { verifyIdentity } from "@solomad/domain";
import { SignJWT, exportJWK, generateKeyPair } from "jose";
import { io } from "socket.io-client";
import { createGateway, localVerifier } from "../dist/server.js";

const root = new URL("../../../", import.meta.url).pathname;
process.chdir(root);
const { devEnv } = await import(`${root}scripts/dev.mjs`);
const { readLocalSupabase } = await import(`${root}scripts/supabase-env.mjs`);

const local = readLocalSupabase();
if (!local?.SOLOMAD_LOCAL_PASSWORD) throw new Error("Run make supabase-start and node scripts/supabase-seed.mjs first.");
const ttlSeconds = 2;
const apiPort = 3105;
const processEnv = { ...devEnv(), API_PORT: String(apiPort), SUPABASE_SESSION_CHECK_TTL_SECONDS: String(ttlSeconds) };
const env = loadEnv(processEnv);
const minaId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const jonahId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const conversationId = "dddddddd-dddd-4ddd-8ddd-ddddddddddd1";
const strangerRoom = "99999999-9999-4999-8999-999999999999";
const results = [];
const auth = `${local.SUPABASE_URL}/auth/v1`;
const admin = { apikey: local.SUPABASE_SECRET_KEY, authorization: `Bearer ${local.SUPABASE_SECRET_KEY}`, "content-type": "application/json" };

function check(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`${ok ? "PASSED" : "FAILED"}  ${name}${detail ? ` (${detail})` : ""}`);
}

async function signIn(email) {
  const response = await fetch(`${auth}/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: local.SUPABASE_PUBLISHABLE_KEY, "content-type": "application/json" },
    body: JSON.stringify({ email, password: local.SOLOMAD_LOCAL_PASSWORD }),
  });
  if (!response.ok) throw new Error(`sign-in for ${email} failed with ${response.status}`);
  return response.json();
}

async function refresh(session) {
  const response = await fetch(`${auth}/token?grant_type=refresh_token`, {
    method: "POST",
    headers: { apikey: local.SUPABASE_PUBLISHABLE_KEY, "content-type": "application/json" },
    body: JSON.stringify({ refresh_token: session.refresh_token }),
  });
  if (!response.ok) throw new Error(`refresh failed with ${response.status}`);
  return response.json();
}

async function api(path, token, init = {}) {
  const response = await fetch(`http://127.0.0.1:${apiPort}${path}`, {
    ...init,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(init.body ? { "content-type": "application/json" } : {}) },
  });
  const body = await response.json().catch(() => ({}));
  return { status: response.status, body };
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const settle = () => wait(ttlSeconds * 1000 + 500);

const apiProcess = spawn("node", ["apps/api/dist/main.js"], { env: processEnv, stdio: ["ignore", "ignore", "inherit"] });
const sql = createSql(env.DATABASE_URL);
const gateway = await createGateway(env, sql, localVerifier(env));
await new Promise((resolve) => gateway.httpServer.listen(0, "127.0.0.1", resolve));
const gatewayPort = gateway.httpServer.address().port;
const sockets = [];
const connect = (token) => {
  const socket = io(`http://127.0.0.1:${gatewayPort}`, { transports: ["websocket"], auth: { token }, reconnection: false });
  sockets.push(socket);
  return socket;
};
let leilaUserId;
let deletedUserId;

try {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if ((await fetch(`http://127.0.0.1:${apiPort}/health`).catch(() => null))?.ok) break;
    await wait(200);
  }

  const mina = await signIn("mina@solomad.test");
  const jonah = await signIn("jonah@solomad.test");

  const minaMe = await api("/v1/me", mina.access_token);
  check("API maps the verified Supabase sub to the seeded application user", minaMe.status === 200 && minaMe.body.account?.id === minaId, `status ${minaMe.status}`);
  const again = await api("/v1/me", mina.access_token);
  const [{ count }] = await sql`SELECT count(*)::int AS count FROM identities WHERE user_id = ${minaId} AND provider = 'supabase'`;
  check("Repeated sign-in does not duplicate the profile or identity", again.body.account?.id === minaId && count === 1);

  check("API rejects a missing token", (await api("/v1/me")).status === 401);
  const garbage = await api("/v1/me", "not-a-jwt");
  check("API rejects a malformed token", garbage.status === 401 && garbage.body.error?.code === "invalid_token");

  const { privateKey, publicKey } = await generateKeyPair("ES256");
  const forged = await new SignJWT({ role: "authenticated", session_id: "00000000-0000-4000-8000-000000000000", aud: "authenticated" })
    .setProtectedHeader({ alg: "ES256", kid: (await exportJWK(publicKey)).kid ?? "other-project" })
    .setIssuer(env.SUPABASE_JWT_ISSUER)
    .setSubject("00000000-0000-4000-8000-000000000001")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);
  const forgedResult = await api("/v1/me", forged);
  check("API rejects a token signed by another project's key", forgedResult.status === 401 && forgedResult.body.error?.code === "invalid_token");
  const wrongIssuer = await verifyIdentity(mina.access_token, { ...env, SUPABASE_JWT_ISSUER: "https://other-project.supabase.co/auth/v1" }).catch((error) => error);
  check("Verifier rejects a valid token when the trusted issuer differs", wrongIssuer?.code === "invalid_token");

  const minaSocket = connect(mina.access_token);
  const jonahSocket = connect(jonah.access_token);
  await Promise.all([once(minaSocket, "connect"), once(jonahSocket, "connect")]);
  const joins = await Promise.all([emitAck(minaSocket, "room:join", conversationId), emitAck(jonahSocket, "room:join", conversationId)]);
  check("Both members join the shared chat with Supabase tokens", joins.every((join) => join.ok));
  const clientMessageId = `auth-smoke-${Date.now()}`;
  const incoming = once(jonahSocket, "message.created");
  const sent = await emitAck(minaSocket, "message:send", { conversationId, clientMessageId, body: "supabase auth smoke", userId: jonahId });
  const delivered = await incoming;
  check("Message is delivered to the other user with the verified sender", sent.ok && delivered.senderId === minaId);
  const [stored] = await sql`SELECT sender_id FROM messages WHERE client_message_id = ${clientMessageId}`;
  check("Message is persisted in PostgreSQL under the verified sender, ignoring the spoofed userId", stored?.sender_id === minaId);
  const history = await api(`/v1/conversations/${conversationId}/messages`, jonah.access_token);
  check("The other user reads the persisted message through the API", JSON.stringify(history.body).includes(clientMessageId) || JSON.stringify(history.body).includes("supabase auth smoke"));

  const denied = await emitAck(minaSocket, "room:join", strangerRoom);
  check("Gateway refuses a room the user is not a member of", Boolean(denied.error));

  const refreshed = await refresh(mina);
  const refreshAck = await emitAck(minaSocket, "auth:refresh", { token: refreshed.access_token });
  const afterRefresh = await emitAck(minaSocket, "room:join", conversationId);
  check("Socket accepts a refreshed token for the same user", refreshAck.ok === true && afterRefresh.ok === true);
  const swap = await emitAck(jonahSocket, "auth:refresh", { token: refreshed.access_token });
  check("Socket refuses a refresh that switches to another user", Boolean(swap.error));

  const jonah2 = await signIn("jonah@solomad.test");
  const jonahSocket2 = connect(jonah2.access_token);
  await once(jonahSocket2, "connect");
  check("A second session for the same user is authorized", (await emitAck(jonahSocket2, "room:join", conversationId)).ok === true);
  const logout = await fetch(`${auth}/logout?scope=local`, {
    method: "POST",
    headers: { apikey: local.SUPABASE_PUBLISHABLE_KEY, authorization: `Bearer ${jonah2.access_token}` },
  });
  check("Supabase logout succeeds", logout.status === 204);
  await settle();
  const afterLogout = await api("/v1/me", jonah2.access_token);
  check("API rejects the signed-out session within the propagation window", afterLogout.status === 401 && afterLogout.body.error?.code === "session_revoked");
  const revokedDisconnect = once(jonahSocket2, "disconnect");
  const revokedJoin = await emitAck(jonahSocket2, "room:join", conversationId);
  await revokedDisconnect;
  check("Established socket with the signed-out session is refused and disconnected", revokedJoin.error?.code === "session_revoked");
  const reconnect = connect(jonah2.access_token);
  check("Reconnect with the signed-out session is refused", Boolean(await once(reconnect, "connect_error")));
  const jonahFresh = await signIn("jonah@solomad.test");
  const rejoin = connect(jonahFresh.access_token);
  await once(rejoin, "connect");
  check("Reconnect after signing in again is authorized", (await emitAck(rejoin, "room:join", conversationId)).ok === true);
  check("A rejected user-switching refresh disconnected that socket", !jonahSocket.connected);
  const firstSession = connect(jonah.access_token);
  await once(firstSession, "connect");
  const otherSession = await emitAck(firstSession, "room:join", conversationId);
  check("Signing out one session leaves the user's other sessions active", otherSession.ok === true);

  const leila = await signIn("leila@solomad.test");
  leilaUserId = (await fetch(`${auth}/user`, { headers: { apikey: local.SUPABASE_PUBLISHABLE_KEY, authorization: `Bearer ${leila.access_token}` } }).then((r) => r.json())).id;
  check("Leila is authorized before the ban", (await api("/v1/me", leila.access_token)).status === 200);
  await fetch(`${auth}/admin/users/${leilaUserId}`, { method: "PUT", headers: admin, body: JSON.stringify({ ban_duration: "24h" }) });
  await settle();
  const banned = await api("/v1/me", leila.access_token);
  check("API rejects a banned account's still-unexpired token", banned.status === 403 && banned.body.error?.code === "account_banned", `${banned.status} ${banned.body.error?.code}`);
  const bannedSocket = connect(leila.access_token);
  check("Gateway refuses a banned account", Boolean(await once(bannedSocket, "connect_error")));

  const email = `smoke-deleted-${Date.now()}@solomad.test`;
  const created = await fetch(`${auth}/admin/users`, {
    method: "POST",
    headers: admin,
    body: JSON.stringify({ email, password: local.SOLOMAD_LOCAL_PASSWORD, email_confirm: true, user_metadata: { solomad_seed: true } }),
  }).then((r) => r.json());
  deletedUserId = created.id;
  const doomed = await signIn(email);
  const before = await verifyIdentity(doomed.access_token, env).catch((error) => error);
  check("A temporary local user verifies before deletion", before?.subject === deletedUserId);
  await fetch(`${auth}/admin/users/${deletedUserId}`, { method: "DELETE", headers: admin });
  deletedUserId = undefined;
  await settle();
  const afterDelete = await api("/v1/me", doomed.access_token);
  check("API rejects a deleted user's still-unexpired token", afterDelete.status === 401 && afterDelete.body.error?.code === "session_revoked");
} catch (error) {
  check(`smoke aborted: ${error.message}`, false);
} finally {
  if (leilaUserId) await fetch(`${auth}/admin/users/${leilaUserId}`, { method: "PUT", headers: admin, body: JSON.stringify({ ban_duration: "none" }) });
  if (deletedUserId) await fetch(`${auth}/admin/users/${deletedUserId}`, { method: "DELETE", headers: admin });
  sockets.forEach((socket) => socket.disconnect());
  await gateway.close();
  await sql.end();
  apiProcess.kill("SIGTERM");
}

const failed = results.filter((result) => !result.ok).length;
console.log(`\nauth-smoke: ${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

function once(socket, event) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for ${event}`)), 15000);
    socket.once(event, (value) => {
      clearTimeout(timer);
      resolve(value ?? true);
    });
  });
}

function emitAck(socket, event, payload) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for ${event} ack`)), 15000);
    socket.emit(event, payload, (body) => {
      clearTimeout(timer);
      resolve(body);
    });
  });
}
