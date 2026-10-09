import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseDotenv } from "./dotenv.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
export const stagingFile = join(root, ".env.supabase.staging.local");
const clientConfig = join(root, "ios/Config/Staging.local.xcconfig");

const AUTH_NAMES = ["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SECRET_KEY", "SUPABASE_SMOKE_EMAIL", "SUPABASE_SMOKE_PASSWORD"];
const ORIGIN_NAMES = ["API_PUBLIC_ORIGIN", "REALTIME_PUBLIC_ORIGIN"];

export function readStagingFile() {
  if (!existsSync(stagingFile)) return null;
  return parseDotenv(readFileSync(stagingFile, "utf8"));
}

export function missingNames(values, names) {
  return names.filter((name) => !values?.[name]);
}

function httpsHost(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    if (url.pathname !== "/" && url.pathname !== "") return null;
    return url.hostname;
  } catch {
    return null;
  }
}

export function validateStagingAuth(values) {
  const errors = [];
  const missing = missingNames(values, AUTH_NAMES);
  if (missing.length > 0) errors.push(`missing ${missing.join(", ")}`);
  const host = values?.SUPABASE_URL ? httpsHost(values.SUPABASE_URL) : null;
  if (values?.SUPABASE_URL && (!host || !host.endsWith(".supabase.co") || host === "localhost")) {
    errors.push("SUPABASE_URL must be the hosted project's https://<ref>.supabase.co endpoint");
  }
  const publishable = values?.SUPABASE_PUBLISHABLE_KEY ?? "";
  const secret = values?.SUPABASE_SECRET_KEY ?? "";
  if (publishable && !publishable.startsWith("sb_publishable_")) {
    errors.push("SUPABASE_PUBLISHABLE_KEY must be the sb_publishable_ client key");
  }
  if (publishable.startsWith("sb_secret_") || publishable.includes("service_role")) {
    errors.push("SUPABASE_PUBLISHABLE_KEY contains a server secret");
  }
  if (secret && !secret.startsWith("sb_secret_")) {
    errors.push("SUPABASE_SECRET_KEY must be the sb_secret_ server key");
  }
  if (publishable && secret && publishable === secret) {
    errors.push("SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY must be different keys");
  }
  for (const name of ORIGIN_NAMES) {
    const value = values?.[name];
    if (!value) continue;
    const origin = httpsHost(value);
    if (!origin || origin === "localhost" || origin.endsWith(".invalid")) {
      errors.push(`${name} must be an https origin of a deployed service`);
    }
  }
  return errors;
}

export function derivedAuth(values) {
  const base = values.SUPABASE_URL.replace(/\/$/, "");
  return {
    SUPABASE_URL: base,
    SUPABASE_PUBLISHABLE_KEY: values.SUPABASE_PUBLISHABLE_KEY,
    SUPABASE_SECRET_KEY: values.SUPABASE_SECRET_KEY,
    SUPABASE_JWT_ISSUER: `${base}/auth/v1`,
    SUPABASE_JWT_AUDIENCE: "authenticated",
    SUPABASE_JWKS_URL: `${base}/auth/v1/.well-known/jwks.json`,
    SUPABASE_SMOKE_EMAIL: values.SUPABASE_SMOKE_EMAIL,
    SUPABASE_SMOKE_PASSWORD: values.SUPABASE_SMOKE_PASSWORD,
    API_PUBLIC_ORIGIN: values.API_PUBLIC_ORIGIN ?? "",
    REALTIME_PUBLIC_ORIGIN: values.REALTIME_PUBLIC_ORIGIN ?? "",
  };
}

function xcconfig(value) {
  return value.replaceAll("//", "/$()/");
}

export function writeStagingClientConfig(values) {
  const errors = validateStagingAuth(values);
  const blocking = errors.filter((error) => !error.startsWith("missing") || /SUPABASE_URL|SUPABASE_PUBLISHABLE_KEY|SUPABASE_SECRET_KEY/.test(error));
  if (blocking.length > 0) {
    throw new Error(blocking.join("; "));
  }
  const lines = [
    "// Generated from .env.supabase.staging.local. Client-safe values only.",
    `SUPABASE_URL = ${xcconfig(values.SUPABASE_URL.replace(/\/$/, ""))}`,
    `SUPABASE_PUBLISHABLE_KEY = ${xcconfig(values.SUPABASE_PUBLISHABLE_KEY)}`,
  ];
  if (values.API_PUBLIC_ORIGIN) lines.push(`API_BASE_URL = ${xcconfig(values.API_PUBLIC_ORIGIN)}`);
  if (values.REALTIME_PUBLIC_ORIGIN) lines.push(`REALTIME_BASE_URL = ${xcconfig(values.REALTIME_PUBLIC_ORIGIN)}`);
  const body = `${lines.join("\n")}\n`;
  if (body.includes("sb_secret_") || body.includes(values.SUPABASE_SECRET_KEY) || body.includes("SUPABASE_SMOKE_PASSWORD")) {
    throw new Error("refusing to write server credentials into the iOS configuration");
  }
  writeFileSync(clientConfig, body, { mode: 0o600 });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const values = readStagingFile();
  if (!values) {
    console.error("missing .env.supabase.staging.local");
    process.exit(1);
  }
  const errors = validateStagingAuth(values);
  if (errors.length > 0) {
    console.error(errors.join("; "));
    process.exit(1);
  }
  if (process.argv.includes("--write-client")) {
    writeStagingClientConfig(values);
    console.log("wrote ios/Config/Staging.local.xcconfig (SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY)");
  } else {
    const present = [...AUTH_NAMES, ...ORIGIN_NAMES].filter((name) => values[name]);
    const absent = [...AUTH_NAMES, ...ORIGIN_NAMES].filter((name) => !values[name]);
    console.log(`staging file present: ${present.join(", ") || "none"}`);
    console.log(`staging file empty: ${absent.join(", ") || "none"}`);
  }
}
