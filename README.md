# ระบบจองล็อคขายของตลาด (market-booking)

ผู้ค้าสมัครสมาชิกและจองล็อคขายของแบบ Realtime โดย Admin ควบคุมการอนุมัติ ผังล็อค ราคา และรอบการเปิดจอง

- การออกแบบระบบ (Source of Truth): [`docs/01-system-overview.md`](docs/01-system-overview.md)
- แผนการพัฒนาและสถานะ: [`docs/02-development-phases.md`](docs/02-development-phases.md)

## สิ่งที่ต้องมี

- Node.js ≥ 22.12 (แนะนำ 24 ตาม `.nvmrc`)
- pnpm 11 (`corepack enable` แล้วจะใช้เวอร์ชันตาม `packageManager` ให้อัตโนมัติ)
- Docker Desktop / Docker Engine + Compose v2

## เริ่มต้น dev ใน 5 นาที

```bash
# 1. ติดตั้ง dependency (ตั้ง git hooks ให้อัตโนมัติด้วย)
pnpm install

# 2. สร้างไฟล์ env (ค่าใน .env.example ใช้กับ docker-compose ได้ทันที)
cp .env.example .env

# 3. เปิด PostgreSQL, Redis, MinIO
docker compose up -d

# 4. รันทุก app พร้อมกัน (watch mode)
pnpm dev
```

| App           | URL                                                                           |
| ------------- | ----------------------------------------------------------------------------- |
| API (NestJS)  | http://localhost:3000/api/v1/health                                           |
| Vendor web    | http://localhost:5173                                                         |
| Admin web     | http://localhost:5174                                                         |
| MinIO console | http://localhost:9001 (user/pass ตาม `MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY`) |

หน้าแรกของ web และ admin แสดง "เซิร์ฟเวอร์ทำงานปกติ" ถ้าต่อ API ได้ (ผ่าน Vite proxy `/api` → `:3000` เหมือน Nginx ใน production)

## Scripts (รันที่ root)

| คำสั่ง                              | ทำอะไร                                                            |
| ----------------------------------- | ----------------------------------------------------------------- |
| `pnpm dev`                          | build `shared` แล้วรัน api + web + admin + shared (watch) แบบขนาน |
| `pnpm build`                        | build ทุก package ตามลำดับ dependency                             |
| `pnpm lint` / `pnpm lint:fix`       | ESLint ทั้ง monorepo                                              |
| `pnpm format` / `pnpm format:check` | Prettier                                                          |
| `pnpm typecheck`                    | `tsc --noEmit` ทุก package                                        |
| `pnpm test`                         | Jest (api: unit + e2e ผ่าน Supertest)                             |

รันเฉพาะ package: `pnpm --filter @market-booking/api test`

## โครงสร้าง

```
apps/api         NestJS 10 — REST /api/v1 (+ Socket.IO ใน Phase 4)
apps/web         React 18 + Vite + Tailwind — ผู้ค้า (mobile-first)
apps/admin       React 18 + Vite + MUI — ผู้ดูแล
packages/shared  enum, zod schema, type, ชื่อ socket event ที่ใช้ร่วมกัน
docs/            เอกสารออกแบบและแผนงาน
```

`packages/shared` build เป็นทั้ง ESM (สำหรับ Vite) และ CommonJS (สำหรับ NestJS/Jest) ลง `dist/` —
`pnpm dev`, `typecheck`, `test` จะ build ให้ก่อนเสมอ ถ้า import จาก shared ไม่เจอ ให้รัน `pnpm build:shared`

## Commit

ใช้ [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `chore:` …) — `commit-msg` hook ตรวจด้วย commitlint
และ `pre-commit` รัน ESLint + Prettier เฉพาะไฟล์ที่ stage ไว้ (lint-staged)

## ปัญหาที่พบบ่อย

- **API ขึ้น `Invalid environment variables`** — ยังไม่ได้ `cp .env.example .env` หรือค่าบางตัวผิดรูปแบบ ข้อความจะบอกชื่อตัวแปร
- **Port ชน (5432/6379/9000/3000/5173/5174)** — ปิดโปรแกรมที่ใช้ port นั้นอยู่ หรือแก้ port ใน `docker-compose.yml` / `.env`
- **รีเซ็ตข้อมูล infra ทั้งหมด** — `docker compose down -v` (ลบ volume ของ postgres/redis/minio)
