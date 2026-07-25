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
COPY --from=builder /app/prisma ./prisma
EXPOSE 3000
CMD ["node", "server.js"]

FROM node:22-alpine AS worker
ARG APP_COMMIT_SHA
ARG APP_BUILD_TIME
RUN apk add --no-cache curl
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
COPY scripts/ops-daily-check.ts ./scripts/ops-daily-check.ts
RUN npx prisma generate
CMD ["npx", "tsx", "worker.ts"]
