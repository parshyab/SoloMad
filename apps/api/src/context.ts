import { loadEnv } from "@solomad/config";
import { createSql } from "@solomad/db";
import { Redis } from "ioredis";
import { ENV, REDIS, SQL } from "./tokens";

export const providers = [
  { provide: ENV, useFactory: () => loadEnv() },
  {
    provide: SQL,
    inject: [ENV],
    useFactory: (env: ReturnType<typeof loadEnv>) => createSql(env.DATABASE_URL),
  },
  {
    provide: REDIS,
    inject: [ENV],
    useFactory: (env: ReturnType<typeof loadEnv>) => {
      if (!env.REDIS_URL) return null;
      const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 1, lazyConnect: true });
      redis.on("error", () => undefined);
      void redis.connect().catch(() => undefined);
      return redis;
    },
  },
];
