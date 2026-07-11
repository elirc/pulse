# App API (S05 deploy). Built from repo root:  docker build -f apps/api/Dockerfile -t pulse-api .
FROM node:20-slim AS build
RUN corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @pulse/db run generate
RUN pnpm --filter @pulse/api run build

FROM node:20-slim AS runtime
RUN corepack enable
WORKDIR /app
COPY --from=build /app/apps/api/dist ./dist
COPY --from=build /app/node_modules ./node_modules
ENV NODE_ENV=production API_PORT=3001
EXPOSE 3001
HEALTHCHECK --interval=10s --timeout=3s --retries=5 CMD node -e "fetch('http://localhost:3001/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]
