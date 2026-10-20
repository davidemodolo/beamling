# syntax=docker/dockerfile:1

FROM node:24-alpine AS base
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
COPY . .
RUN pnpm mascot:build && pnpm --filter @beamling/web build

FROM node:24-alpine AS runner
RUN addgroup -S beamling && adduser -S beamling -G beamling
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    NEXT_TELEMETRY_DISABLED=1 \
    NODE_PATH=/app/node_modules/.pnpm/node_modules

COPY --from=build --chown=beamling:beamling /app/packages/web/.next/standalone ./
COPY --from=build --chown=beamling:beamling /app/packages/web/.next/static ./packages/web/.next/static
COPY --from=build --chown=beamling:beamling /app/packages/web/public ./packages/web/public
COPY --from=build --chown=beamling:beamling /app/packages/web/drizzle ./drizzle
COPY --from=build --chown=beamling:beamling /app/packages/web/scripts/migrate.mjs ./scripts/migrate.mjs

USER beamling
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null || exit 1
CMD ["node", "packages/web/server.js"]
