# Ingest (S05 deploy). Multi-stage: build with the full workspace, ship a lean runtime. Built from repo root:
#   docker build -f apps/ingest/Dockerfile -t pulse-ingest .
FROM node:20-slim AS build
RUN corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @pulse/db run generate
RUN pnpm --filter @pulse/ingest run build

FROM node:20-slim AS runtime
RUN corepack enable
WORKDIR /app
COPY --from=build /app/apps/ingest/dist ./dist
COPY --from=build /app/node_modules ./node_modules
ENV NODE_ENV=production INGEST_PORT=3002
EXPOSE 3002
# Health gate: orchestrator polls /health before routing traffic (see docker-compose.yml).
HEALTHCHECK --interval=10s --timeout=3s --retries=5 CMD node -e "fetch('http://localhost:3002/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]
