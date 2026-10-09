// Fail-closed check for APP_ENV=staging. Does not start servers or print values.
import { loadEnv, ConfigError } from "../packages/config/dist/index.js";
import { derivedAuth, readStagingFile, validateStagingAuth } from "./staging-env.mjs";

const values = readStagingFile() ?? {};
const errors = validateStagingAuth(values);
if (errors.length > 0) {
  console.error(`staging configuration: ${errors.join("; ")}`);
  process.exit(1);
}
const auth = derivedAuth(values);
try {
  loadEnv({
    ...auth,
    APP_ENV: "staging",
    AUTH_MODE: "supabase",
  });
  console.log("staging runtime configuration accepted");
} catch (error) {
  if (error instanceof ConfigError) {
    console.log(`staging runtime fail closed: ${error.message}`);
    process.exit(1);
  }
  throw error;
}
