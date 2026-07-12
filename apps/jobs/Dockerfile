# Jobs worker (S09 deploy). Behavioral-cohort recompute + scheduling; no HTTP port. Built from repo root.
FROM node:20-slim AS build
RUN corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @pulse/db run generate
RUN pnpm --filter @pulse/jobs run build

FROM node:20-slim AS runtime
RUN corepack enable
WORKDIR /app
COPY --from=build /app/apps/jobs/dist ./dist
COPY --from=build /app/node_modules ./node_modules
ENV NODE_ENV=production
CMD ["node", "dist/index.js"]
