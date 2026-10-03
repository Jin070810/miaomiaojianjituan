# syntax=docker/dockerfile:1.7

ARG APP_COMMIT_SHA=unknown
ARG APP_BUILD_TIME=unknown

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

FROM node:22-alpine AS builder
ARG APP_COMMIT_SHA
ARG APP_BUILD_TIME
WORKDIR /app
ENV APP_COMMIT_SHA=$APP_COMMIT_SHA
ENV APP_BUILD_TIME=$APP_BUILD_TIME
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN npm run build

FROM node:22-alpine AS runner
ARG APP_COMMIT_SHA
ARG APP_BUILD_TIME
WORKDIR /app
ENV NODE_ENV=production
ENV APP_COMMIT_SHA=$APP_COMMIT_SHA
ENV APP_BUILD_TIME=$APP_BUILD_TIME
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
# Next's standalone tracer keeps the Playwright runtime because server routes
# share the video job module; retain its registry metadata so app health checks
# do not fail while the browser is only used by the Worker image.
COPY --from=builder /app/node_modules/playwright-core/browsers.json ./node_modules/playwright-core/browsers.json
COPY --from=builder /app/prisma ./prisma
# Web 服务不写文件系统，使用镜像自带的 node 用户运行，缩小攻击面。
USER node
EXPOSE 3000
CMD ["node", "server.js"]

FROM node:22-alpine AS worker
ARG APP_COMMIT_SHA
ARG APP_BUILD_TIME
RUN apk add --no-cache chromium curl nss freetype harfbuzz ca-certificates ttf-freefont
WORKDIR /app
ENV NODE_ENV=production
ENV APP_COMMIT_SHA=$APP_COMMIT_SHA
ENV APP_BUILD_TIME=$APP_BUILD_TIME
COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json worker.ts ./
COPY lib ./lib
COPY prisma ./prisma
COPY scripts/seed-admin.ts ./scripts/seed-admin.ts
COPY scripts/reconcile-redemption-orders.ts ./scripts/reconcile-redemption-orders.ts
COPY scripts/reconcile-data.ts ./scripts/reconcile-data.ts
COPY scripts/rebuild-member-achievements.ts ./scripts/rebuild-member-achievements.ts
COPY scripts/ops-daily-check.ts ./scripts/ops-daily-check.ts
COPY scripts/upload-oss-backup.ts ./scripts/upload-oss-backup.ts
COPY scripts/download-oss-backup.ts ./scripts/download-oss-backup.ts
COPY scripts/send-ops-alert.ts ./scripts/send-ops-alert.ts
RUN npx prisma generate
COPY scripts/worker-healthcheck.js ./scripts/worker-healthcheck.js
# Worker 仍以 root 运行：backups 卷来自宿主机目录（root 属主），切换非 root 需要
# 在部署脚本中同步调整宿主机目录属主，属于单独的运维变更。
CMD ["./node_modules/.bin/tsx", "worker.ts"]
