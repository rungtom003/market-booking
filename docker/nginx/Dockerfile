# syntax=docker/dockerfile:1
# Nginx = static ของ apps/web + apps/admin + reverse proxy (/api, /socket.io, ไฟล์ MinIO)
#   docker build -f docker/nginx/Dockerfile --build-arg VITE_LINE_LIFF_ID=... .
# ค่า VITE_* ฝังลง bundle ตอน build — เปลี่ยนค่าแล้วต้อง build image ใหม่

FROM node:24-alpine AS build
RUN npm install -g pnpm@11.21.0
ENV CI=true
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY packages/stall-map/package.json packages/stall-map/
COPY apps/web/package.json apps/web/
COPY apps/admin/package.json apps/admin/
RUN pnpm install --frozen-lockfile --ignore-scripts \
  --filter @market-booking/web... --filter @market-booking/admin...
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY packages/stall-map packages/stall-map
COPY apps/web apps/web
COPY apps/admin apps/admin
# LIFF ID ของ LINE Login (ว่าง = ซ่อนปุ่ม LINE)
ARG VITE_LINE_LIFF_ID=
ENV VITE_LINE_LIFF_ID=${VITE_LINE_LIFF_ID}
RUN pnpm --filter @market-booking/shared build \
  && pnpm --filter @market-booking/web build \
  && pnpm --filter @market-booking/admin build

FROM nginx:1.28-alpine
# สร้าง cert ชั่วคราว (self-signed) ตอนยังไม่มี cert จาก Let's Encrypt
RUN apk add --no-cache openssl
COPY docker/nginx/nginx.conf /etc/nginx/nginx.conf
COPY docker/nginx/templates /etc/nginx/templates
COPY --chmod=755 docker/nginx/40-ssl-certificate.sh /docker-entrypoint.d/40-ssl-certificate.sh
COPY --from=build /app/apps/web/dist /usr/share/nginx/web
COPY --from=build /app/apps/admin/dist /usr/share/nginx/admin
HEALTHCHECK --interval=10s --timeout=3s --retries=3 \
  CMD wget -qO- http://127.0.0.1/healthz > /dev/null || exit 1
