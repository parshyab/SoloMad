import { readFileSync } from "node:fs";
import { createSql } from "@solomad/db";
import { DomainError, signLocalToken } from "@solomad/domain";
import { io } from "socket.io-client";
import { createGateway, localVerifier } from "../dist/server.js";

const env = Object.fromEntries(
  readFileSync(new URL("../../../.env", import.meta.url), "utf8")
    .split("\n")
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
);
const appEnv = {
  ...env,
  APP_ENV: "development",
  AUTH_MODE: "development",
  DATABASE_URL: env.DATABASE_URL,
  REDIS_URL: env.REDIS_URL,
  CORS_ORIGINS: env.CORS_ORIGINS ?? "http://127.0.0.1:3020",
  DEV_AUTH_SECRET: env.DEV_AUTH_SECRET,
};
const sql = createSql(appEnv.DATABASE_URL);
const gateway = await createGateway(appEnv, sql, localVerifier(appEnv));
await new Promise((resolve) => gateway.httpServer.listen(0, "127.0.0.1", resolve));
const address = gateway.httpServer.address();
const port = typeof address === "object" && address ? address.port : 0;
const token = await signLocalToken(appEnv.DEV_AUTH_SECRET, "solomad-dev", "apple", "dev:mina");
const jonahToken = await signLocalToken(appEnv.DEV_AUTH_SECRET, "solomad-dev", "apple", "dev:jonah");
const conversationId = "dddddddd-dddd-4ddd-8ddd-ddddddddddd1";
const minaId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const jonahId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";

const socket = io(`http://127.0.0.1:${port}`, { transports: ["websocket"], auth: { token } });
const jonah = io(`http://127.0.0.1:${port}`, { transports: ["websocket"], auth: { token: jonahToken } });
await connected(socket);
await connected(jonah);
const joined = await emitAck(socket, "room:join", conversationId);
const jonahJoined = await emitAck(jonah, "room:join", conversationId);
if (!joined.ok || !jonahJoined.ok) throw new Error(`room join failed: ${JSON.stringify({ joined, jonahJoined })}`);
const clientMessageId = `smoke-${Date.now()}`;
const incoming = once(jonah, "message.created");
const sent = await emitAck(socket, "message:send", {
  conversationId,
  clientMessageId,
  body: "socket.io smoke",
  userId: jonahId,
});
if (!sent.ok || !sent.id) throw new Error(`send failed: ${JSON.stringify(sent)}`);
const delivered = await incoming;
if (delivered.senderId !== minaId || delivered.body !== "socket.io smoke") {
  throw new Error(`delivery used the wrong sender: ${JSON.stringify(delivered)}`);
}
const again = await emitAck(socket, "message:send", {
  conversationId,
  clientMessageId,
  body: "socket.io smoke",
});
if (!again.replayed) throw new Error("a retried clientMessageId was stored again");
socket.disconnect();
jonah.disconnect();

const [stored] = await sql`
  SELECT sender_id, body FROM messages WHERE client_message_id = ${clientMessageId}
`;
if (stored?.sender_id !== minaId) throw new Error("the stored sender followed the client userId");

const stranger = io(`http://127.0.0.1:${port}`, { transports: ["websocket"], auth: { token: "not-a-token" } });
await once(stranger, "connect_error");
stranger.disconnect();

const member = io(`http://127.0.0.1:${port}`, { transports: ["websocket"], auth: { token } });
await connected(member);
const denied = await emitAck(member, "room:join", "99999999-9999-4999-8999-999999999999");
if (!denied.error) throw new Error("a room the user does not belong to was accepted");
const deniedSend = await emitAck(member, "message:send", {
  conversationId: "99999999-9999-4999-8999-999999999999",
  clientMessageId: `denied-${Date.now()}`,
  body: "not a member",
});
if (!deniedSend.error) throw new Error("a message without membership was accepted");
member.disconnect();

const reconnected = io(`http://127.0.0.1:${port}`, { transports: ["websocket"], auth: { token: jonahToken } });
await connected(reconnected);
const rejoined = await emitAck(reconnected, "room:join", conversationId);
if (!rejoined.ok) throw new Error("reconnect with a fresh token was rejected");
reconnected.disconnect();

let checks = 0;
const expiring = async (value) => {
  checks += 1;
  const identity = await localVerifier(appEnv)(value);
  if (checks > 1) throw new DomainError("invalid_token", 401, "Token expired during the connection");
  return identity;
};
const expiringGateway = await createGateway(appEnv, sql, expiring);
await new Promise((resolve) => expiringGateway.httpServer.listen(0, "127.0.0.1", resolve));
const expiringAddress = expiringGateway.httpServer.address();
const expiringPort = typeof expiringAddress === "object" && expiringAddress ? expiringAddress.port : 0;
const refreshed = io(`http://127.0.0.1:${expiringPort}`, { transports: ["websocket"], auth: { token } });
await connected(refreshed);
const expiredJoin = await emitAck(refreshed, "room:join", conversationId);
if (expiredJoin.error?.code !== "invalid_token") throw new Error(`expired session stayed authorized: ${JSON.stringify(expiredJoin)}`);
if (refreshed.connected) await once(refreshed, "disconnect");
await expiringGateway.close();

const [afterRestart] = await sql`
  SELECT body FROM messages WHERE client_message_id = ${clientMessageId}
`;
if (afterRestart?.body !== "socket.io smoke") throw new Error("the message did not remain after the gateway closed");

await gateway.close();
await sql.end();
console.log(`socket.io ack ${sent.id} replayed=${Boolean(again.replayed)}`);

function connected(socket) {
  if (socket.connected) return Promise.resolve();
  return once(socket, "connect");
}

function once(socket, event) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for ${event}`)), 15000);
    socket.once(event, (value) => {
      clearTimeout(timer);
      resolve(value);
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
