import { readFileSync } from "node:fs";
import { signLocalToken } from "../packages/domain/dist/index.js";

const who = process.argv[2] ?? "mina";
const subjects = {
  mina: "dev:mina",
  jonah: "dev:jonah",
  leila: "dev:leila",
  admin: "dev:admin",
};
const subject = subjects[who];
if (!subject) {
  console.error("use mina, jonah, leila, or admin");
  process.exit(1);
}
const env = Object.fromEntries(
  readFileSync(".env", "utf8")
    .split("\n")
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
);
if (!env.DEV_AUTH_SECRET) {
  console.error("DEV_AUTH_SECRET is missing from .env");
  process.exit(1);
}
const token = await signLocalToken(env.DEV_AUTH_SECRET, "solomad-dev", "apple", subject);
process.stdout.write(`${token}\n`);
