# syntax=docker/dockerfile:1

FROM node:24-alpine@sha256:6a1c190e17215d844926b0677f4bf87273ff7d5e54db06d3b5b5863ab0b09a3d AS base
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/web/package.json packages/web/package.json
COPY packages/mascot/package.json packages/mascot/package.json
# Sources are not copied yet, so workspace lifecycle scripts (mascot "prepare") run in the build stage instead.
RUN pnpm install --frozen-lockfile --ignore-scripts

FROM deps AS build
ARG APP_VERSION=0.0.0
ARG GIT_COMMIT=local
ARG BUILD_TIME
ENV APP_VERSION=$APP_VERSION GIT_COMMIT=$GIT_COMMIT BUILD_TIME=$BUILD_TIME
COPY . .
RUN pnpm mascot:build && pnpm --filter @beamling/web build

FROM node:24-alpine@sha256:6a1c190e17215d844926b0677f4bf87273ff7d5e54db06d3b5b5863ab0b09a3d AS runner
ARG APP_VERSION=0.0.0
ARG GIT_COMMIT=local
ARG BUILD_TIME
LABEL org.opencontainers.image.title="Beamling" \
      org.opencontainers.image.version="$APP_VERSION" \
      org.opencontainers.image.revision="$GIT_COMMIT" \
      org.opencontainers.image.created="$BUILD_TIME"
# The runtime only needs node. Removing npm/corepack also removes their bundled dependency trees,
# which are not part of the application and have their own vulnerability surface.
RUN apk upgrade --no-cache \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx \
       /usr/local/lib/node_modules/corepack /usr/local/bin/corepack \
    && addgroup -S beamling && adduser -S beamling -G beamling
WORKDIR /app
# NEXT_MANUAL_SIG_HANDLE hands SIGTERM to lib/server/startup.ts, which stores running answers before exiting.
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    NEXT_TELEMETRY_DISABLED=1 \
    NEXT_MANUAL_SIG_HANDLE=true \
    NODE_PATH=/app/node_modules/.pnpm/node_modules

COPY --from=build --chown=beamling:beamling /app/packages/web/.next/standalone ./
COPY --from=build --chown=beamling:beamling /app/packages/web/.next/static ./packages/web/.next/static
COPY --from=build --chown=beamling:beamling /app/packages/web/public ./packages/web/public
COPY --from=build --chown=beamling:beamling /app/packages/web/drizzle ./drizzle
COPY --from=build --chown=beamling:beamling /app/packages/web/scripts/migrate.mjs ./scripts/migrate.mjs
COPY --from=build --chown=beamling:beamling /app/packages/web/scripts/rewrap-credentials.mjs ./scripts/rewrap-credentials.mjs

USER beamling
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null || exit 1
CMD ["node", "packages/web/server.js"]
