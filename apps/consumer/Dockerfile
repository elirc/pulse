# Consumer (S05 deploy). A worker, not an HTTP server — no port, no HTTP healthcheck; liveness is "is it acking?"
# which the app API's /ops/ingest exposes (consumer lag). Built from repo root.
FROM node:20-slim AS build
RUN corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @pulse/db run generate
RUN pnpm --filter @pulse/consumer run build

FROM node:20-slim AS runtime
RUN corepack enable
WORKDIR /app
COPY --from=build /app/apps/consumer/dist ./dist
COPY --from=build /app/node_modules ./node_modules
ENV NODE_ENV=production
CMD ["node", "dist/index.js"]
