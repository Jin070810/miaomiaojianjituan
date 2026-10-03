# syntax=docker/dockerfile:1.7

ARG APP_COMMIT_SHA=unknown
ARG APP_BUILD_TIME=unknown

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
# Next's standalone tracer keeps the Playwright runtime because server routes
# share the video job module; retain its registry metadata so app health checks
# do not fail while the browser is only used by the Worker image.
COPY --from=builder /app/node_modules/playwright-core/browsers.json ./node_modules/playwright-core/browsers.json
COPY --from=builder /app/prisma ./prisma
# Next image optimization writes here; only the cache directory needs write access.
RUN mkdir -p .next/cache && chown -R node:node .next/cache
# Runtime metadata must not invalidate the dependency or Next build layers.
ARG APP_COMMIT_SHA
ARG APP_BUILD_TIME
ENV APP_COMMIT_SHA=$APP_COMMIT_SHA
ENV APP_BUILD_TIME=$APP_BUILD_TIME
USER node
EXPOSE 3000
CMD ["node", "server.js"]

FROM node:22-alpine AS worker
RUN apk add --no-cache chromium curl nss freetype harfbuzz ca-certificates ttf-freefont
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json worker.ts ./
COPY lib ./lib
COPY prisma ./prisma
COPY scripts/seed-admin.ts ./scripts/seed-admin.ts
COPY scripts/reconcile-redemption-orders.ts ./scripts/reconcile-redemption-orders.ts
COPY scripts/reconcile-data.ts ./scripts/reconcile-data.ts
COPY scripts/ops-daily-check.ts ./scripts/ops-daily-check.ts
COPY scripts/upload-oss-backup.ts ./scripts/upload-oss-backup.ts
COPY scripts/download-oss-backup.ts ./scripts/download-oss-backup.ts
COPY scripts/send-ops-alert.ts ./scripts/send-ops-alert.ts
RUN npx prisma generate
COPY scripts/worker-healthcheck.js ./scripts/worker-healthcheck.js
ARG APP_COMMIT_SHA
ARG APP_BUILD_TIME
ENV APP_COMMIT_SHA=$APP_COMMIT_SHA
ENV APP_BUILD_TIME=$APP_BUILD_TIME
# Worker 仍以 root 运行：backups 卷来自宿主机目录（root 属主），切换非 root 需要
# 在部署脚本中同步调整宿主机目录属主，属于单独的运维变更。
CMD ["./node_modules/.bin/tsx", "worker.ts"]
