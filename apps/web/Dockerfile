# Web (S05 deploy). Build the Vite SPA to static assets, serve them with a tiny static server. Built from root.
FROM node:20-slim AS build
RUN corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @pulse/web run build

FROM node:20-slim AS runtime
WORKDIR /app
RUN corepack enable && npm i -g serve
COPY --from=build /app/apps/web/dist ./dist
EXPOSE 4173
CMD ["serve", "-s", "dist", "-l", "4173"]
