# syntax=docker/dockerfile:1
# API (NestJS) — build context = root ของ repo:
#   docker build -f docker/api.Dockerfile --target runtime .
# target:
#   build    = deps ครบ + source (ใช้เป็น image "tools": prisma migrate deploy, seed, สคริปต์ admin)
#   runtime  = เฉพาะ dist + production dependencies (image ที่รันจริง)

FROM node:24-alpine AS base
# prisma schema engine (migrate) บน Alpine ต้องมี OpenSSL
RUN apk add --no-cache openssl \
  && npm install -g pnpm@11.21.0
ENV CI=true
WORKDIR /app
# manifest ก่อน source — layer install ถูก cache ไว้ตราบที่ dependency ไม่เปลี่ยน
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/

FROM base AS build
# postinstall ของ api = prisma generate (ต้องมี schema + config)
COPY apps/api/prisma apps/api/prisma
COPY apps/api/prisma.config.ts apps/api/
RUN pnpm install --frozen-lockfile --filter @market-booking/api...
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @market-booking/shared build && pnpm --filter @market-booking/api build

# production dependencies ตาม lockfile (ไม่รัน script: prisma generate ทำใน build แล้ว, client อยู่ใน dist)
FROM base AS prod-deps
RUN pnpm install --frozen-lockfile --prod --ignore-scripts --filter @market-booking/api...

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
# โครงเดียวกับ workspace — node_modules ของ api ชี้ (symlink) ไป packages/shared
COPY --from=prod-deps --chown=node:node /app ./
COPY --from=build --chown=node:node /app/packages/shared/dist packages/shared/dist
COPY --from=build --chown=node:node /app/apps/api/dist apps/api/dist
WORKDIR /app/apps/api
USER node
EXPOSE 3000
# liveness เท่านั้น — readiness (DB/Redis) อยู่ที่ /health/ready ให้ uptime monitor
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/v1/health > /dev/null || exit 1
CMD ["node", "dist/main.js"]
