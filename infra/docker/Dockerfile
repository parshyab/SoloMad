# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS base
WORKDIR /app
RUN corepack enable

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps
RUN pnpm install --frozen-lockfile

FROM deps AS build
ARG SERVICE
RUN pnpm --filter "@solomad/${SERVICE}..." build

FROM base AS runtime
ARG SERVICE
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/package.json ./package.json
COPY --from=deps /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/${SERVICE} ./apps/${SERVICE}
COPY infra/docker/entrypoint.sh infra/docker/start-with-runtime.mjs /app/infra/docker/
RUN chmod +x /app/infra/docker/entrypoint.sh
ENV SOLOMAD_SERVICE=${SERVICE}
EXPOSE 3000 3001
ENTRYPOINT ["/app/infra/docker/entrypoint.sh"]
