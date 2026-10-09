import { loadEnv, ConfigError } from "../packages/config/dist/index.js";

const env = { ...process.env, APP_ENV: process.env.VERIFY_APP_ENV ?? "production" };
try {
  loadEnv(env);
  console.log("release configuration accepted");
} catch (error) {
  if (error instanceof ConfigError) {
    console.log(`release configuration rejected: ${error.message}`);
    process.exit(process.env.VERIFY_EXPECT_REJECTION === "1" ? 0 : 1);
  }
  throw error;
}
