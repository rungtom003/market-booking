# ระบบจองล็อคขายของตลาด — แผนการพัฒนา (Development Phases)

> อ่านคู่กับ `01-system-overview.md` (Source of Truth ของการออกแบบ)
> ไฟล์นี้ใช้ติดตามความคืบหน้า **Agent ต้องอัปเดตสถานะทุกครั้งที่เริ่มและจบงาน**

---

## 📌 คำสั่งสำหรับ Agent (อ่านก่อนเริ่มทุกครั้ง)

1. **เลือกงาน**: ทำ Phase/Sub-phase ที่สถานะ `⬜ TODO` ลำดับแรกที่ Dependencies เป็น `✅ DONE` ครบแล้ว ห้ามข้าม Phase เว้นแต่ผู้ใช้สั่ง
2. **ก่อนเริ่ม**: เปลี่ยนสถานะเป็น `🟨 IN PROGRESS` ทั้งใน [ตารางสรุป](#-ตารางสรุปสถานะ) และในหัวข้อของ Phase นั้น ใส่วันที่เริ่ม
3. **ระหว่างทำ**: ติ๊ก `[x]` ใน Task ที่ทำเสร็จทีละข้อ
4. **เมื่อเสร็จ**: ตรวจ [Definition of Done](#-definition-of-done-ใช้กับทุก-phase) ครบ แล้วเปลี่ยนเป็น `✅ DONE` ใส่วันที่เสร็จ และเขียนบันทึกสั้นๆ ในช่อง **Agent Notes** (ไฟล์สำคัญที่สร้าง, ข้อจำกัด, สิ่งที่ Phase ถัดไปต้องรู้)
5. **ติดปัญหา**: เปลี่ยนเป็น `⛔ BLOCKED` เขียนสาเหตุใน Agent Notes และแจ้งผู้ใช้ ห้ามเดาเปลี่ยนการออกแบบเอง
6. **ถ้าต้องเปลี่ยนการออกแบบ**: แก้ `01-system-overview.md` และเพิ่มแถวใน Decision Log ก่อน แล้วค่อยเขียนโค้ด
7. **ทุกครั้งที่จบงาน**: เพิ่มบรรทัดใน [Progress Log](#-progress-log) ท้ายไฟล์
8. Phase แม่จะเป็น `✅ DONE` ได้เมื่อ Sub-phase ทั้งหมดเป็น `✅ DONE`

### สัญลักษณ์สถานะ
| สถานะ | ความหมาย |
|---|---|
| `⬜ TODO` | ยังไม่เริ่ม |
| `🟨 IN PROGRESS` | กำลังทำ |
| `✅ DONE` | เสร็จและผ่าน Definition of Done |
| `⛔ BLOCKED` | ติดปัญหา รอการตัดสินใจ |
| `⏸️ DEFERRED` | เลื่อนออกไป (ผู้ใช้ตัดสินใจ) |

---

## ✔️ Definition of Done (ใช้กับทุก Phase)

- [ ] Task ในหัวข้อนั้นติ๊กครบ และ Acceptance Criteria ผ่านทุกข้อ
- [ ] `pnpm lint` และ `pnpm typecheck` ผ่านทั้ง monorepo
- [ ] `pnpm test` ผ่าน และมี test ครอบคลุม logic ใหม่ใน Service
- [ ] Prisma migration (ถ้ามี) รันบน DB เปล่าได้ และ seed ยังทำงาน
- [ ] ไม่มี secret ใน code, `.env.example` อัปเดตตัวแปรใหม่แล้ว
- [ ] Endpoint ใหม่มีใน Swagger (`/api/docs`)
- [ ] อัปเดตสถานะ + Agent Notes + Progress Log ในไฟล์นี้แล้ว

---

## 📊 ตารางสรุปสถานะ

| Phase | ชื่อ | สถานะ | เริ่ม | เสร็จ |
|---|---|---|---|---|
| 0 | Project Setup | ✅ DONE | 2026-10-31 | 2026-10-31 |
| 1 | Backend Foundation | ✅ DONE | 2026-10-31 | 2026-10-31 |
| 1.1 | ↳ Database Schema & Seed | ✅ DONE | 2026-10-31 | 2026-10-31 |
| 1.2 | ↳ Core Infrastructure (config, error, logging, audit) | ✅ DONE | 2026-10-31 | 2026-10-31 |
| 1.3 | ↳ Admin Auth & RBAC | ✅ DONE | 2026-10-31 | 2026-10-31 |
| 1.4 | ↳ Vendor Auth (OTP + LINE) | ✅ DONE | 2026-10-31 | 2026-10-31 |
| 1.5 | ↳ Settings Module | ✅ DONE | 2026-10-31 | 2026-10-31 |
| 2 | Member Registration & Approval | ✅ DONE | 2026-10-31 | 2026-10-31 |
| 2.1 | ↳ Vendor API & File Upload | ✅ DONE | 2026-10-31 | 2026-10-31 |
| 2.2 | ↳ Vendor Web: สมัครสมาชิก | ✅ DONE | 2026-10-31 | 2026-10-31 |
| 2.3 | ↳ Admin Web: Shell + อนุมัติสมาชิก + Settings | ✅ DONE | 2026-10-31 | 2026-10-31 |
| 3 | Market Setup | ✅ DONE | 2026-10-31 | 2026-10-31 |
| 3.1 | ↳ Zones, Categories, Stalls (API + Admin UI) | ✅ DONE | 2026-10-31 | 2026-10-31 |
| 3.2 | ↳ Booking Rounds & Market Days (API + Admin UI) | ✅ DONE | 2026-10-31 | 2026-10-31 |
| 4 | Realtime Booking ⭐ | ⬜ TODO | | |
| 4.1 | ↳ Booking Core API + Concurrency | ⬜ TODO | | |
| 4.2 | ↳ Expiry Worker (BullMQ) | ⬜ TODO | | |
| 4.3 | ↳ Realtime Gateway (Socket.IO) | ⬜ TODO | | |
| 4.4 | ↳ Vendor Web: หน้าผังและจองล็อค | ⬜ TODO | | |
| 4.5 | ↳ Admin Web: จัดการการจอง | ⬜ TODO | | |
| 4.6 | ↳ Concurrency & Load Test | ⬜ TODO | | |
| 5 | Payment | ⬜ TODO | | |
| 5.1 | ↳ Payment API + PromptPay QR | ⬜ TODO | | |
| 5.2 | ↳ Vendor & Admin Payment UI | ⬜ TODO | | |
| 6 | MVP Deployment 🚀 | ⬜ TODO | | |
| 7 | Notifications (LINE OA / SMS) | ⬜ TODO | | |
| 8 | Reports & Dashboard | ⬜ TODO | | |
| 9 | Advanced Booking | ⬜ TODO | | |
| 9.1 | ↳ Map Editor (ลากวาง) | ⬜ TODO | | |
| 9.2 | ↳ Waitlist | ⬜ TODO | | |
| 9.3 | ↳ Announcements | ⬜ TODO | | |
| 10 | Check-in & No-show | ⬜ TODO | | |
| 11 | Hardening & Scale | ⬜ TODO | | |

**Milestone MVP** = Phase 0 – 6 (สมัคร → อนุมัติ → ตั้งค่าตลาด → จอง Realtime → ชำระเงิน → ขึ้นระบบจริง)

```
0 ─► 1.1 ─► 1.2 ─► 1.3 ─► 1.5 ─► 2.1 ─► 2.2
                    └─► 1.4 ─┘      └─► 2.3 ─► 3.1 ─► 3.2 ─► 4.1 ─► 4.2 ─► 4.3 ─► 4.4 ─► 4.5 ─► 4.6
                                                                                              │
                     7 ◄── 6 ◄── 5.2 ◄── 5.1 ◄──────────────────────────────────────────────────┘
                     │
                     ├─► 8 ─► 9.x ─► 10 ─► 11
```

---

## Phase 0 — Project Setup
**สถานะ:** ✅ DONE · **Dependencies:** — · **เริ่ม:** 2026-10-31 · **เสร็จ:** 2026-10-31

**เป้าหมาย:** Monorepo ที่รันได้ทั้ง 3 apps พร้อม infra สำหรับ dev

**Tasks**
- [x] สร้าง pnpm workspace: `apps/api`, `apps/web`, `apps/admin`, `packages/shared`
- [x] NestJS ใน `apps/api` (port 3000), Vite React-TS ใน `apps/web` (5173) และ `apps/admin` (5174)
- [x] ตั้งค่า Tailwind ใน web, MUI ใน admin, TanStack Query + axios client ในทั้งสอง
- [x] `packages/shared` export ได้จากทั้ง api และ frontend (tsconfig paths / build)
- [x] `tsconfig.base.json` (strict), ESLint, Prettier, `.editorconfig`
- [x] `docker-compose.yml`: postgres 16, redis 7, minio
- [x] `.env.example` ตาม Overview §14, config module validate env ด้วย Zod
- [x] Root scripts: `dev`, `build`, `lint`, `typecheck`, `test`
- [x] Husky + lint-staged + commitlint
- [x] GitHub Actions: lint + typecheck + test
- [x] `README.md` วิธีรัน dev ภายใน 5 นาที

**Acceptance Criteria**
- `docker compose up -d && pnpm dev` แล้วเปิดได้ทั้ง 3 apps, `GET /api/v1/health` ตอบ 200
- CI ผ่านบน branch แรก

**Agent Notes:**
- ✅ AC ข้อ 1 ผ่านแล้ว (2026-10-31): `docker compose up -d && pnpm dev` → api :3000, web :5173, admin :5174 เปิดได้ทั้งหมด, `GET /api/v1/health` ตอบ 200 ทั้งตรงและผ่าน Vite proxy, ทั้งสองหน้าเว็บแสดงสถานะจาก API โดยไม่มี console error
- ✅ AC ข้อ 2 ผ่านแล้ว (2026-10-31): GitHub Actions run [#41159342264](https://github.com/rungtom003/market-booking/actions/runs/41159342264) บน `main` (commit `1d598be`) → success
- ไฟล์สำคัญ: `apps/api/src/config/env.schema.ts` (Zod env + `validateEnv`), `apps/api/src/config/app-config.service.ts` (`AppConfigService.get()` type-safe), `apps/api/src/setup-app.ts` (prefix/CORS ใช้ร่วม main.ts กับ e2e), `packages/shared/src/*` (`API_PREFIX`, `ErrorCode`, `SocketEvent`, `socketRoom`)
- `packages/shared` build คู่ ESM+CJS — **ต้อง build ก่อน** api/web/admin จะเห็นของใหม่ (`pnpm dev` รัน `tsc -w` ให้แล้ว); enum ใน Phase 1.1 ให้เพิ่มที่ `packages/shared/src/` แล้ว export จาก `index.ts` (ใช้นามสกุล `.js` ใน relative import)
- Test env ของ api ตั้งใน `apps/api/test/setup-env.ts` (Jest `setupFiles`) เพราะ `ConfigModule.forRoot()` validate ตอน import — Phase ถัดไปที่เพิ่ม env บังคับต้องเพิ่มที่ไฟล์นี้ด้วย
- ยังไม่ทำ (เป็นงานของ Phase 1.2): global response interceptor `{ data }`, exception filter, Swagger — ตอนนี้ `/health` คืน object ตรงๆ
- MinIO ใช้ image `pgsty/minio` (ดู Decision Log) + service `minio-init` สร้าง private bucket ให้อัตโนมัติ
- pnpm 11: `allowBuilds` ใน `pnpm-workspace.yaml` ปิด install script ของ dependency ไว้ — Phase 1.1 ต้องเพิ่ม `prisma`, `@prisma/engines`, `@prisma/client` เป็น `true` ไม่งั้น Prisma generate/engine จะไม่ถูกติดตั้ง
- eslint ปักไว้ `~10.13.0` เพราะ 10.14.0 ใหม่เกิน `minimumReleaseAge` ของ pnpm (ไม่ได้ bypass การตรวจ)

---

## Phase 1 — Backend Foundation
**สถานะ:** ✅ DONE · **Dependencies:** Phase 0

### 1.1 Database Schema & Seed
**สถานะ:** ✅ DONE · **Dependencies:** 0 · **เริ่ม:** 2026-10-31 · **เสร็จ:** 2026-10-31

**Tasks**
- [x] `schema.prisma` ครบทุกตารางและ Enum ตาม Overview §7 (ใช้ `@map` เป็น snake_case)
- [x] Migration แรก + raw SQL migration สำหรับ partial index ทั้ง 4 ตัวใน §7.2 _(ประกาศใน schema ด้วย preview `partialIndexes` แทน raw SQL — ดู Decision Log)_
- [x] `PrismaService` + graceful shutdown
- [x] `seed.ts`: 1 market, SUPER_ADMIN 1 คน (รหัสจาก env), product categories ตัวอย่าง, 2 zones, 20 stalls, settings ค่า default ทั้งหมด
- [x] ย้าย Enum ไป export ผ่าน `packages/shared` (ให้ frontend ใช้ได้)

**Acceptance Criteria**
- `pnpm prisma migrate reset` สำเร็จและมีข้อมูล seed
- ทดสอบ SQL: insert booking active 2 รายการ stall/day เดียวกัน → error unique violation; ถ้ารายการแรกเป็น `EXPIRED` → insert ได้

**Agent Notes:**
- ✅ AC ข้อ 2 ผ่าน: `apps/api/test/integration/booking-unique.int-spec.ts` (`pnpm test:int`) — active ซ้ำทุกสถานะ → `P2002`, รายการแรก EXPIRED/CANCELLED → insert ได้, insert พร้อมกัน 3 ตัว → สำเร็จ 1, raw SQL insert ก็โดนบล็อก
- ✅ AC ข้อ 1 ผ่าน (ผู้ใช้ยินยอมให้รัน reset): `pnpm db:reset` → reset DB dev, apply migration, seed ครบ (1 market, 1 SUPER_ADMIN `$2b$12$`, 5 categories, 2 zones, 20 stalls, 13 settings); seed รันซ้ำแล้ว skip — **Prisma 7 `migrate reset` ไม่ seed เอง** จึงใช้ `pnpm db:reset` (reset + seed)
- ⚠️ Prisma บล็อก `migrate reset` เมื่อ AI agent สั่ง — agent ต้องขอความยินยอมผู้ใช้ทุกครั้ง (ใส่ env `PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION`) ส่วน integration test ใช้ `migrate deploy` + `TRUNCATE` จึงไม่ติดเงื่อนไขนี้
- ไฟล์สำคัญ: `apps/api/prisma/schema.prisma`, `prisma/migrations/20261031022514_init`, `prisma/seed.ts` (export `seed()` ให้ test เรียกได้), `apps/api/prisma.config.ts`, `src/prisma/prisma.service.ts`, `packages/shared/src/enums.ts` (+ `ACTIVE_BOOKING_STATUSES`, `PaymentMethod`, `ActorType`, `RoundPhase`), `packages/shared/src/settings.ts` (`SETTING_DEFAULTS` — 1.5 เพิ่ม Zod schema ต่อจากนี้)
- **Prisma 7**: import client จาก `src/generated/prisma/client` (ไม่ใช่ `@prisma/client`), enum จาก `.../enums`; ต้องส่ง `adapter` เสมอ; ไม่ generate อัตโนมัติ → ใช้ `pnpm codegen`; `migrate dev` ใช้ได้เฉพาะ terminal แบบ interactive (agent ใช้ `migrate dev --create-only` แล้ว `migrate deploy`)
- ก่อนสร้าง migration ใหม่ ให้รัน `pnpm prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma` ตรวจ drift — CI ตรวจด้วย `--exit-code`
- `PrismaService` ไม่ `$connect()` ตอน boot (connect ตอน query แรก) ทำให้ unit/e2e test ไม่ต้องมี DB; ถ้าต้องการ fail-fast ให้เพิ่ม DB ping ใน health check (Phase 1.2)
- Enum มี 2 ชุด (Prisma + shared) — `src/prisma/enums.spec.ts` ตรวจว่าตรงกัน แก้ enum ต้องแก้ทั้งสองที่
- Integration test: helper `createTestPrisma()`/`truncateAll()` ใน `test/integration/test-db.ts`; ไฟล์ `*.int-spec.ts`; ใช้ DB `market_booking_test` (กันรันบน DB ที่ชื่อไม่ลงท้าย `_test`) — Phase 4.1 ใช้โครงนี้ทำ concurrent test ได้เลย
- Postgres ของ docker-compose ย้ายไป host port **5433** เพราะเครื่องนี้มี PostgreSQL ของ Windows ฟัง 5432 อยู่ (ทำให้ `P1000` auth failed)
- Phase 3.2: `market_days` unique (market_id, market_date) ครอบคลุมรอบที่ CANCELLED ด้วย — ถ้าต้องให้ใช้วันซ้ำได้หลังยกเลิกรอบ ต้องเปลี่ยนเป็น partial unique _(แก้แล้วใน 3.2: `uq_market_day_date WHERE NOT is_cancelled`)_

### 1.2 Core Infrastructure
**สถานะ:** ✅ DONE · **Dependencies:** 1.1 · **เริ่ม:** 2026-10-31 · **เสร็จ:** 2026-10-31

**Tasks**
- [x] Global prefix `/api/v1`, Swagger ที่ `/api/docs`
- [x] Global exception filter → format `{ error: { code, message, details } }` + `AppException(code)` class
- [x] Response interceptor `{ data, meta }`
- [x] Validation pipe (Zod หรือ class-validator — เลือกหนึ่งและใช้ทั้งระบบ, บันทึกใน Decision Log) _(เลือก Zod ผ่าน nestjs-zod)_
- [x] Logger (pino) + request id, ห้าม log ข้อมูลอ่อนไหว
- [x] Helmet, CORS ตาม env, ThrottlerModule + Redis storage
- [x] `AuditModule`: `AuditService.log({ actorType, actorId, action, entity, before, after })`
- [x] Redis module (ioredis) ใช้ร่วม
- [x] Pagination helper (`page`, `pageSize`, `meta.total`)

**Acceptance Criteria**
- Error ทุกประเภทออก format เดียวกัน, มี unit test ของ filter
- เรียก API เกิน limit ได้ 429 + `RATE_LIMITED`

**Agent Notes:**
- ✅ AC ข้อ 1: error ทุกชนิดออก `{ error: { code, message, details? } }` — unit test `src/common/filters/to-error-response.spec.ts` (AppException, HttpException ของ Nest, throttler, JSON ผิด, Prisma P2002/P2025, error ไม่คาดคิด → 500 ไม่รั่วข้อความ) + integration test ผ่าน HTTP จริงใน `test/integration/app.int-spec.ts`
- ✅ AC ข้อ 2: ยิงเกิน limit → 429 `RATE_LIMITED` (integration test ตั้ง `RATE_LIMIT_PER_MINUTE=5`), ตัวนับอยู่ใน Redis
- ไฟล์สำคัญ (`apps/api/src/`): `common/exceptions/app.exception.ts` + `error-status.ts` (code → HTTP), `common/filters/`, `common/interceptors/response.interceptor.ts`, `common/pipes/zod-validation.pipe.ts`, `common/pagination/paginated-result.ts`, `common/request-context.ts` (AsyncLocalStorage), `common/redact.ts`, `common/logger/logger.module.ts`, `redis/redis.module.ts` (token `REDIS`), `modules/audit/`, `setup-swagger.ts`
- **วิธีใช้ใน Phase ถัดไป**:
  - โยน error: `throw new AppException(ErrorCode.X, 'message', details?)` — status มาจากตารางอัตโนมัติ (ดู Overview §11)
  - DTO: `class XDto extends createZodDto(xSchema) {}` โดย `xSchema` อยู่ใน `packages/shared` (frontend ใช้ตัวเดียวกัน) — pipe global ตรวจให้เอง
  - รายการแบ่งหน้า: รับ `@Query() q: PaginationQueryDto` (จาก `paginationQuerySchema`) → `prisma.x.findMany({ ...toSkipTake(q) })` → `return PaginatedResult.of(items, total, q)`
  - Audit: `auditService.log({ actorType, actorId, action: 'vendor.approve', entity: { type: 'vendor', id }, before, after }, tx)` — ส่ง `tx` เมื่ออยู่ใน `$transaction`; ip/user-agent ใส่ให้อัตโนมัติ; key อ่อนไหวถูก [REDACTED]
  - Rate limit เฉพาะ endpoint (OTP, hold ใน §10.4): `@Throttle({ default: { limit, ttl } })`; ไม่จำกัด: `@SkipThrottle()`
- Controller คืนค่าธรรมดา — interceptor ห่อ `{ data }` ให้; ไฟล์ใช้ `StreamableFile` (ไม่ห่อ)
- 1.3 ต้องเพิ่ม actor (admin/vendor id) ลง request context เพื่อให้ audit/log รู้ว่าใครทำ — ตอนนี้ `RequestContext` มีแค่ requestId/ip/userAgent
- Phase 6: หลัง Nginx ต้องตั้ง `app.set('trust proxy', …)` ไม่งั้น rate limit/audit เห็น IP ของ proxy แทน IP จริง
- Test ที่ boot `AppModule` (เดิม `health.e2e-spec.ts`) ย้ายไปเป็น `test/integration/app.int-spec.ts` เพราะต้องใช้ Redis; `pnpm test` = unit ล้วน
- Helmet CSP default ใช้กับ Swagger UI ได้ (ตรวจใน Chrome แล้ว ไม่มี console error)
- ถ้ารัน `pnpm typecheck`/`test` ระหว่าง `pnpm dev` จะเห็น TS2307 ชั่วคราวใน watch ของ api (เพราะ build:shared ลบ `dist` ก่อน build ใหม่) — หายเองภายในวินาที

### 1.3 Admin Auth & RBAC
**สถานะ:** ✅ DONE · **Dependencies:** 1.2 · **เริ่ม:** 2026-10-31 · **เสร็จ:** 2026-10-31

**Tasks**
- [x] `POST /auth/admin/login` (bcrypt), access token + refresh cookie, `/auth/refresh` (rotation), `/auth/logout`
- [x] Refresh token เก็บ hash ใน Redis/DB เพื่อ revoke ได้
- [x] `JwtAuthGuard` แยก `actorType` (ADMIN/VENDOR), decorator `@CurrentAdmin()`, `@CurrentVendor()`
- [x] `@Roles(...)` + `RolesGuard` ตามตาราง Permission ใน Overview §2
- [x] CRUD `/admin/users` (SUPER_ADMIN เท่านั้น) + audit log
- [x] Lock บัญชีชั่วคราวเมื่อ login ผิด 5 ครั้งใน 15 นาที

**Acceptance Criteria**
- STAFF เรียก `/admin/settings` ได้ 403
- Refresh token เดิมใช้ซ้ำหลัง rotate ไม่ได้

**Agent Notes:**
- ✅ AC ข้อ 1: STAFF/FINANCE เรียก `GET /admin/settings` → 403 `FORBIDDEN`; ADMIN/SUPER_ADMIN → 200 (`test/integration/auth.int-spec.ts`) — route นี้สร้างแบบอ่านอย่างเดียวไว้ก่อน (Phase 1.5 ต่อยอด)
- ✅ AC ข้อ 2: refresh token เดิมใช้ซ้ำหลัง rotate → 401 และ token ใหม่ของ family นั้นถูก revoke ด้วย
- Test: unit 70 (ตาราง permission เทียบ §2, TokenService ปฏิเสธ secret ผิด/alg none/หมดอายุ, AccessGuard), integration 56 (login, ล็อค 5 ครั้ง, rotation, logout หลายเครื่อง, CRUD users + audit, กฎ SUPER_ADMIN)
- ไฟล์สำคัญ: `apps/api/src/modules/auth/` (`auth.service.ts`, `refresh-token.service.ts`, `login-attempt.service.ts`, `token.service.ts`, `decorators.ts`, `guards/`, `refresh-cookie.ts`), `modules/admin-user/`, `modules/market/market.service.ts`, `modules/settings/`, `common/password.ts`, `packages/shared/src/permissions.ts` + `auth.ts`
- **วิธีใช้**: endpoint ทุกตัวต้อง login อัตโนมัติ — เปิดด้วย `@Public()`; admin ใช้ `@RequirePermission(Permission.X)` (class หรือ method) + `@CurrentAdmin()`; vendor ใช้ `@ActorTypes('VENDOR')` + `@CurrentVendor()`; หา market ของ admin ด้วย `MarketService.resolveForAdmin(admin)`
- **Phase 1.4** (vendor login): เรียก `AuthService.issue({ actorType: 'VENDOR', id, marketId })` แล้ว `setRefreshCookie(res, 'VENDOR', …)` — refresh/logout ของ vendor ใช้ได้แล้ว (โหลด vendor จาก DB ใน `AuthService.loadPrincipal`); `LoginAttemptService` ใช้กับ OTP ได้ (scope อื่น)
- **Phase 2.2/2.3** (frontend): เก็บ access token ใน memory, ได้ 401 → `POST /auth/refresh { actorType }` แบบ single-flight (ยิงพร้อมกันหลายแท็บ = token reuse → ถูก logout); `admin.permissions` ใน response login ใช้ซ่อนเมนู
- ข้อจำกัดที่รู้: ปิดบัญชี/เปลี่ยน role แล้ว access token เดิมยังใช้ได้ ≤ 15 นาที (refresh ถูกตัดทันที) — ดู Decision Log
- request context มี `actor` แล้ว (ตั้งโดย JwtAuthGuard) และ log ของ pino-http มี field `actor` (`ADMIN:<id>`)

### 1.4 Vendor Auth (OTP + LINE)
**สถานะ:** ✅ DONE · **Dependencies:** 1.3 · **เริ่ม:** 2026-10-31 · **เสร็จ:** 2026-10-31

**Tasks**
- [x] `SmsProvider` interface + `MockSmsProvider` (log OTP ใน dev เท่านั้น)
- [x] `/auth/otp/request`, `/auth/otp/verify` — OTP hash ใน Redis TTL 5 นาที, จำกัดตาม §10.4, ผิดเกิน 5 ครั้ง OTP ถูกยกเลิก
- [x] `/auth/line` — verify LIFF id token กับ LINE API, ผูก `line_user_id`
- [x] หลัง verify: ถ้ามี vendor แล้ว → login, ถ้ายังไม่มี → คืน `registrationToken` (อายุสั้น) สำหรับไปหน้าสมัคร
- [x] ผูก LINE กับบัญชีที่สมัครด้วยเบอร์ภายหลังได้

**Acceptance Criteria**
- Test: OTP หมดอายุ, OTP ผิด, ขอถี่เกิน → error code ถูกต้อง
- LINE verify ใช้ mock ใน test ได้

**Agent Notes:**
- ✅ AC ข้อ 1: `test/integration/vendor-auth.int-spec.ts` — OTP หมดอายุ → `OTP_EXPIRED`, ผิด → `OTP_INVALID` (`attemptsLeft`), ผิดครบ 5 → รหัสถูกยกเลิก, ใช้ซ้ำ → `OTP_EXPIRED`, ขอซ้ำใน 60 วินาที / เกิน 5 ครั้งต่อชั่วโมง → `RATE_LIMITED` (`retryAfterSeconds`)
- ✅ AC ข้อ 2: LINE ตรวจผ่าน `LINE_ID_TOKEN_VERIFIER` — integration test override เป็น mock; ตัวจริง (`HttpLineIdTokenVerifier`) มี unit test ด้วย fetch จำลอง (token ผิด, คนละ channel, หมดอายุ, LINE ล่ม, ยังไม่ตั้งค่า)
- Test: unit 94, integration 77 ผ่าน; ลองบน dev server แล้ว — OTP ขึ้นใน log ของ api (`[mock SMS → 08…]`)
- ไฟล์สำคัญ: `apps/api/src/modules/auth/` (`otp.service.ts`, `vendor-auth.service.ts`, `vendor-auth.controller.ts`, `registration-token.service.ts`, `line/line-id-token.verifier.ts`), `modules/notify/` (`SMS_PROVIDER`, `MockSmsProvider`), `packages/shared/src/vendor-auth.ts` (`thaiMobilePhoneSchema`, schema ของ OTP/LINE, `VendorAuthResult`)
- **Phase 2.1** (`POST /vendors/register`): รับ `registrationToken` → `RegistrationTokenService.verify()` ได้ `{ marketId, verifiedPhone?, lineUserId?, lineDisplayName? }`
  - มาทาง OTP: ใช้ `verifiedPhone` เป็นเบอร์ (ห้ามรับเบอร์จาก body) และตั้ง `phone_verified_at`
  - มาทาง LINE อย่างเดียว: เบอร์มาจากฟอร์มและ**ยังไม่ได้ยืนยัน** (`phone_verified_at` = null) — ถ้าเบอร์ซ้ำกับบัญชีเดิมต้องตอบให้ผู้ใช้ไปยืนยัน OTP (ซึ่งจะผูก LINE ให้อัตโนมัติ) แทนการสร้างบัญชีใหม่
  - สมัครเสร็จ → `AuthService.issue({ actorType: 'VENDOR', … })` + `setRefreshCookie(res, 'VENDOR', …)`
- **Phase 2.2**: หน้า OTP ใช้ `resendAfter` นับถอยหลัง, แสดง `attemptsLeft`; ปุ่ม LINE ส่ง `liff.getIDToken()` ไป `/auth/line`; ถ้าได้ `REGISTRATION_REQUIRED` จาก LINE แล้วผู้ใช้กรอกเบอร์ ให้ขอ OTP แล้วส่ง `registrationToken` มากับ `/auth/otp/verify`
- **Phase 6/7**: ต้องเลือกผู้ให้บริการ SMS จริง (Open Question) — production ที่ยังเป็น `SMS_PROVIDER=mock` จะตอบ 503 ตอนขอ OTP; ต้องตั้ง `LINE_LOGIN_CHANNEL_ID` (ตอนนี้ว่าง → `/auth/line` ตอบ 503)
- access token มี `aud: access` แล้ว (registration token ใช้ `aud: registration`) — token ที่ออกก่อน Phase 1.4 ใช้ไม่ได้ ต้อง login ใหม่ (dev เท่านั้น)

### 1.5 Settings Module
**สถานะ:** ✅ DONE · **Dependencies:** 1.3 · **เริ่ม:** 2026-10-31 · **เสร็จ:** 2026-10-31

**Tasks**
- [x] `SettingsService.get<K>(marketId, key)` แบบ type-safe (นิยาม schema ของทุก key ใน `packages/shared`)
- [x] Cache ใน Redis + invalidate เมื่อแก้
- [x] `GET/PUT /admin/settings` (ADMIN ขึ้นไป) validate ค่าตาม schema + audit log (before/after)

**Acceptance Criteria**
- แก้ `registration_mode` แล้ว `get()` ได้ค่าใหม่ทันที
- ใส่ค่าผิดประเภท → 400

**Agent Notes:**
- ✅ AC ข้อ 1: `test/integration/settings.int-spec.ts` — อ่าน `registration_mode` (เข้า cache) → แก้เป็น AUTO → `get()` ได้ AUTO ทันที; มี test พิสูจน์ว่าอ่านจาก cache จริง (แก้ DB ตรงแล้วยังได้ค่าเดิม)
- ✅ AC ข้อ 2: PUT ค่าผิดประเภท/enum ผิด/นอกช่วง/key ที่ไม่รู้จัก/body ว่าง → 400 `VALIDATION_ERROR` และไม่มีอะไรถูกบันทึก; STAFF → 403
- Test: unit 109, integration 89 ผ่าน; ลองบน dev server แล้ว (แก้ `hold_minutes` แล้วคืนค่า 10 ตามเดิม)
- ไฟล์สำคัญ: `packages/shared/src/settings.ts` (`settingFields`, `settingsSchema`, `updateSettingsSchema`, `SETTING_DEFAULTS`, `SETTING_KEYS`, `promptPayIdSchema`), `apps/api/src/modules/settings/settings.service.ts`, `settings-admin.controller.ts`
- **วิธีใช้**: inject `SettingsService` (import `SettingsModule` ใน module ที่ใช้) แล้ว `await settings.get(marketId, 'registration_mode')` — ได้ type ตาม key; ไม่ต้องจัดการ cache เอง
- **Phase 2.1**: `registration_mode`, `require_id_card_image`, `require_shop_image` อ่านจาก `SettingsService`; การเปลี่ยน MANUAL → AUTO ไม่แตะผู้ค้า PENDING เดิม (§9.2 ข้อ 4) — ไม่มีโค้ดใน settings ที่ทำเรื่องนี้ ซึ่งถูกต้องแล้ว
- **Phase 2.3**: ฟอร์ม Settings สร้างจาก `settingFields` (Zod) ได้ตรงๆ — ส่ง PUT เฉพาะ key ที่แก้
- ผู้ค้ายังไม่มี endpoint อ่าน settings (เช่น ต้องแนบรูปไหม) — เพิ่มแบบ public เฉพาะ key ที่จำเป็นใน Phase 2.1/2.2

---

## Phase 2 — Member Registration & Approval
**สถานะ:** ✅ DONE · **Dependencies:** Phase 1

### 2.1 Vendor API & File Upload
**สถานะ:** ✅ DONE · **Dependencies:** 1.4, 1.5 · **เริ่ม:** 2026-10-31 · **เสร็จ:** 2026-10-31

**Tasks**
- [x] `StorageModule` (MinIO): presigned PUT/GET, ตรวจ content-type และขนาด ≤ 5MB
- [x] `POST /vendors/register` (ใช้ `registrationToken`) — สถานะตาม `registration_mode`, บังคับรูปตาม setting, บังคับ PDPA consent
- [x] `GET/PATCH /vendors/me` — REJECTED แก้แล้วกลับเป็น PENDING
- [x] `GET /admin/vendors` (filter status, ค้นหาชื่อ/เบอร์, pagination)
- [x] `approve`, `reject` (บังคับเหตุผล), `suspend` (ระบุวันสิ้นสุด), `unsuspend`, `bulk-approve`
- [x] ทุก action ลง audit log; ใส่ hook ว่าง `NotifyService.vendorStatusChanged()` ไว้ให้ Phase 7
- [x] Guard `VendorApprovedGuard` สำหรับ endpoint ที่ต้องอนุมัติแล้ว

**Acceptance Criteria**
- AUTO → สมัครแล้ว `APPROVED`; MANUAL → `PENDING`
- เปลี่ยน AUTO ไม่ทำให้รายการ PENDING เดิมถูกอนุมัติ
- Transition ผิด (เช่น approve คนที่ APPROVED แล้ว) → `INVALID_STATE_TRANSITION`

**Agent Notes:**
- ✅ AC ข้อ 1: AUTO → สมัครแล้ว `APPROVED` (reviewed_by ว่าง = ระบบอนุมัติ); MANUAL → `PENDING`
- ✅ AC ข้อ 2: เปลี่ยนเป็น AUTO แล้วผู้ค้า PENDING เดิมยัง PENDING
- ✅ AC ข้อ 3: approve คนที่ APPROVED แล้ว → 409 `INVALID_STATE_TRANSITION` (`details: { from, action }`); admin สองคนกดพร้อมกัน → สำเร็จ 1, อีกคน 409
- Test: unit 117, integration 126 (`test/integration/vendor.int-spec.ts` อัปโหลดจริงเข้า MinIO — ลายเซ็นกันไฟล์ใหญ่/คนละชนิด, ไฟล์ปลอมถูกลบ, key ของคนอื่นใช้ไม่ได้); ลองบน dev แล้ว (OTP → อัปโหลด → สมัคร, CORS preflight จาก :5173 ผ่าน) — **มีผู้ค้าทดสอบ "ทดสอบ ระบบ" (0897777001) ค้างใน DB dev**
- ไฟล์สำคัญ: `apps/api/src/modules/storage/`, `modules/vendor/` (`vendor.service.ts` สมัคร/โปรไฟล์, `vendor-admin.service.ts`, `vendor-status.service.ts` state machine, `vendor-image.service.ts` ตรวจไฟล์, `vendor-approved.guard.ts`), `modules/notify/notify.service.ts` (hook ว่าง), `packages/shared/src/vendor.ts`
- **วิธีใช้ใน Phase ถัดไป**: endpoint ที่ต้องเป็นผู้ค้าที่อนุมัติแล้ว (จอง, waitlist) ใส่ `@RequireApprovedVendor()` และ module นั้นต้อง `imports: [VendorModule]`; เปลี่ยนสถานะผู้ค้า (No-show Phase 10) ใช้ `VendorStatusService.transition(id, 'suspend', { actorType: 'SYSTEM', data: { suspendedUntil } })`
- **Phase 2.2 (web)**:
  - อัปโหลดรูป: บีบอัด/แปลงเป็น JPEG (HEIC ต้องแปลงก่อน) → `POST /vendors/register/uploads` หรือ `/vendors/me/images` ด้วย `size` = ขนาดจริง → `fetch(url, { method: 'PUT', headers, body: file })` → ส่ง `key`
  - หน้าสถานะใช้ `GET /vendors/me`: `status`, `rejectReason`, `suspendedUntil`
  - ต้องรู้ว่าบังคับแนบรูปไหม (`require_*_image`) — ยังไม่มี endpoint สาธารณะ: เพิ่ม `GET /vendors/register/requirements` (หรือคืนมากับ registrationToken) ตอนทำหน้าสมัคร
  - สมัครซ้ำด้วยเบอร์ที่มีบัญชี → `PHONE_ALREADY_REGISTERED` ให้พาไปหน้า OTP
- **Phase 2.3 (admin)**: badge ใช้ `GET /admin/vendors/counts`; รูปบัตรมากับ `GET /admin/vendors/:id` เป็น presigned URL อายุ 5 นาที (โหลดใหม่เมื่อหมด)
- **Phase 6**: ตั้ง `MINIO_PUBLIC_URL` เป็น URL ที่ browser เข้าถึงได้ และให้ Nginx ส่ง header CORS/Host ของ MinIO ผ่าน; ลบผู้ค้า (PDPA) ต้องลบไฟล์ใต้ `vendors/<id>/` และ `vendors/reg-…` ด้วย (ยังไม่ได้ทำ — Phase 11)
- ไฟล์ที่อัปโหลดแล้วแต่ไม่ได้ใช้ (ยกเลิกสมัคร/เปลี่ยนรูป) ยังค้างใน bucket — ควรเพิ่ม lifecycle rule ลบ `vendors/reg-*` ที่เก่ากว่า 1 วัน (Phase 6)

### 2.2 Vendor Web: สมัครสมาชิก
**สถานะ:** ✅ DONE · **Dependencies:** 2.1 · **เริ่ม:** 2026-10-31 · **เสร็จ:** 2026-10-31

**Tasks**
- [x] Layout mobile-first, router, auth context, axios interceptor (refresh อัตโนมัติ)
- [x] หน้า Login: ปุ่ม LINE (LIFF SDK) + เบอร์โทร/OTP (นับถอยหลังขอใหม่)
- [x] หน้าสมัคร: React Hook Form + Zod schema จาก `shared`, อัปโหลดรูปผ่าน presigned URL พร้อม preview/บีบอัดรูป, checkbox PDPA + ลิงก์นโยบาย
- [x] หน้าสถานะ: รออนุมัติ / ถูกปฏิเสธ (แสดงเหตุผล + ปุ่มแก้ไข) / ถูกระงับ (แสดงวันสิ้นสุด)
- [x] หน้าโปรไฟล์แก้ไขข้อมูล
- [x] Error message ภาษาไทยตาม error code

**Acceptance Criteria**
- ใช้งานครบ flow ได้บนจอ 360px
- E2E (Playwright): OTP (mock) → สมัคร → เห็นหน้ารออนุมัติ

**Agent Notes:**
- ✅ AC ข้อ 1: ทุก E2E รันที่ viewport 360×740 และตรวจว่าไม่มี scroll แนวนอน; ดูภาพหน้าจอ login / OTP / ฟอร์มสมัคร (พร้อม error) ที่ 360px แล้ว
- ✅ AC ข้อ 2: `e2e/tests/registration.spec.ts` — OTP (mock) → สมัคร (แนบรูป 2000×1200 ที่ถูกย่อเป็น JPEG ก่อนอัปโหลด) → เห็น "รอการอนุมัติ" → รีเฟรชแล้วยัง login; เพิ่ม: OTP ผิดเห็นข้อความไทย + จำนวนครั้งที่เหลือ, เบอร์ผิดรูปแบบ, ถูกปฏิเสธ→เห็นเหตุผล→แก้→กลับเป็นรออนุมัติ→อนุมัติ, ออกจากระบบ (5/5 ผ่าน)
- E2E จับ bug จริงได้ 1 ตัว: เลือก "— เลือกประเภทสินค้า —" ส่ง `''` แล้วไม่ผ่าน uuid → ส่งฟอร์มไม่ได้ (แก้แล้วทั้งหน้าสมัครและโปรไฟล์)
- ไฟล์สำคัญ (`apps/web/src/`): `lib/api-client.ts` (refresh อัตโนมัติ single-flight), `lib/session.ts` (token ใน memory), `lib/errors.ts` (ข้อความไทย + ใส่ error รายฟิลด์ลงฟอร์ม), `lib/image.ts` (ย่อรูป), `lib/registration-draft.ts`, `features/auth/` (AuthBootstrap/RequireAuth, LIFF), `components/ui.tsx`, `components/ImageUpload.tsx`, `pages/` (Login, Register, Home=สถานะ, Profile, Privacy); `packages/shared/src/error-messages.th.ts`; `e2e/`
- API เพิ่ม: `POST /vendors/register/options`, `GET /vendors/me/options` (ต้องแนบรูปไหม + ประเภทสินค้า); `MockSmsProvider` เขียนข้อความล่าสุดลง Redis (dev/test เท่านั้น) ให้ E2E อ่าน OTP
- ข้อความ validation รายฟิลด์ใน shared schema เปลี่ยนเป็นภาษาไทย (ดู Decision Log)
- **ยังไม่ได้ทดสอบกับ LINE จริง** — ปุ่ม LINE ซ่อนจนกว่าจะตั้ง `VITE_LINE_LIFF_ID` (และ `LINE_LOGIN_CHANNEL_ID` ฝั่ง API); ต้องทดสอบบนมือถือจริงใน LINE app ก่อนเปิดใช้ (Phase 6)
- **นโยบายความเป็นส่วนตัว** (`/privacy`) เป็นฉบับร่าง — เจ้าของตลาดต้องตรวจ/ให้ฝ่ายกฎหมายรับรอง
- Bundle web ~643 KB (gzip ~198 KB) — แยก route ด้วย lazy import ได้เมื่อมีหน้าจองใน Phase 4
- **Phase 2.3 (admin)**: ใช้ `errorMessageTh` / `ERROR_MESSAGES_TH` จาก shared ได้เลย; refresh ของ admin ส่ง `{ actorType: 'ADMIN' }`; โครง api-client/session ลอกจาก web ได้ (เปลี่ยน actorType); E2E ของ admin เพิ่มใน `e2e/` (เพิ่ม webServer ของ admin)

### 2.3 Admin Web: Shell + อนุมัติสมาชิก + Settings
**สถานะ:** ✅ DONE · **Dependencies:** 2.1 · **เริ่ม:** 2026-10-31 · **เสร็จ:** 2026-10-31

**Tasks**
- [x] Login, layout (sidebar/topbar), เมนูซ่อนตาม role, หน้า 403
- [x] หน้ารายการผู้ค้า (MUI DataGrid, tab ตามสถานะ, ค้นหา, badge จำนวนรออนุมัติ)
- [x] Drawer รายละเอียด: ข้อมูล + รูป (presigned GET) + ปุ่ม อนุมัติ/ปฏิเสธ/ระงับ + dialog ใส่เหตุผล
- [x] เลือกหลายรายการ → อนุมัติพร้อมกัน
- [x] หน้า Settings: ฟอร์มจาก schema (สวิตช์ AUTO/MANUAL อยู่บนสุด)
- [x] หน้า Admin users (SUPER_ADMIN)

**Acceptance Criteria**
- E2E: admin login → อนุมัติผู้ค้า PENDING → ผู้ค้า refresh แล้วเป็น APPROVED

**Agent Notes:**
- ✅ AC: `e2e/tests/admin.spec.ts` — admin login → เปิดผู้ค้า PENDING ใน drawer → อนุมัติ → ผู้ค้ารีเฟรชแล้วเห็น "บัญชีได้รับการอนุมัติแล้ว"; เพิ่ม: ไม่อนุมัติพร้อมเหตุผล (ผู้ค้าเห็นเหตุผล), เลือกหลายรายการแล้วอนุมัติ, เปลี่ยน AUTO แล้วผู้ค้าใหม่อนุมัติทันที, ค่าผิดในฟอร์มตั้งค่าไม่ถูกบันทึก, SUPER_ADMIN เพิ่ม STAFF → STAFF ไม่เห็นเมนูตั้งค่า/ผู้ดูแล และ /settings แสดง 403, รหัสผิดเห็นข้อความไทย (admin 7 + ผู้ค้า 5 = 12 ผ่าน)
- E2E จับ bug จริงได้ 2 ตัว (แก้แล้ว): หน้า Settings พังเพราะ `setValueAs` ของ PromptPay เรียก `.trim()` กับค่า `null`; "เลือกทั้งหมด" ของ DataGrid (v8+) คืน `{ type: 'exclude' }` ทำให้นับได้ 0 รายการ — และดูภาพหน้าจอแล้วเจอ drawer รายละเอียดผู้ค้าโดน AppBar ทับ (แก้ zIndex)
- ไฟล์สำคัญ (`apps/admin/src/`): `lib/session.ts` (+ `useCan`), `lib/api-client.ts` (`restoreSession`), `lib/nav.tsx` (เมนู + permission), `components/AppLayout.tsx`, `components/guards.tsx` (`Protected permission=`), `components/VendorDrawer.tsx`, `pages/` (Vendors, Settings, AdminUsers, Login, Home, Forbidden); API: `GET /admin/me`
- **เพิ่มหน้าใหม่ใน Phase ถัดไป**: เพิ่มรายการใน `lib/nav.tsx` (พร้อม `permission`) + route `<Protected permission={Permission.X}>` ใน `App.tsx`
- badge รออนุมัติโหลดใหม่ทุก 60 วินาที — Phase 4.3 เปลี่ยนเป็น realtime (`vendor:registered`)
- "อนุมัติทั้งหมดที่ค้าง" ใช้ `window.confirm` (ยังไม่มี E2E ครอบ) — เปลี่ยนเป็น MUI Dialog ได้ถ้าต้องการหน้าตาเดียวกัน
- หน้าแรกของ admin ยังเป็นหน้าทักทาย — Dashboard จริงอยู่ Phase 8; FINANCE ยังไม่มีเมนู (ตรวจสลิปมาใน Phase 5)

---

## Phase 3 — Market Setup
**สถานะ:** ✅ DONE · **Dependencies:** Phase 2

### 3.1 Zones, Categories, Stalls
**สถานะ:** ✅ DONE · **Dependencies:** 2.3 · **เริ่ม:** 2026-10-31 · **เสร็จ:** 2026-10-31

**Tasks**
- [x] CRUD API `/admin/product-categories`, `/admin/zones`, `/admin/stalls` + audit log
- [x] สร้างล็อคทีละหลายรายการ (prefix + ช่วงเลข เช่น A1–A20, ราคา/ขนาดเดียวกัน)
- [x] ห้ามลบล็อคที่มี booking → ใช้ `is_active = false`
- [x] `GET /market-days/:id/stalls` เวอร์ชันแรก (ยังไม่รวมสถานะ booking) สำหรับวาดผัง
- [x] Admin UI: ตารางจัดการโซน/ประเภท/ล็อค, bulk create dialog
- [x] Component `StallMap` (SVG) ใน `packages/shared` หรือ copy ให้ทั้ง web/admin — วาดจาก pos/shape, สีตามสถานะ, zoom/pan บนมือถือ
- [x] Admin แก้ pos_x/pos_y ผ่านฟอร์มตัวเลขไปก่อน (Map Editor อยู่ Phase 9.1)

**Acceptance Criteria**
- Seed 20 ล็อคแสดงบน `StallMap` ถูกตำแหน่งทั้ง web และ admin

**Agent Notes:**
- ✅ AC: E2E `expectSeedStallsOnMap` ตรวจ `<rect x y width>` ของล็อค seed ทั้ง 20 ตัว (A1–A10 y=20, B1–B10 y=140, x = 20 + i·70) ทั้งหน้าผู้ค้า `/map` (จอ 360px, `market-map.spec.ts`) และหน้า admin `/stalls` (`admin-market.spec.ts`)
- API (`apps/api/src/modules/market-setup/`): CRUD `/admin/product-categories`, `/admin/zones`, `/admin/stalls` + `POST /admin/stalls/bulk` (สิทธิ์ `MARKET_LAYOUT_MANAGE`, audit ทุก action: `product_category.*`, `zone.*`, `stall.create/update/delete/bulk_create`); ผู้ค้า: `GET /market/layout` (เพิ่ม — Decision Log) และ `GET /market-days/:id/stalls` (ราคา/ปิดล็อคตาม `stall_day_overrides`, สงวนไว้/ปิดเฉพาะวัน/วันขายยกเลิก = UNAVAILABLE, ล็อค `is_active=false` ไม่ส่ง)
- error ใหม่: `STALL_CODE_TAKEN` (`details.codes`), `RESOURCE_IN_USE` — ลบล็อคที่มี booking/waitlist ไม่ได้ (ให้ PATCH `isActive:false`), ลบโซนที่มีล็อคไม่ได้, ลบประเภทที่ผู้ค้าใช้ไม่ได้ (ลบได้แล้วเอาออกจาก `allowed_category_ids` ของทุกโซน)
- bulk create: `bulkStallCodes()` ใน shared ใช้ทั้ง API และตัวอย่างใน dialog; วางเป็นตาราง `columns` คอลัมน์ ระยะ `gap`; ไม่ระบุ `originY` = วางต่อใต้ล็อคล่างสุด + 40px
- `packages/stall-map`: `StallMap` (SVG, ซูม/เลื่อนผ่าน viewBox: ลาก, pinch, ล้อเมาส์, ปุ่ม +/−/ดูทั้งผัง; แตะ/Enter เลือกล็อค; `data-stall-code` ไว้ให้ E2E) + `StallMapLegend`; สถานะ `AVAILABLE|HELD|BOOKED|MINE|UNAVAILABLE|INACTIVE` เตรียมไว้ให้ Phase 4 แล้ว — 4.4 แค่ map สถานะจาก API
- หน้า admin: `/stalls` (tab ผัง/ตาราง, กรองโซน, คลิกล็อคบนผังเพื่อแก้, dialog เพิ่ม/แก้/ลบ/สร้างหลายล็อค) และ `/zones` (โซน + สี + ประเภทที่ขายได้, ประเภทสินค้า); หน้าผู้ค้า: `/map` + ปุ่ม "ดูผังตลาด" บนหน้าแรกเมื่ออนุมัติแล้ว
- E2E เจอ: rate limit login/OTP (10 ครั้ง/นาทีต่อ IP) เต็มเมื่อ test เพิ่ม → env `RATE_LIMIT_DISABLED=true` เฉพาะ E2E (schema ห้ามใน production); `NumberField` ต้อง forwardRef ไป `inputRef` ไม่งั้น react-hook-form อ่านค่าไม่ได้; ดูภาพหน้าจอแล้วผังผู้ค้ามีที่ว่างมาก → ผังสูงตามสัดส่วน
- ทดสอบ: unit 122 (+ stall rules, env), integration 156 (+29 `market-setup.int-spec.ts`), E2E 18 (+6)
- ยังไม่ทำ (ตามแผน): แก้ตำแหน่งด้วยการลากบนผัง (9.1), `stall_day_overrides` API (3.2), สถานะจองบนผัง (4.1/4.4)

### 3.2 Booking Rounds & Market Days
**สถานะ:** ✅ DONE · **Dependencies:** 3.1 · **เริ่ม:** 2026-10-31 · **เสร็จ:** 2026-10-31

**Tasks**
- [x] CRUD `/admin/rounds`, `/admin/rounds/:id/market-days`, publish/cancel
- [x] Validation ตาม Overview §9.3 (เวลา, วันซ้ำ, แก้ open_at หลังเปิดไม่ได้)
- [x] `RoundService.getPhase(round, now)` → `UPCOMING | OPEN | CLOSED` + `assertRoundOpen(marketDayId)` (unit test ครอบคลุมขอบเวลา)
- [x] `stall_day_overrides` API (ปิดล็อค/เปลี่ยนราคาเฉพาะวัน)
- [x] `GET /rounds/current` สำหรับผู้ค้า
- [x] Admin UI: ฟอร์มรอบ + ปฏิทินเลือกวันขาย + ตัวช่วย "ทุกเสาร์-อาทิตย์ของเดือน"
- [x] Vendor UI: การ์ดรอบที่กำลังจะเปิด + Countdown (ใช้ offset จากเวลา server)

**Acceptance Criteria**
- เวลา server ก่อน `open_at` 1 วินาที → `ROUND_NOT_OPEN`; ที่ `open_at` พอดี → OPEN
- Countdown ผู้ค้าคลาดจากเวลา server ไม่เกิน 1 วินาทีแม้นาฬิกาเครื่องผิด

**Agent Notes:**
- ✅ AC ข้อ 1: unit `round-rules.spec.ts` (`roundPhase` ก่อน open_at 1 ms/1 วินาที = UPCOMING, open_at พอดี = OPEN, close_at พอดี = CLOSED; `assertRoundOpen` กับ mock DB) + integration `rounds.int-spec.ts` (`assertRoundOpen(dayId, { now })` กับ DB จริง: ก่อน open_at 1 วินาที → `ROUND_NOT_OPEN`, open_at พอดี → ผ่าน)
- ✅ AC ข้อ 2: E2E `round-countdown.spec.ts` (จอ 360px) ตั้งนาฬิกาเบราว์เซอร์เร็วไป 3 ชม. (`page.clock.install`) → ค่าที่ Countdown แสดงคลาดจากเวลา server ≤ 1 วินาที (อ่าน 3 ครั้ง) แล้วเปลี่ยนเป็น "เปิดจองแล้ว" เมื่อถึง open_at
- API (`apps/api/src/modules/round/`, สิทธิ์ `ROUNDS_MANAGE`): `RoundService` (CRUD, publish/cancel แบบ `UPDATE … WHERE status = เดิม`, `getPhase`, `assertRoundOpen(marketDayId, { marketId?, now?, db? })` — **4.1 เรียกใน transaction ของ hold ได้เลย** คืน day + round รวม `maxStallsPerVendor`), `MarketDayService` (เพิ่ม/ยกเลิก/คืนสถานะ/ลบวัน, override รายวัน); ผู้ค้า `GET /rounds/current`; audit: `round.*`, `market_day.*`, `stall_day_override.set/delete`
- migration `20261031120000_market_day_partial_unique`: unique วันขายไม่นับวันที่ยกเลิก — ยกเลิกรอบแล้วสร้างวันเดิมในรอบใหม่ได้; P2002 → `MARKET_DATE_TAKEN`
- error ใหม่: `MARKET_DATE_TAKEN` (`details.dates`), `ROUND_ALREADY_OPENED`; ผิดสถานะ → `INVALID_STATE_TRANSITION`; validation ธุรกิจ (close_at เกินวันแรก, วันที่ผ่านมาแล้ว, publish ไม่มีวัน) ส่งเป็น `VALIDATION_ERROR` รายฟิลด์ (`closeAt`, `openAt`, `dates`, `marketDays`) ให้หน้า admin แสดงได้ตรงจุด
- เวลาตลาด: `common/zoned-date.ts` (`zonedDayStart`, `zonedDate`) ใช้ `markets.timezone` ผ่าน Intl (รองรับ DST)
- shared `round.ts`: schema, `roundPhase`, `weekendDatesOfMonth`, `estimateClockOffset`, `formatIsoDateTh` — ใช้ทั้ง API/admin/web
- หน้า admin: `/rounds` (รายการ + สร้าง), `/rounds/:id` (แก้/เผยแพร่/ยกเลิก/ลบ + ตารางวันขาย + ปฏิทินเลือกหลายวัน + "เลือกเสาร์-อาทิตย์ทั้งเดือน"), `/rounds/:id/days/:dayId` (ผัง StallMap คลิกล็อคเพื่อปิด/ตั้งราคาเฉพาะวัน); ช่องเวลาเป็นเวลาไทยเสมอ และแก้รอบส่งเฉพาะช่องที่เปลี่ยน (datetime-local ละเอียดแค่นาที ส่งค่าเดิมกลับจะกลายเป็น "แก้ open_at")
- หน้าผู้ค้า: การ์ดรอบบนหน้าแรก (`components/RoundCard.tsx`) + `lib/server-clock.ts` (`useNow` timer เดียว 250 ms, `useCountdown`, `formatCountdown`) — **4.4 ใช้ `useCountdown` + `clockOffsetMs` จาก `useCurrentRound` นับเวลา hold ได้เลย**
- E2E: global setup ยกเลิกรอบที่ค้างจากรอบก่อน (DB ของ E2E ไม่ถูกล้าง); `admin-rounds.spec.ts` ครบ flow สร้าง → ปฏิทิน → เผยแพร่ → ปิด A1/ราคา B1 → ยกเลิกรอบ; STAFF ไม่เห็นเมนู "รอบการจอง"
- เจอระหว่างทดสอบ: label "ปิดจอง" เป็น substring ของ "เปิดจอง" (E2E ต้องใช้ `exact`); ดูภาพหน้าจอแล้วรอบที่ยกเลิกแสดง "ยังไม่มีวันขาย" ทำให้เข้าใจผิด → แสดง "—"
- ทดสอบ: unit 134 (+12), integration 176 (+20), E2E 20 (+2)
- **ต้องทำต่อใน Phase 4**: ยกเลิกรอบ/ยกเลิกวันขาย/ปิดล็อครายวันยังไม่แตะการจองที่มีอยู่ (ตอนนี้ยังไม่มีการจอง) — 4.1/4.5 ต้องตัดสินใจเรื่องการจองที่ active + แจ้งผู้ค้า; `/market-days/:id/stalls` ยังเปิดดูได้แม้รอบเป็น DRAFT (ไม่มีข้อมูลอ่อนไหว); `round:changed` realtime อยู่ 4.3; แจ้งเตือนก่อนเปิดรอบอยู่ Phase 7

---

## Phase 4 — Realtime Booking ⭐ (ส่วนสำคัญที่สุด)
**สถานะ:** ⬜ TODO · **Dependencies:** Phase 3

### 4.1 Booking Core API + Concurrency
**สถานะ:** ⬜ TODO · **Dependencies:** 3.2 · **เริ่ม:** – · **เสร็จ:** –

**Tasks**
- [ ] `BookingStateService.transition(bookingId, from[], to, ctx)` — ตาราง transition ตาม Overview §8.2, `UPDATE ... WHERE status IN (from)` ตรวจ rowCount
- [ ] `POST /bookings/hold` ตามขั้นตอน §9.4 ทั้ง 5 ข้อ ใน Transaction เดียว พร้อม `pg_advisory_xact_lock` ต่อ (vendor, market_day)
- [ ] จับ Prisma `P2002` → `STALL_TAKEN` (409)
- [ ] Snapshot ราคา (`amount`) รวม override
- [ ] `POST /bookings/:id/confirm` → `CONFIRMED` หรือ `PENDING_PAYMENT` ตาม `payment_required` (ตั้ง `payment_due_at`)
- [ ] `POST /bookings/:id/cancel` (ตรวจ `cancel_before_hours`) และ `/admin/bookings/:id/cancel`
- [ ] `GET /bookings/me`
- [ ] `GET /market-days/:id/stalls` รวมสถานะ: AVAILABLE/HOLD/BOOKED/CLOSED + `mine` (ห้ามส่งข้อมูลผู้ค้าคนอื่น)
- [ ] Event emitter ภายใน (`booking.changed`) ให้ 4.2/4.3 subscribe — Service ไม่เรียก Gateway ตรง
- [ ] Unit + integration test ทุก error code

**Acceptance Criteria**
- Integration test: 50 request พร้อมกันจองล็อคเดียว → สำเร็จ 1, ที่เหลือ `STALL_TAKEN`
- Vendor quota 1 ยิง hold 2 ล็อคพร้อมกัน → สำเร็จ 1, อีกอัน `QUOTA_EXCEEDED`

**Agent Notes:** –

### 4.2 Expiry Worker (BullMQ)
**สถานะ:** ⬜ TODO · **Dependencies:** 4.1 · **เริ่ม:** – · **เสร็จ:** –

**Tasks**
- [ ] Queue `booking-expiry`: delayed job ตอน hold (jobId = bookingId) และตอนเข้า PENDING_PAYMENT
- [ ] Processor: transition `HOLD|PENDING_PAYMENT → EXPIRED` เฉพาะถ้ายังหมดเวลาจริง (idempotent)
- [ ] Sweeper cron ทุก 1 นาที: กวาด booking ที่หมดเวลาแต่ยังค้าง (กรณี Redis หาย/restart)
- [ ] ลบ job เมื่อ confirm/cancel ก่อนหมดเวลา
- [ ] Emit `booking.changed` เมื่อ expire

**Acceptance Criteria**
- ตั้ง `hold_minutes` = 1 ใน test → ล็อคว่างหลัง 1 นาที (± sweeper interval)
- Confirm ที่วินาทีเดียวกับ expire → ผลลัพธ์เป็นอย่างใดอย่างหนึ่ง ไม่มีสถานะเพี้ยน

**Agent Notes:** –

### 4.3 Realtime Gateway (Socket.IO)
**สถานะ:** ⬜ TODO · **Dependencies:** 4.1 · **เริ่ม:** – · **เสร็จ:** –

**Tasks**
- [ ] Namespace `/booking`, auth JWT ใน handshake, Redis adapter
- [ ] Events และ rooms ตาม Overview §10 (ชื่อ event จาก `packages/shared`)
- [ ] Subscribe `booking.changed` → emit `stall:updated` (room `md:`) และ `booking:changed` (room `vendor:`)
- [ ] ส่ง `server:time` ตอน connect
- [ ] จำกัดจำนวน room ที่ join ต่อ socket, ตรวจว่า marketDay มีจริง

**Acceptance Criteria**
- เปิด 2 browser: A hold ล็อค → B เห็นสีเปลี่ยนภายใน 1 วินาที
- รัน API 2 instance หลัง Nginx → event ข้าม instance ได้

**Agent Notes:** –

### 4.4 Vendor Web: หน้าผังและจองล็อค
**สถานะ:** ⬜ TODO · **Dependencies:** 4.2, 4.3 · **เริ่ม:** – · **เสร็จ:** –

**Tasks**
- [ ] `useMarketDaySocket(marketDayId)`: join/leave, อัปเดต TanStack Query cache จาก event, refetch เมื่อ reconnect/visibilitychange
- [ ] หน้าเลือกวันขาย → หน้าผัง (StallMap) + legend สี + filter โซน
- [ ] แตะล็อค → bottom sheet: รหัส, ขนาด, ราคา, โซน → ปุ่ม "จอง"
- [ ] หลัง hold: แถบนับถอยหลัง + ปุ่ม "ยืนยัน" / "ยกเลิก"; หมดเวลา → แจ้งและคืนสถานะ
- [ ] จัดการ error: `STALL_TAKEN` (แจ้ง + highlight ล็อคที่ว่างใกล้เคียง), `QUOTA_EXCEEDED`, `ROUND_NOT_OPEN`
- [ ] ก่อนรอบเปิด: ผังดูได้แต่กดไม่ได้ + Countdown; เปิดปุ๊บปุ่มใช้ได้ทันทีโดยไม่ต้อง refresh
- [ ] หน้า "การจองของฉัน"
- [ ] Optimistic UI เฉพาะการ hold (rollback เมื่อ error)

**Acceptance Criteria**
- E2E: 2 vendor แย่งล็อคเดียว → คนหนึ่งได้, อีกคนเห็นข้อความ STALL_TAKEN และผังอัปเดต
- ปิด Wi-Fi 10 วินาทีแล้วเปิด → ผังถูกต้องโดยไม่ต้อง refresh

**Agent Notes:** –

### 4.5 Admin Web: จัดการการจอง
**สถานะ:** ⬜ TODO · **Dependencies:** 4.3 · **เริ่ม:** – · **เสร็จ:** –

**Tasks**
- [ ] หน้าผังวันขายแบบ realtime (เห็นชื่อผู้ค้าในล็อค — เฉพาะ admin)
- [ ] ตารางการจอง filter ตามวัน/สถานะ/ผู้ค้า
- [ ] ยกเลิกแทน (บังคับเหตุผล), จองแทนผู้ค้า (`POST /admin/bookings` — bypass รอบ/โควต้าได้ แต่ไม่ bypass unique index)
- [ ] Export รายชื่อผู้ค้าต่อวันขาย (xlsx)

**Acceptance Criteria**
- Admin ยกเลิก → ผู้ค้าและผู้ดูผังคนอื่นเห็นทันที, มี audit log

**Agent Notes:** –

### 4.6 Concurrency & Load Test
**สถานะ:** ⬜ TODO · **Dependencies:** 4.4 · **เริ่ม:** – · **เสร็จ:** –

**Tasks**
- [ ] Script seed: 1,000 vendor APPROVED + 300 ล็อค + รอบที่เปิดอยู่
- [ ] k6: 500 virtual users เชื่อม socket + ยิง hold พร้อมกันตอนเปิดรอบ
- [ ] SQL ตรวจหลังทดสอบ: ไม่มี active booking ซ้ำ, ไม่มีใครเกินโควต้า
- [ ] บันทึกผล p95 latency, error rate, CPU/RAM ใน `docs/load-test-results.md`
- [ ] แก้ bottleneck ที่พบ (index, connection pool, emit batching)

**Acceptance Criteria**
- ผ่านเป้าหมาย Non-functional ใน Overview §13

**Agent Notes:** –

---

## Phase 5 — Payment
**สถานะ:** ⬜ TODO · **Dependencies:** Phase 4

### 5.1 Payment API + PromptPay QR
**สถานะ:** ⬜ TODO · **Dependencies:** 4.6 · **เริ่ม:** – · **เสร็จ:** –

**Tasks**
- [ ] สร้าง PromptPay payload (EMVCo, library `promptpay-qr`) จาก `promptpay_id` + amount
- [ ] `POST /bookings/:id/payments` (presigned upload สลิป) → `PENDING_VERIFY`, ยกเลิก expiry job ระหว่างรอตรวจ
- [ ] `GET /admin/payments?status=PENDING`, `approve` → `CONFIRMED` + สร้าง `checkin_token`, `reject` (เหตุผล) → `PENDING_PAYMENT` + ตั้ง `payment_due_at` ใหม่
- [ ] บันทึกรับเงินสด (`CASH`) โดย Admin
- [ ] Interface `SlipVerifier` (ทำ implementation จริงภายหลัง)

**Acceptance Criteria**
- สลิปถูกปฏิเสธแล้วส่งใหม่ได้, ประวัติ payment ครบทุกครั้ง
- Booking ที่ `PENDING_VERIFY` ไม่หมดอายุระหว่างรอตรวจ

**Agent Notes:** –

### 5.2 Vendor & Admin Payment UI
**สถานะ:** ⬜ TODO · **Dependencies:** 5.1 · **เริ่ม:** – · **เสร็จ:** –

**Tasks**
- [ ] Vendor: หน้าชำระเงิน (QR + ปุ่มบันทึกรูป QR + เวลาที่เหลือ + อัปโหลดสลิป), สถานะการชำระใน "การจองของฉัน"
- [ ] Admin: คิวตรวจสลิป (รูปสลิปขนาดใหญ่คู่ยอดที่ต้องจ่าย, ปุ่มอนุมัติ/ปฏิเสธ, คีย์ลัด)
- [ ] Badge realtime เมื่อมีสลิปใหม่ (`payment:submitted`)

**Acceptance Criteria**
- E2E: จอง → ชำระ → admin อนุมัติ → ล็อคเป็น BOOKED และผู้ค้าเห็นสถานะ CONFIRMED

**Agent Notes:** –

---

## Phase 6 — MVP Deployment 🚀
**สถานะ:** ⬜ TODO · **Dependencies:** Phase 5 · **เริ่ม:** – · **เสร็จ:** –

**Tasks**
- [ ] Dockerfile multi-stage สำหรับ api, web, admin (static ผ่าน Nginx)
- [ ] `docker-compose.prod.yml` + Nginx (SSL Let's Encrypt, `/api`, `/socket.io` upgrade, gzip, cache static)
- [ ] รัน `prisma migrate deploy` ตอน start, healthcheck ทุก service
- [ ] Backup: pg_dump รายวัน เก็บ 14 วัน + script restore ที่ทดสอบแล้ว
- [ ] Log rotation, uptime monitoring (เช่น Uptime Kuma)
- [ ] ตั้งค่า LINE LIFF/Login สำหรับโดเมนจริง
- [ ] `docs/runbook.md`: deploy, rollback, restore, เพิ่ม admin, เปลี่ยน secret

**Acceptance Criteria**
- Deploy บน VPS ใหม่ได้ตาม runbook
- ทดสอบ restore backup สำเร็จ

**Agent Notes:** –

---

## Phase 7 — Notifications (LINE OA / SMS)
**สถานะ:** ⬜ TODO · **Dependencies:** Phase 6 · **เริ่ม:** – · **เสร็จ:** –

**Tasks**
- [ ] Queue `notification` + retry/backoff + `notification_logs`
- [ ] `LineMessagingProvider` (push message / Flex), `SmsProvider` จริง (ตามผู้ให้บริการที่เลือก)
- [ ] เลือกช่องทาง: มี `line_user_id` → LINE, ไม่มี → SMS
- [ ] Templates: ผลอนุมัติ/ปฏิเสธ/ระงับ, รอบจะเปิดใน X นาที, จองสำเร็จ, ใกล้หมดเวลาชำระ, สลิปถูกปฏิเสธ, การจองถูกยกเลิก
- [ ] แจ้ง Admin เมื่อมีสมาชิกใหม่ (MANUAL) / สลิปใหม่ (LINE group ถ้าตั้งค่า)
- [ ] Scheduled job: แจ้งก่อนรอบเปิดตาม `notify_before_round_open_minutes`

**Acceptance Criteria**
- Provider ล่มไม่กระทบ flow หลัก (retry ภายหลัง), มี log ทุกข้อความ

**Agent Notes:** –

---

## Phase 8 — Reports & Dashboard
**สถานะ:** ⬜ TODO · **Dependencies:** Phase 6 · **เริ่ม:** – · **เสร็จ:** –

**Tasks**
- [ ] Dashboard: ผู้ค้ารออนุมัติ, สลิปรอตรวจ, อัตราการจองรอบปัจจุบัน, รายได้รอบนี้
- [ ] รายงานรายได้ (ตามวัน/รอบ/โซน), Occupancy (ตามวัน/โซน), ผู้ค้า Top / No-show
- [ ] Export xlsx/csv (mask เบอร์โทรตามสิทธิ์)
- [ ] หน้า Audit Log (filter actor/action/วันที่)
- [ ] ตรวจ query plan รายงานหลัก เพิ่ม index ที่จำเป็น

**Acceptance Criteria**
- รายงานบนข้อมูล 1 ปี (จำลอง) ตอบ < 2 วินาที

**Agent Notes:** –

---

## Phase 9 — Advanced Booking
**สถานะ:** ⬜ TODO · **Dependencies:** Phase 7

### 9.1 Map Editor (ลากวาง)
**สถานะ:** ⬜ TODO · **Dependencies:** 7 · **เริ่ม:** – · **เสร็จ:** –

**Tasks**
- [ ] react-konva editor: ลาก/ย่อ-ขยาย/หมุนล็อค, snap to grid, เลือกหลายอัน, copy/paste, undo/redo
- [ ] รูปพื้นหลัง (แปลนตลาด) + วาดทางเดิน/สัญลักษณ์ (ห้องน้ำ, ทางเข้า)
- [ ] `PUT /admin/stalls/layout` บันทึกเป็นชุดใน transaction
- [ ] `StallMap` ฝั่ง vendor แสดง background และสัญลักษณ์ได้

**Agent Notes:** –

### 9.2 Waitlist
**สถานะ:** ⬜ TODO · **Dependencies:** 7 · **เริ่ม:** – · **เสร็จ:** –

**Tasks**
- [ ] API เข้า/ออกคิว (เจาะจงล็อค หรือทั้งโซน)
- [ ] เมื่อ booking → EXPIRED/CANCELLED: หา waitlist ลำดับแรก → สร้าง HOLD ให้อัตโนมัติ (`waitlist_claim_minutes`) → แจ้ง `waitlist:offer` + LINE
- [ ] ไม่ยืนยันภายในเวลา → ส่งต่อคิวถัดไป (ตรวจโควต้าของผู้รับสิทธิ์ด้วย)
- [ ] UI ฝั่ง vendor และ admin

**Acceptance Criteria**
- Test: ยกเลิก 1 ล็อคที่มีคิว 3 คน ไม่มีใครยืนยัน → สิทธิ์วนครบทั้ง 3 แล้วล็อคกลับเป็น AVAILABLE

**Agent Notes:** –

### 9.3 Announcements
**สถานะ:** ⬜ TODO · **Dependencies:** 7 · **เริ่ม:** – · **เสร็จ:** –

**Tasks**
- [ ] CRUD ประกาศ (ช่วงเวลาแสดง, ปักหมุด), แสดงหน้าแรก vendor, option ส่ง LINE broadcast

**Agent Notes:** –

---

## Phase 10 — Check-in & No-show
**สถานะ:** ⬜ TODO · **Dependencies:** Phase 9 · **เริ่ม:** – · **เสร็จ:** –

**Tasks**
- [ ] QR จาก `checkin_token` (signed) ในหน้า "การจองของฉัน"
- [ ] Admin โหมดมือถือ: สแกน QR ด้วยกล้อง (เช่น `html5-qrcode`) + ค้นหาด้วยรหัสล็อค/เบอร์โทร (สำรอง)
- [ ] ตั้ง `checkin_open_at/close_at` ต่อวันขาย
- [ ] Worker หลังปิด check-in: นับ No-show → ระงับตาม `noshow_threshold`/`noshow_suspend_days` → แจ้งผู้ค้า
- [ ] ผัง realtime วันขาย: แสดงล็อคที่ check-in แล้ว

**Acceptance Criteria**
- สแกน QR ซ้ำ → แจ้งว่า check-in แล้ว (ไม่นับซ้ำ); QR วันอื่น → ปฏิเสธ

**Agent Notes:** –

---

## Phase 11 — Hardening & Scale
**สถานะ:** ⬜ TODO · **Dependencies:** Phase 10 · **เริ่ม:** – · **เสร็จ:** –

**Tasks**
- [ ] Waiting Room (Redis queue ปล่อยคนเข้าหน้าจองเป็นชุด) — เปิด/ปิดได้ต่อรอบ
- [ ] (ทางเลือก) โหมด Lottery: ลงชื่อ → สุ่มลำดับสิทธิ์เลือกล็อค
- [ ] SlipVerifier จริง (เช่น SlipOK) + ตรวจสลิปซ้ำ
- [ ] PDPA: ขอลบ/ส่งออกข้อมูลส่วนตัว, นโยบายเก็บข้อมูล
- [ ] Security review (OWASP checklist), dependency audit
- [ ] Multi-market UI (ถ้าตัดสินใจใช้หลายตลาด)
- [ ] Monitoring: Prometheus/Grafana หรือเทียบเท่า, alert เมื่อ error rate สูง

**Agent Notes:** –

---

## 📝 Progress Log

> Agent เพิ่มบรรทัดใหม่ **ด้านล่างสุด** ทุกครั้งที่เริ่ม/จบ/ติดปัญหา

| วันที่ | Phase | สถานะ | สรุป |
|---|---|---|---|
| 2026-10-31 | — | — | สร้างเอกสารแผนการพัฒนา |
| 2026-10-31 | 0 | 🟨 IN PROGRESS | ตั้ง monorepo (api/web/admin/shared), docker-compose, env validation, lint/format/test, husky, CI workflow, README — AC ข้อ 1 ผ่าน, เหลือยืนยัน CI บน GitHub หลัง push |
| 2026-10-31 | 0 | ✅ DONE | push ขึ้น github.com/rungtom003/market-booking, CI บน `main` ผ่าน — Phase ถัดไป: 1.1 Database Schema & Seed |
| 2026-10-31 | 1.1 | 🟨 IN PROGRESS | schema 16 ตาราง + partial index 4 ตัว, migration init, PrismaService, seed, enum ใน shared, integration test (14 ผ่าน), CI เพิ่ม postgres — เหลือรัน `migrate reset` (รอผู้ใช้ยินยอม) |
| 2026-10-31 | 1.1 | ✅ DONE | `pnpm db:reset` ผ่าน (ผู้ใช้ยินยอม), lint/format/typecheck/test (13)/test:int (14)/build ผ่าน — Phase ถัดไป: 1.2 Core Infrastructure |
| 2026-10-31 | 1.2 | ✅ DONE | error format/filter, `{ data, meta }`, Zod pipe (nestjs-zod), pino + request id + redact, Helmet/CORS, throttler บน Redis, AuditService, pagination, Swagger `/api/docs` — unit 45 / integration 33 ผ่าน — ถัดไป: 1.3 Admin Auth & RBAC |
| 2026-10-31 | 1.3 | ✅ DONE | admin login (bcrypt) + JWT 15 นาที + refresh rotation ใน Redis, ล็อค 5 ครั้ง/15 นาที, global auth/RBAC guard จากตาราง §2, CRUD `/admin/users` + audit, `GET /admin/settings` — unit 70 / integration 56 ผ่าน — ถัดไป: 1.4 Vendor Auth |
| 2026-10-31 | 1.4 | ✅ DONE | OTP (SMS mock, HMAC ใน Redis, cooldown 60 วินาที/5 ต่อชั่วโมง/ผิดได้ 5 ครั้ง), LINE login ผ่าน verifier ที่ mock ได้, registrationToken, ผูก LINE ภายหลัง — unit 94 / integration 77 ผ่าน — ถัดไป: 1.5 Settings Module |
| 2026-10-31 | 1.5 | ✅ DONE | schema ทุก key ใน shared, `SettingsService.get<K>()`, cache Redis แบบ version, `PUT /admin/settings` + audit เฉพาะ key ที่เปลี่ยน — unit 109 / integration 89 ผ่าน |
| 2026-10-31 | 1 | ✅ DONE | Backend Foundation ครบทุก sub-phase (1.1–1.5) — ถัดไป: 2.1 Vendor API & File Upload |
| 2026-10-31 | 2.1 | ✅ DONE | StorageModule (MinIO presigned PUT/GET + ตรวจไฟล์), สมัครด้วย registrationToken ตาม registration_mode, `/vendors/me`, admin list/counts/detail/approve/reject/suspend/unsuspend/bulk-approve + audit, VendorApprovedGuard, CI เพิ่ม MinIO — unit 117 / integration 126 ผ่าน — ถัดไป: 2.2 Vendor Web |
| 2026-10-31 | 2.2 | ✅ DONE | เว็บผู้ค้า: login OTP (+LINE เมื่อตั้ง LIFF), สมัคร + อัปโหลดรูป (ย่อในเครื่อง), หน้าสถานะ, แก้โปรไฟล์, ข้อความไทย; E2E Playwright 360px 5 เคส + เข้า CI — ถัดไป: 2.3 Admin Web |
| 2026-10-31 | 2.3 | ✅ DONE | หน้า admin: login, layout + เมนูตามสิทธิ์ + 403, รายการผู้ค้า (DataGrid, tab, ค้นหา, badge), drawer อนุมัติ/ไม่อนุมัติ/ระงับ, อนุมัติหลายรายการ, Settings จาก schema, จัดการผู้ดูแล; `GET /admin/me`; E2E admin 7 เคส |
| 2026-10-31 | 2 | ✅ DONE | Member Registration & Approval ครบ (2.1–2.3) — ถัดไป: 3.1 Zones, Categories, Stalls |
| 2026-10-31 | 3.1 | 🟨 IN PROGRESS | เริ่ม CRUD โซน/ประเภทสินค้า/ล็อค, bulk create, `GET /market-days/:id/stalls`, StallMap, หน้า admin |
| 2026-10-31 | 3.1 | ✅ DONE | CRUD ประเภทสินค้า/โซน/ล็อค + bulk create + audit, `GET /market/layout` + `/market-days/:id/stalls`, `packages/stall-map` (SVG zoom/pan), หน้า admin ล็อค/โซน, หน้า `/map` ผู้ค้า; E2E ล็อค seed ถูกตำแหน่งทั้ง 2 แอป — unit 122 / integration 156 / E2E 18 ผ่าน — ถัดไป: 3.2 Booking Rounds & Market Days |
| 2026-10-31 | 3.2 | 🟨 IN PROGRESS | เริ่มรอบการจอง + วันขาย (CRUD, publish/cancel, validation §9.3), `RoundService.getPhase`/`assertRoundOpen`, override รายวัน, `GET /rounds/current`, หน้า admin + countdown ผู้ค้า |
| 2026-10-31 | 3.2 | ✅ DONE | รอบการจอง + วันขาย (CRUD, publish/cancel, validation §9.3, partial unique วันขาย), `getPhase`/`assertRoundOpen`, override ล็อครายวัน, `GET /rounds/current` + serverTime; หน้า admin รอบ/ปฏิทิน/ตั้งค่าล็อครายวัน, การ์ดรอบ + Countdown ผู้ค้า — unit 134 / integration 176 / E2E 20 ผ่าน |
| 2026-10-31 | 3 | ✅ DONE | Market Setup ครบ (3.1–3.2) — ถัดไป: 4.1 Booking Core API + Concurrency |
