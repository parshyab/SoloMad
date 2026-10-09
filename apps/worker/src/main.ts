import { createServer } from "node:http";
import { loadEnv } from "@solomad/config";
import { createSql } from "@solomad/db";
import { processOutboxBatch } from "./process";

async function main() {
  const env = loadEnv();
  const sql = createSql(env.DATABASE_URL);
  const server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  });
  server.listen(env.WORKER_PORT, env.API_HOST);
  console.log(JSON.stringify({ level: "info", msg: "worker listening", port: env.WORKER_PORT }));
  for (;;) {
    await processOutboxBatch(sql, env).catch((error: unknown) => {
      console.error(JSON.stringify({ level: "error", msg: error instanceof Error ? error.message : "worker failed" }));
    });
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

void main();
