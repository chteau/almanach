# syntax=docker/dockerfile:1
FROM oven/bun:1.3.14-alpine AS build
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build \
  && rm -rf node_modules apps/*/node_modules packages/*/node_modules \
  && bun install --frozen-lockfile --production

FROM oven/bun:1.3.14-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build --chown=root:root /app/package.json ./
COPY --from=build --chown=root:root /app/node_modules ./node_modules
COPY --from=build --chown=root:root /app/packages/shared ./packages/shared
COPY --from=build --chown=root:root /app/apps/server ./apps/server
COPY --from=build --chown=root:root /app/apps/web/dist ./apps/web/dist
COPY --from=build --chown=root:root /app/packs ./packs
USER bun
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD bun -e "fetch('http://127.0.0.1:8080/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["bun", "apps/server/src/index.ts"]
