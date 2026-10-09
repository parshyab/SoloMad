import { loadEnv } from "@solomad/config";
import { createSql } from "@solomad/db";
import { createGateway, localVerifier } from "./server";

async function main() {
  const env = loadEnv();
  const sql = createSql(env.DATABASE_URL);
  const gateway = await createGateway(env, sql, localVerifier(env));
  await new Promise<void>((resolve) => gateway.httpServer.listen(env.REALTIME_PORT, env.API_HOST, () => resolve()));
  console.log(JSON.stringify({ level: "info", msg: "realtime listening", port: env.REALTIME_PORT, transport: "websocket" }));
}

void main();
