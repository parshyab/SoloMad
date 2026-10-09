import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, it } from "vitest";

const exec = promisify(execFile);

describe("socket.io gateway", () => {
  it("authenticates, acknowledges, deduplicates, and rejects a stale room", async () => {
    await exec("pnpm", ["--filter", "@solomad/realtime", "build"], { cwd: process.cwd() });
    await exec("node", ["apps/realtime/scripts/smoke.mjs"], { cwd: process.cwd(), timeout: 30_000 });
  }, 60_000);
});
