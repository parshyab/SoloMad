import "reflect-metadata";
import { loadEnv, corsOrigins } from "@solomad/config";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import cors from "@fastify/cors";
import { AppModule } from "./app.module";
import { ApiExceptionFilter } from "./http";

async function bootstrap() {
  const env = loadEnv();
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: false }),
    { logger: ["error", "warn"], rawBody: true },
  );
  await app.register(cors, { origin: corsOrigins(env), credentials: true });
  app.useGlobalFilters(new ApiExceptionFilter());
  await app.listen({ host: env.API_HOST, port: env.API_PORT });
  console.log(JSON.stringify({ level: "info", msg: "api listening", port: env.API_PORT, env: env.APP_ENV, auth: env.AUTH_MODE }));
}

void bootstrap();
