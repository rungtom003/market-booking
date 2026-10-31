# ระบบจองล็อคขายของตลาด — ภาพรวมระบบ (System Overview)

> เอกสารนี้คือ **Source of Truth** ของการออกแบบระบบ
> Agent / Developer ต้องอ่านไฟล์นี้ก่อนเริ่มทุก Phase และอ่านคู่กับ `02-development-phases.md`
> หากมีการเปลี่ยนแปลงการออกแบบระหว่างพัฒนา ให้แก้ไฟล์นี้และบันทึกใน [Decision Log](#15-decision-log)

---

## สารบัญ

1. [วัตถุประสงค์และขอบเขต](#1-วัตถุประสงค์และขอบเขต)
2. [ผู้ใช้งานและสิทธิ์](#2-ผู้ใช้งานและสิทธิ์)
3. [คำศัพท์](#3-คำศัพท์-glossary)
4. [Tech Stack](#4-tech-stack)
5. [Architecture](#5-architecture)
6. [โครงสร้างโปรเจกต์](#6-โครงสร้างโปรเจกต์-monorepo)
7. [Data Model](#7-data-model)
8. [State Machines](#8-state-machines)
9. [Business Flows](#9-business-flows)
10. [Realtime Design](#10-realtime-design)
11. [API Endpoints](#11-api-endpoints)
12. [System Settings](#12-system-settings)
13. [Security และ Non-functional Requirements](#13-security-และ-non-functional-requirements)
14. [Coding Conventions](#14-coding-conventions)
15. [Decision Log](#15-decision-log)

---

## 1. วัตถุประสงค์และขอบเขต

### วัตถุประสงค์
ระบบออนไลน์ให้ผู้ค้า (Vendor) สมัครสมาชิกและจองล็อคขายของในตลาดได้แบบ Realtime โดย Admin ควบคุมการอนุมัติสมาชิก ผังล็อค ราคา และรอบการเปิดจอง

### ความต้องการหลัก (จากเจ้าของระบบ)
| # | ความต้องการ | Module ที่รับผิดชอบ |
|---|---|---|
| R1 | หน้าสมัครสมาชิก (ชื่อ, นามสกุล, ที่อยู่, เบอร์โทร) | `vendor`, `auth` |
| R2 | Admin ตรวจสอบ/อนุมัติสมาชิก ตั้งค่าได้ว่า **อนุมัติอัตโนมัติ** หรือ **ตรวจก่อนอนุมัติ** | `vendor`, `settings` |
| R3 | หน้าจองล็อคแบบ Realtime | `booking`, `realtime` |
| R4 | Admin กำหนดช่วงเวลาเปิด-ปิดการจอง | `round` |

### ความต้องการเพิ่มเติม (ที่ตกลงร่วมกัน)
ยืนยันตัวตนด้วย OTP/LINE, ผังตลาดและโซน, ราคาต่อล็อค, โควต้าการจองต่อคน, ระบบชำระเงิน (PromptPay + สลิป), แจ้งเตือน LINE OA, Waitlist, QR Check-in, ระบบ No-show, รายงาน, RBAC, Audit Log

### นอกขอบเขต (Out of Scope) ในเวอร์ชันแรก
- ระบบตัดเงินอัตโนมัติผ่าน Payment Gateway (ใช้สลิปก่อน)
- Mobile App แบบ Native (ใช้ Web/LIFF แบบ Mobile-first)
- ระบบบัญชี/ใบกำกับภาษีเต็มรูปแบบ

---

## 2. ผู้ใช้งานและสิทธิ์

ระบบแยกผู้ใช้เป็น 2 กลุ่ม เก็บคนละตาราง เพราะข้อมูลและวิธี Login ต่างกัน

| กลุ่ม | ตาราง | วิธี Login | หน้าจอ |
|---|---|---|---|
| ผู้ค้า (Vendor) | `vendors` | LINE Login (LIFF) หรือ เบอร์โทร + OTP | `apps/web` |
| ผู้ดูแล (Admin) | `admin_users` | Username + Password (bcrypt) | `apps/admin` |

### Role ของ Admin (RBAC)
| Permission | SUPER_ADMIN | ADMIN | STAFF | FINANCE |
|---|:-:|:-:|:-:|:-:|
| จัดการ Admin users | ✅ | ❌ | ❌ | ❌ |
| ตั้งค่าระบบ (Settings) | ✅ | ✅ | ❌ | ❌ |
| อนุมัติ/ปฏิเสธ/ระงับ Vendor | ✅ | ✅ | ✅ | ❌ |
| จัดการโซน/ล็อค/ผังตลาด | ✅ | ✅ | ❌ | ❌ |
| จัดการรอบการจอง | ✅ | ✅ | ❌ | ❌ |
| ยกเลิกการจองแทนผู้ค้า | ✅ | ✅ | ✅ | ❌ |
| ตรวจสลิป/ยืนยันการชำระเงิน | ✅ | ✅ | ❌ | ✅ |
| ดูรายงาน | ✅ | ✅ | ✅ | ✅ |
| Check-in ผู้ค้าหน้างาน | ✅ | ✅ | ✅ | ❌ |
| ดู Audit Log | ✅ | ✅ | ❌ | ❌ |

---

## 3. คำศัพท์ (Glossary)

| คำ | ความหมาย |
|---|---|
| **Market** | ตลาด 1 แห่ง (ออกแบบรองรับหลายตลาดไว้ล่วงหน้า) |
| **Zone** | โซนในตลาด เช่น โซนอาหาร, โซนเสื้อผ้า |
| **Stall (ล็อค)** | พื้นที่ขาย 1 ช่อง มีรหัส เช่น `A12` |
| **Booking Round (รอบการจอง)** | ช่วงเวลาที่เปิดให้จอง (`open_at` – `close_at`) ครอบคลุมวันขายตั้งแต่ 1 วันขึ้นไป |
| **Market Day (วันขาย)** | วันที่ตลาดเปิดจริง 1 วัน อยู่ภายใต้ 1 รอบการจอง |
| **Hold** | สถานะล็อคชั่วคราวระหว่างผู้ค้ากำลังยืนยันการจอง มีเวลาหมดอายุ |
| **Active Booking** | Booking ที่สถานะ `HOLD`, `PENDING_PAYMENT`, `PENDING_VERIFY`, `CONFIRMED` |
| **No-show** | จองและยืนยันแล้ว แต่ไม่มา Check-in ในวันขาย |

---

## 4. Tech Stack

| Layer | เทคโนโลยี |
|---|---|
| Language | TypeScript (ทั้งระบบ) |
| Frontend User | React 18 + Vite + Tailwind CSS + TanStack Query + React Hook Form + Zod |
| Frontend Admin | React 18 + Vite + MUI (+ MUI X DataGrid) + TanStack Query + React Hook Form + Zod |
| ผังตลาด | SVG (แสดงผล/เลือกล็อค) → react-konva (Map Editor ใน Phase หลัง) |
| Backend | NestJS 10 |
| Realtime | Socket.IO + `@socket.io/redis-adapter` |
| ORM / DB | Prisma + PostgreSQL 16 |
| Cache / Queue | Redis 7 + BullMQ |
| Auth | JWT (Access 15 นาที + Refresh 7 วัน, httpOnly cookie), LINE Login (LIFF), OTP |
| File Storage | MinIO (S3-compatible) |
| Notification | LINE Messaging API, SMS Gateway (ผ่าน Adapter) |
| Testing | Jest (unit/integration), Supertest (API), Playwright (E2E), k6 (load test) |
| Deploy | Docker Compose + Nginx + Linux VPS |
| Monorepo | pnpm workspaces |

---

## 5. Architecture

```
┌────────────────────┐        ┌────────────────────┐
│  apps/web (Vendor) │        │  apps/admin        │
│  Mobile-first/LIFF │        │  Desktop-first     │
└─────────┬──────────┘        └─────────┬──────────┘
          │   REST (HTTPS) + WebSocket (Socket.IO)
          ▼                             ▼
┌───────────────────────────────────────────────────┐
│            Nginx (SSL, Reverse Proxy, gzip)        │
│   /api → api:3000   /socket.io → api:3000 (ws)     │
└───────────────────────────┬───────────────────────┘
                            ▼
┌───────────────────────────────────────────────────┐
│                 apps/api (NestJS)                  │
│ auth │ vendor │ admin-user │ settings │ market     │
│ stall │ round │ booking │ payment │ waitlist       │
│ checkin │ notify │ report │ audit │ realtime(gw)   │
└──────┬───────────────┬───────────────────┬────────┘
       ▼               ▼                   ▼
┌────────────┐  ┌──────────────────┐  ┌───────────────────┐
│ PostgreSQL │  │ Redis            │  │ BullMQ Workers    │
│ ข้อมูลหลัก  │  │ - Socket adapter │  │ - booking-expiry  │
│ (Source of │  │ - Rate limit     │  │ - notification    │
│  Truth)    │  │ - OTP store      │  │ - no-show checker │
└────────────┘  └──────────────────┘  └───────────────────┘
                         ┌──────────────┐
                         │ MinIO (สลิป,  │
                         │ รูปบัตร, รูปร้าน)│
                         └──────────────┘
```

### หลักการออกแบบสำคัญ
1. **Database คือผู้ตัดสินการจอง** — กันจองซ้ำด้วย Partial Unique Index ไม่ใช่ด้วย `SELECT` ก่อน `INSERT`
2. **WebSocket ใช้แจ้งการเปลี่ยนแปลงเท่านั้น** — สถานะจริงดึงผ่าน REST เสมอ เมื่อ reconnect ต้อง refetch snapshot
3. **เวลา Server เป็นหลัก** — การเปิด/ปิดรอบตรวจที่ Server เท่านั้น Client ใช้แค่แสดง Countdown
4. **ทุก Action ของ Admin ต้องลง Audit Log**
5. **Stateless API** — ขยายหลาย Instance ได้ (state อยู่ใน DB/Redis)

---

## 6. โครงสร้างโปรเจกต์ (Monorepo)

```
market-booking/
├── apps/
│   ├── api/
│   │   ├── src/
│   │   │   ├── main.ts
│   │   │   ├── app.module.ts
│   │   │   ├── common/          # guards, decorators, filters, interceptors, pipes
│   │   │   ├── config/          # env schema (zod), config module
│   │   │   ├── prisma/          # PrismaService
│   │   │   └── modules/
│   │   │       ├── auth/
│   │   │       ├── vendor/
│   │   │       ├── admin-user/
│   │   │       ├── settings/
│   │   │       ├── market/      # markets, zones
│   │   │       ├── stall/
│   │   │       ├── round/       # booking_rounds, market_days
│   │   │       ├── booking/
│   │   │       ├── payment/
│   │   │       ├── waitlist/
│   │   │       ├── checkin/
│   │   │       ├── notify/      # LINE, SMS adapters + queue
│   │   │       ├── report/
│   │   │       ├── audit/
│   │   │       ├── storage/     # MinIO
│   │   │       └── realtime/    # Socket.IO gateway
│   │   ├── prisma/
│   │   │   ├── schema.prisma
│   │   │   ├── migrations/
│   │   │   └── seed.ts
│   │   └── test/
│   ├── web/                     # Vendor app
│   │   └── src/{pages,features,components,hooks,lib,api}
│   └── admin/                   # Admin app
│       └── src/{pages,features,components,hooks,lib,api}
├── packages/
│   └── shared/                  # zod schemas, enums, types, socket event names
├── docs/
│   ├── 01-system-overview.md    # ไฟล์นี้
│   └── 02-development-phases.md
├── docker/
│   ├── nginx/nginx.conf
│   └── docker-compose.prod.yml
├── docker-compose.yml           # dev: postgres, redis, minio
├── .env.example
└── pnpm-workspace.yaml
```

### โครงสร้างภายใน Module ของ API (มาตรฐาน)
```
modules/booking/
├── booking.module.ts
├── booking.controller.ts        # vendor endpoints
├── booking-admin.controller.ts  # admin endpoints
├── booking.service.ts           # business logic
├── booking.repository.ts        # (ถ้า query ซับซ้อน) แยก DB access
├── booking-expiry.processor.ts  # BullMQ worker
├── dto/
└── booking.service.spec.ts
```

---

## 7. Data Model

> ทุกตารางมี `id` (UUID), `created_at`, `updated_at` ยกเว้นระบุเป็นอื่น
> ทุกตารางที่เป็นข้อมูลตลาดมี `market_id` เพื่อรองรับหลายตลาด (ระยะแรกมี 1 ตลาดจาก seed)

### 7.1 Enums
| Enum | ค่า |
|---|---|
| `VendorStatus` | `PENDING`, `APPROVED`, `REJECTED`, `SUSPENDED` |
| `AdminRole` | `SUPER_ADMIN`, `ADMIN`, `STAFF`, `FINANCE` |
| `RoundStatus` | `DRAFT`, `PUBLISHED`, `CANCELLED` |
| `BookingStatus` | `HOLD`, `PENDING_PAYMENT`, `PENDING_VERIFY`, `CONFIRMED`, `CANCELLED`, `EXPIRED` |
| `PaymentStatus` | `PENDING`, `APPROVED`, `REJECTED` |
| `WaitlistStatus` | `WAITING`, `NOTIFIED`, `FULFILLED`, `EXPIRED`, `CANCELLED` |
| `RegistrationMode` | `AUTO`, `MANUAL` |

> สถานะ "เปิดจอง/ปิดจอง" ของรอบ **ไม่เก็บใน DB** แต่คำนวณจาก `PUBLISHED` + เวลา Server อยู่ระหว่าง `open_at` – `close_at`

### 7.2 ตาราง

**`markets`** — ตลาด
| Column | Type | หมายเหตุ |
|---|---|---|
| name | varchar(200) | |
| address | text | |
| timezone | varchar(50) | default `Asia/Bangkok` |
| is_active | boolean | |

**`vendors`** — ผู้ค้า
| Column | Type | หมายเหตุ |
|---|---|---|
| market_id | uuid FK | |
| first_name, last_name | varchar(100) | |
| phone | varchar(20) | unique ต่อ market |
| phone_verified_at | timestamptz null | |
| line_user_id | varchar(64) null | unique |
| address | text | |
| shop_name | varchar(200) null | |
| product_category_id | uuid FK null | |
| id_card_image_key | varchar null | object key ใน MinIO |
| shop_image_key | varchar null | |
| pdpa_consent_at | timestamptz | ต้องมีค่าเสมอ |
| status | VendorStatus | |
| reviewed_by | uuid FK admin_users null | |
| reviewed_at | timestamptz null | |
| reject_reason | text null | |
| suspended_until | timestamptz null | ใช้กับระบบ No-show |
| noshow_count | int default 0 | |

**`admin_users`**
| Column | Type | หมายเหตุ |
|---|---|---|
| market_id | uuid FK null | null = ทุกตลาด (SUPER_ADMIN) |
| username | varchar(50) unique | |
| password_hash | varchar | bcrypt cost 12 |
| display_name | varchar(100) | |
| role | AdminRole | |
| is_active | boolean | |
| last_login_at | timestamptz null | |

**`product_categories`** — market_id, name, sort_order

**`zones`**
| Column | Type | หมายเหตุ |
|---|---|---|
| market_id | uuid FK | |
| name | varchar(100) | |
| color | varchar(7) | `#RRGGBB` |
| allowed_category_ids | uuid[] | ว่าง = ทุกประเภท |
| sort_order | int | |

**`stalls`**
| Column | Type | หมายเหตุ |
|---|---|---|
| market_id, zone_id | uuid FK | |
| code | varchar(20) | unique ต่อ market เช่น `A12` |
| width_m, length_m | decimal(5,2) | |
| price | decimal(10,2) | ราคาต่อวันขาย |
| pos_x, pos_y, rot | decimal | ตำแหน่งบนผัง (หน่วย px ของ canvas) |
| shape_w, shape_h | decimal | ขนาดบนผัง |
| is_active | boolean | |
| is_reserved | boolean | สงวนไว้ ไม่เปิดให้จองออนไลน์ |
| note | text null | |

**`booking_rounds`**
| Column | Type | หมายเหตุ |
|---|---|---|
| market_id | uuid FK | |
| name | varchar(200) | เช่น "รอบเดือนธันวาคม 2026" |
| open_at, close_at | timestamptz | ช่วงเวลาเปิดจอง |
| max_stalls_per_vendor | int | ต่อ 1 วันขาย |
| status | RoundStatus | |
| created_by | uuid FK admin_users | |

**`market_days`**
| Column | Type | หมายเหตุ |
|---|---|---|
| market_id | uuid FK | เก็บซ้ำกับ round เพื่อบังคับ unique (market, date) ระดับ DB |
| round_id | uuid FK | |
| market_date | date | unique ต่อ (market, date) |
| checkin_open_at, checkin_close_at | timestamptz null | ใช้ตัดสิน No-show |
| is_cancelled | boolean | |

**`stall_day_overrides`** (optional) — stall_id, market_day_id, price_override, is_closed
> ใช้ปิดล็อคหรือเปลี่ยนราคาเฉพาะวัน

**`bookings`**
| Column | Type | หมายเหตุ |
|---|---|---|
| market_id | uuid FK | |
| vendor_id, stall_id, market_day_id | uuid FK | |
| status | BookingStatus | |
| amount | decimal(10,2) | snapshot ราคา ณ เวลาจอง |
| hold_expires_at | timestamptz null | |
| payment_due_at | timestamptz null | |
| confirmed_at | timestamptz null | |
| cancelled_at | timestamptz null | |
| cancel_reason | text null | |
| cancelled_by_admin_id | uuid null | |
| checked_in_at | timestamptz null | |
| checkin_token | varchar(64) unique null | สำหรับ QR |
| version | int | optimistic lock |

```sql
-- หัวใจของการกันจองซ้ำ — ประกาศใน schema.prisma (preview feature `partialIndexes`) แล้ว Prisma สร้าง SQL นี้ให้
-- (ใน schema เขียน predicate เป็น `status = ANY (ARRAY[...])` ซึ่งเป็นรูปที่ PostgreSQL normalize แล้ว — ดู Decision Log)
CREATE UNIQUE INDEX uq_active_booking
  ON bookings (stall_id, market_day_id)
  WHERE status IN ('HOLD','PENDING_PAYMENT','PENDING_VERIFY','CONFIRMED');

CREATE INDEX ix_bookings_vendor_day ON bookings (vendor_id, market_day_id) WHERE status IN ('HOLD','PENDING_PAYMENT','PENDING_VERIFY','CONFIRMED');
CREATE INDEX ix_bookings_hold_exp   ON bookings (hold_expires_at) WHERE status = 'HOLD';
CREATE INDEX ix_bookings_pay_due    ON bookings (payment_due_at)  WHERE status = 'PENDING_PAYMENT';
```

**`payments`**
| Column | Type | หมายเหตุ |
|---|---|---|
| booking_id | uuid FK | 1 booking มีได้หลาย payment (กรณีสลิปถูกปฏิเสธแล้วส่งใหม่) |
| method | varchar(20) | `PROMPTPAY_SLIP`, `CASH` |
| amount | decimal(10,2) | |
| slip_image_key | varchar null | |
| status | PaymentStatus | |
| verified_by | uuid FK admin_users null | |
| verified_at | timestamptz null | |
| reject_reason | text null | |

**`waitlists`** — vendor_id, market_day_id, stall_id null, zone_id null, position, status, notified_at, expires_at

**`system_settings`** — market_id, key, value (jsonb), updated_by — unique (market_id, key)

**`announcements`** — market_id, title, body, publish_at, expire_at, is_pinned

**`audit_logs`**
| Column | Type | หมายเหตุ |
|---|---|---|
| actor_type | varchar | `ADMIN`, `VENDOR`, `SYSTEM` |
| actor_id | uuid null | |
| action | varchar(100) | เช่น `vendor.approve`, `booking.cancel` |
| entity_type, entity_id | varchar, uuid | |
| before, after | jsonb null | |
| ip, user_agent | varchar null | |
| created_at | timestamptz | (ไม่มี updated_at — append only) |

**`notification_logs`** — channel, recipient, template, payload, status, error, sent_at

### 7.3 ER Diagram (ย่อ)
```
markets 1─* zones 1─* stalls
markets 1─* vendors
markets 1─* booking_rounds 1─* market_days
vendors 1─* bookings *─1 stalls
market_days 1─* bookings
bookings 1─* payments
vendors 1─* waitlists *─1 market_days
admin_users 1─* audit_logs
```

---

## 8. State Machines

### 8.1 Vendor
```
           สมัคร
             │
   ┌─ AUTO ──┴── MANUAL ─┐
   ▼                     ▼
APPROVED ◄── approve ── PENDING ── reject ──► REJECTED
   │  ▲                                           │
suspend │ unsuspend / หมดเวลาระงับ                  └── แก้ไขข้อมูลแล้วส่งใหม่ ──► PENDING
   ▼  │
SUSPENDED
```
- จองได้เฉพาะ `APPROVED` และ `suspended_until` ว่างหรือผ่านไปแล้ว

### 8.2 Booking
```
           hold (เลือกล็อค)
                │
                ▼
              HOLD ── hold_expires_at ผ่าน ──► EXPIRED
                │  └── vendor ยกเลิก ─────────► CANCELLED
         confirm│
   ┌────────────┴─────────────┐
   │ payment_required = false │ payment_required = true
   ▼                          ▼
CONFIRMED              PENDING_PAYMENT ── payment_due_at ผ่าน ──► EXPIRED
   ▲                          │
   │                   upload slip
   │                          ▼
   └──── approve ──── PENDING_VERIFY ── reject slip ──► PENDING_PAYMENT
                                         (ขยาย payment_due_at ตาม setting)

CONFIRMED ── ยกเลิกก่อน cancel_before_hours / admin ยกเลิก ──► CANCELLED
```
- ทุกการเปลี่ยนสถานะต้องทำใน Transaction และ `UPDATE ... WHERE status = <สถานะเดิม>` (กัน worker กับ user ชนกัน)
- ทุกการเปลี่ยนสถานะที่ทำให้ล็อคว่างหรือไม่ว่าง ต้อง emit `stall:updated`

### 8.3 Booking Round
```
DRAFT ── publish ──► PUBLISHED ── cancel ──► CANCELLED
                        │
          (คำนวณจากเวลา) ├─ now < open_at            → UPCOMING
                        ├─ open_at ≤ now < close_at → OPEN
                        └─ now ≥ close_at           → CLOSED
```
- แก้ `open_at` ได้เฉพาะก่อนเปิดจอง; แก้ `close_at` ได้ตลอด (ต้องลง Audit Log)

---

## 9. Business Flows

### 9.1 สมัครสมาชิก
1. ผู้ค้าเข้า `apps/web` → เลือก Login ด้วย LINE หรือกรอกเบอร์โทร
2. ยืนยัน OTP (ถ้าใช้เบอร์โทร) — OTP 6 หลัก หมดอายุ 5 นาที ขอใหม่ได้ทุก 60 วินาที สูงสุด 5 ครั้ง/ชั่วโมง
3. กรอกฟอร์ม: ชื่อ, นามสกุล, เบอร์โทร, ที่อยู่, ชื่อร้าน, ประเภทสินค้า, รูปบัตร/รูปร้าน (ตาม setting), ยอมรับ PDPA
4. Server อ่าน `registration_mode`
   - `AUTO` → `APPROVED` ทันที → แจ้งเตือนต้อนรับ
   - `MANUAL` → `PENDING` → แจ้ง Admin (badge + LINE กลุ่ม Admin ถ้าตั้งค่า)
5. ผู้ค้าสถานะ `PENDING` เข้าระบบได้ แต่เห็นหน้า "รอการอนุมัติ" และจองไม่ได้

### 9.2 อนุมัติสมาชิก (Admin)
1. หน้า "รออนุมัติ" แสดงรายการ `PENDING` เรียงตามเวลาสมัคร พร้อมดูรูปบัตร/รูปร้าน
2. Admin กด อนุมัติ / ปฏิเสธ (ต้องระบุเหตุผล) / อนุมัติหลายรายการพร้อมกัน
3. บันทึก `reviewed_by`, `reviewed_at`, Audit Log → แจ้งผลผู้ค้าทาง LINE/SMS
4. เปลี่ยน `registration_mode` จาก MANUAL เป็น AUTO **ไม่** อนุมัติรายการค้างเดิมอัตโนมัติ (Admin ต้องตัดสินใจเอง — มีปุ่ม "อนุมัติทั้งหมดที่ค้าง")

### 9.3 สร้างรอบการจอง (Admin)
1. สร้างรอบ: ชื่อ, `open_at`, `close_at`, `max_stalls_per_vendor`
2. เพิ่มวันขาย (เลือกหลายวันจากปฏิทิน หรือสร้างแบบ "ทุกวันเสาร์-อาทิตย์ของเดือน")
3. ตั้ง override ล็อคเฉพาะวัน (ถ้ามี)
4. Publish → ผู้ค้าเห็นรอบที่กำลังจะเปิดพร้อม Countdown → ระบบส่งแจ้งเตือนก่อนเปิด X นาที (ตาม setting)
- Validation: `open_at < close_at`, `close_at` ≤ วันขายวันแรก, วันขายต้องไม่ซ้ำกับรอบอื่น

### 9.4 จองล็อค (Realtime)
```
Vendor เปิดหน้าผังของวันขาย
  → GET /market-days/:id/stalls (snapshot) + socket join room md:{id}
Vendor กดล็อค A12 → POST /bookings/hold
  Server ตรวจ:
   (1) vendor APPROVED และไม่ถูกระงับ
   (2) รอบ PUBLISHED และ now อยู่ในช่วง open_at–close_at (เวลา server)
   (3) ล็อค is_active, ไม่ reserved, ไม่ถูกปิดในวันนั้น
   (4) ประเภทสินค้าตรงกับโซน (ถ้าโซนจำกัด)
   (5) จำนวน active booking ของ vendor ในวันนั้น < max_stalls_per_vendor
  INSERT booking HOLD (hold_expires_at = now + hold_minutes)
   ├─ ชน uq_active_booking → 409 STALL_TAKEN
   └─ สำเร็จ → enqueue expiry job → emit stall:updated(HOLD)
Vendor กด "ยืนยันการจอง" → POST /bookings/:id/confirm
   → CONFIRMED หรือ PENDING_PAYMENT → emit stall:updated
```
- ข้อ (5) ต้องกันกรณีกดหลายล็อคพร้อมกัน: ใช้ `pg_advisory_xact_lock(hash(vendor_id, market_day_id))` ใน Transaction เดียวกับ INSERT

### 9.5 ชำระเงิน
1. หลัง confirm (ถ้า `payment_required`) แสดง PromptPay QR (สร้างจาก `promptpay_id` + ยอดเงิน) และเวลาที่เหลือ
2. ผู้ค้าอัปโหลดสลิป → `PENDING_VERIFY` → แจ้ง FINANCE
3. FINANCE อนุมัติ → `CONFIRMED` + สร้าง `checkin_token` / ปฏิเสธ → `PENDING_PAYMENT` พร้อมเหตุผล
4. ยังไม่ส่งสลิปเมื่อเลย `payment_due_at` → `EXPIRED` → ล็อคว่าง → แจ้ง Waitlist
5. Admin บันทึกรับเงินสดหน้างานได้ (method = `CASH`)

### 9.6 ยกเลิกการจอง
- ผู้ค้ายกเลิกเองได้ถ้าเหลือเวลาก่อนวันขาย ≥ `cancel_before_hours`
- การคืนเงินจัดการนอกระบบ บันทึกเป็นหมายเหตุใน Phase แรก
- Admin ยกเลิกแทนได้ทุกเวลา ต้องระบุเหตุผล

### 9.7 Waitlist
1. ล็อค/โซนเต็ม → ผู้ค้ากด "เข้าคิว" (เลือกเจาะจงล็อค หรือ ทั้งโซน)
2. มีล็อคว่าง (expire/cancel) → แจ้งคิวลำดับแรก พร้อมสิทธิ์ล็อคพิเศษ `waitlist_claim_minutes` (เป็น HOLD ในชื่อผู้ค้าคนนั้นอัตโนมัติ)
3. ไม่ยืนยันภายในเวลา → ส่งต่อคิวถัดไป

### 9.8 Check-in และ No-show
1. ผู้ค้าที่ `CONFIRMED` ได้ QR (เข้ารหัส `checkin_token`)
2. เจ้าหน้าที่สแกนผ่าน `apps/admin` (โหมดมือถือ) → บันทึก `checked_in_at`
3. หลัง `checkin_close_at` Worker ตรวจผู้ไม่ Check-in → `noshow_count + 1`
4. `noshow_count` ถึง `noshow_threshold` → ระงับสิทธิ์ `noshow_suspend_days` วัน → แจ้งผู้ค้า

---

## 10. Realtime Design

### 10.1 Socket.IO
- Namespace: `/booking`
- Auth: ส่ง JWT ใน `handshake.auth.token` (vendor หรือ admin)
- Rooms:
  - `md:{marketDayId}` — ทุกคนที่ดูผังวันขายนั้น
  - `vendor:{vendorId}` — ข้อความส่วนตัวของผู้ค้า
  - `admin:{marketId}` — Admin ของตลาด

### 10.2 Events (ชื่อเก็บใน `packages/shared/src/socket-events.ts`)
| ทิศทาง | Event | Payload |
|---|---|---|
| C → S | `md:join` | `{ marketDayId }` |
| C → S | `md:leave` | `{ marketDayId }` |
| S → C | `stall:updated` | `{ marketDayId, stallId, state: 'AVAILABLE'\|'HOLD'\|'BOOKED'\|'CLOSED', mine: boolean, updatedAt }` |
| S → C | `round:changed` | `{ roundId, openAt, closeAt, status }` |
| S → C | `booking:changed` | `{ bookingId, status, holdExpiresAt?, paymentDueAt? }` (เฉพาะห้อง vendor) |
| S → C | `waitlist:offer` | `{ waitlistId, bookingId, expiresAt }` |
| S → C | `server:time` | `{ now }` (ส่งตอน connect) |
| S → C (admin) | `vendor:registered`, `payment:submitted` | สำหรับ badge แจ้งเตือน |

### 10.3 กติกา
- `mine` คำนวณฝั่ง Client จาก bookingId ของตัวเอง หรือส่งแยกห้อง (ห้ามส่งข้อมูลส่วนตัวผู้ค้าคนอื่นใน event สาธารณะ)
- Client ต้อง refetch snapshot เมื่อ `connect`/`reconnect` และเมื่อแท็บกลับมา active
- Throttle การ emit ต่อห้องได้ถ้าโหลดสูง (รวม batch ทุก 100ms)

### 10.4 Rate Limit
| Endpoint | Limit |
|---|---|
| `POST /auth/otp/request` | 1 ครั้ง/60 วินาที, 5 ครั้ง/ชั่วโมง ต่อเบอร์ |
| `POST /bookings/hold` | 5 ครั้ง/10 วินาที ต่อ vendor |
| API ทั่วไป | 100 ครั้ง/นาที ต่อ IP |

---

## 11. API Endpoints

> Prefix: `/api/v1` — Response มาตรฐาน: `{ data, meta? }` / Error: `{ error: { code, message, details? } }`

### Auth
| Method | Path | ใคร |
|---|---|---|
| POST | `/auth/otp/request` | public |
| POST | `/auth/otp/verify` | public |
| POST | `/auth/line` | public (ส่ง LIFF id token) |
| POST | `/auth/admin/login` | public |
| POST | `/auth/refresh` | cookie |
| POST | `/auth/logout` | any |

### Vendor (ผู้ค้า)
| Method | Path | หมายเหตุ |
|---|---|---|
| POST | `/vendors/register` | |
| GET / PATCH | `/vendors/me` | แก้ไขข้อมูล (REJECTED → ส่งใหม่เป็น PENDING) |
| POST | `/vendors/me/images` | presigned upload |
| GET | `/rounds/current` | รอบที่กำลังจะเปิด/เปิดอยู่ |
| GET | `/market-days/:id/stalls` | snapshot ผัง + สถานะ |
| POST | `/bookings/hold` | `{ stallId, marketDayId }` |
| POST | `/bookings/:id/confirm` | |
| POST | `/bookings/:id/cancel` | |
| GET | `/bookings/me` | |
| POST | `/bookings/:id/payments` | อัปโหลดสลิป |
| GET | `/bookings/:id/checkin-qr` | |
| POST / DELETE | `/waitlists` / `/waitlists/:id` | |
| GET | `/announcements` | |

### Admin
| Method | Path |
|---|---|
| GET | `/admin/vendors?status=&q=&page=` |
| POST | `/admin/vendors/:id/approve` · `/reject` · `/suspend` · `/unsuspend` |
| POST | `/admin/vendors/bulk-approve` |
| GET / PUT | `/admin/settings` |
| CRUD | `/admin/zones`, `/admin/stalls`, `/admin/product-categories` |
| PUT | `/admin/stalls/layout` (บันทึกตำแหน่งจาก Map Editor ทั้งชุด) |
| CRUD | `/admin/rounds`, `/admin/rounds/:id/market-days` |
| POST | `/admin/rounds/:id/publish` · `/cancel` |
| GET | `/admin/bookings?marketDayId=&status=` |
| POST | `/admin/bookings/:id/cancel` |
| POST | `/admin/bookings` (จองแทนผู้ค้า) |
| GET | `/admin/payments?status=PENDING` |
| POST | `/admin/payments/:id/approve` · `/reject` |
| POST | `/admin/checkin/scan` |
| GET | `/admin/reports/revenue`, `/occupancy`, `/noshow` (+ `?format=xlsx`) |
| CRUD | `/admin/users`, `/admin/announcements` |
| GET | `/admin/audit-logs` |

### Error Codes หลัก
`ROUND_NOT_OPEN`, `STALL_TAKEN`, `STALL_UNAVAILABLE`, `QUOTA_EXCEEDED`, `CATEGORY_NOT_ALLOWED`, `VENDOR_NOT_APPROVED`, `VENDOR_SUSPENDED`, `HOLD_EXPIRED`, `INVALID_STATE_TRANSITION`, `CANCEL_WINDOW_PASSED`, `OTP_INVALID`, `RATE_LIMITED`

---

## 12. System Settings

เก็บใน `system_settings` (ต่อ market) และ cache ใน Redis (invalidate เมื่อแก้)

| Key | Type | Default | ความหมาย |
|---|---|---|---|
| `registration_mode` | `AUTO`\|`MANUAL` | `MANUAL` | อนุมัติสมาชิกอัตโนมัติหรือตรวจก่อน |
| `require_id_card_image` | boolean | false | บังคับแนบรูปบัตรตอนสมัคร |
| `require_shop_image` | boolean | false | |
| `hold_minutes` | int | 10 | เวลา Hold ก่อนกดยืนยัน |
| `payment_required` | boolean | true | |
| `payment_deadline_minutes` | int | 1440 | เวลาชำระหลังยืนยัน |
| `promptpay_id` | string | — | เบอร์/เลขผู้เสียภาษีสำหรับสร้าง QR |
| `max_stalls_per_vendor_default` | int | 1 | ค่าเริ่มต้นเวลาสร้างรอบ |
| `cancel_before_hours` | int | 48 | |
| `waitlist_claim_minutes` | int | 30 | |
| `noshow_threshold` | int | 3 | |
| `noshow_suspend_days` | int | 30 | |
| `notify_before_round_open_minutes` | int | 60 | |

---

## 13. Security และ Non-functional Requirements

### Security
- HTTPS ทุกช่องทาง, Helmet, CORS เฉพาะโดเมนของระบบ
- Refresh token ใน httpOnly + Secure + SameSite cookie, หมุนใหม่ทุกครั้งที่ refresh
- Validate input ทุก endpoint ด้วย Zod/class-validator
- ไฟล์อัปโหลด: ตรวจ MIME/ขนาด (≤ 5 MB), เก็บ private bucket, เข้าถึงผ่าน presigned URL อายุสั้น
- PDPA: เก็บเวลายินยอม, มีหน้าขอลบข้อมูล, mask เลขโทรศัพท์ในรายงานที่ export ตามสิทธิ์
- ห้ามบันทึก OTP/password/token ลง log

### Non-functional
| ด้าน | เป้าหมาย |
|---|---|
| ผู้ใช้พร้อมกันช่วงเปิดจอง | ≥ 500 concurrent connections บน VPS 2 vCPU / 4 GB |
| Latency `POST /bookings/hold` | p95 < 300 ms ที่ 100 req/s |
| Realtime | ผู้ใช้อื่นเห็นสถานะเปลี่ยน < 1 วินาที |
| ความถูกต้อง | 0 กรณีจองซ้ำภายใต้ load test |
| Availability | Backup DB รายวัน (pg_dump) เก็บ 14 วัน |
| Mobile | `apps/web` ใช้งานได้ดีที่ความกว้าง 360px |
| ภาษา | UI ภาษาไทย, เวลาแสดงเป็น Asia/Bangkok, เก็บใน DB เป็น UTC |

---

## 14. Coding Conventions

- TypeScript `strict: true` ทุก package, ห้าม `any` โดยไม่จำเป็น
- ESLint + Prettier, Conventional Commits (`feat:`, `fix:`, `chore:`)
- ตั้งชื่อ: DB `snake_case` (ผ่าน `@map`), โค้ด `camelCase`, Enum `UPPER_SNAKE`
- Business logic อยู่ใน Service เท่านั้น; Controller บางที่สุด
- Enum, Zod schema, socket event name ใช้จาก `packages/shared` ห้ามประกาศซ้ำ
- ทุกการเปลี่ยนสถานะ Booking ทำผ่านฟังก์ชันกลาง `BookingStateService.transition()` ที่ตรวจ transition ที่อนุญาต
- เวลา: ใช้ `dayjs` + timezone, เก็บ UTC
- ทุก Module ต้องมี unit test ของ Service; Booking ต้องมี integration test แบบ concurrent
- Comment อธิบาย "ทำไม" ในจุดที่ไม่ชัดเจน (โดยเฉพาะ concurrency)

### Environment Variables (`.env.example`)
```
NODE_ENV=development
PORT=3000
DATABASE_URL=postgresql://market:market_dev@localhost:5433/market_booking
REDIS_URL=redis://localhost:6379
JWT_ACCESS_SECRET=
JWT_REFRESH_SECRET=
MINIO_ENDPOINT=localhost
MINIO_PORT=9000
MINIO_ACCESS_KEY=
MINIO_SECRET_KEY=
MINIO_BUCKET=market-booking
LINE_LOGIN_CHANNEL_ID=
LINE_LIFF_ID=
LINE_MESSAGING_ACCESS_TOKEN=
SMS_PROVIDER=mock
SMS_API_KEY=
WEB_ORIGIN=http://localhost:5173
ADMIN_ORIGIN=http://localhost:5174
```
> ไฟล์ `.env.example` จริงใส่ค่า dev ของ JWT/MinIO ไว้ให้รันกับ `docker-compose.yml` ได้ทันที — production ต้องตั้งใหม่ทั้งหมด (env schema บังคับ secret ≥ 32 ตัวอักษรเมื่อ `NODE_ENV=production`)

---

## 15. Decision Log

| วันที่ | การตัดสินใจ | เหตุผล |
|---|---|---|
| 2026-10-31 | ใช้ TypeScript ทั้งระบบ (NestJS + React + PostgreSQL + Prisma) | แชร์ type/schema ร่วมกัน, ต้นทุน hosting ต่ำ |
| 2026-10-31 | กันจองซ้ำด้วย Partial Unique Index | ให้ DB เป็นผู้ตัดสิน ปลอดภัยกว่าเช็คระดับแอป |
| 2026-10-31 | แยกตาราง `vendors` กับ `admin_users` | ข้อมูลและวิธี login ต่างกัน |
| 2026-10-31 | ใส่ `market_id` ตั้งแต่แรก | รองรับหลายตลาดในอนาคตโดยไม่ต้อง migrate ใหญ่ |
| 2026-10-31 | สถานะเปิด/ปิดรอบคำนวณจากเวลา ไม่เก็บใน DB | ไม่ต้องมี cron เปลี่ยนสถานะ ลดโอกาสข้อมูลไม่ตรง |
| 2026-10-31 | ใช้ image `pgsty/minio` (+ `pgsty/mc`) แทน `minio/minio` | MinIO หยุดเผยแพร่ Docker image ทางการ (`minio/minio`, `quay.io/minio/minio` ดึงไม่ได้แล้ว); pgsty เป็น fork ที่ยังดูแลอยู่ ใช้ binary/S3 API เดิม — โค้ดฝั่งแอปไม่เปลี่ยน, ทบทวนอีกครั้งก่อน Phase 6 |
| 2026-10-31 | TypeScript 5.9 (ยังไม่ใช้ TS 7) | ts-jest, typescript-eslint และ NestJS CLI 10 ยังไม่รองรับ TS ≥ 6.1/7 |
| 2026-10-31 | `packages/shared` build คู่ ESM + CJS ลง `dist/` (conditional `exports`) | Vite ต้องการ ESM, NestJS/Jest เป็น CommonJS — script root `dev`/`typecheck`/`test` build shared ให้ก่อน |
| 2026-10-31 | Frontend dev เรียก API ผ่าน Vite proxy (`/api`, `/socket.io`) ด้วย path สัมพัทธ์ `/api/v1` | ให้ dev ตรงกับ production ที่ Nginx proxy, ไม่ต้องมี env URL ฝั่ง frontend |
| 2026-10-31 | เพิ่ม env `PORT` (default 3000) | กำหนด port API ได้โดยไม่แก้โค้ด |
| 2026-10-31 | Prisma 7.10 + driver adapter `@prisma/adapter-pg`, client generate ลง `apps/api/src/generated/prisma` (gitignore, CJS) | Prisma 7 ไม่มี Rust query engine แล้ว ต้องใช้ adapter; ไฟล์ generate ไม่ commit — root `pnpm codegen` สร้างให้ก่อน dev/typecheck/test |
| 2026-10-31 | Partial index ทั้ง 4 ตัวประกาศใน `schema.prisma` ด้วย preview feature `partialIndexes` แทน raw SQL migration | raw SQL ที่ไม่อยู่ใน schema ถูก `prisma migrate` มองเป็น drift และสร้าง `DROP INDEX` ใน migration ถัดไป — ต้องเขียน predicate รูป `= ANY (ARRAY[...])` (รูปที่ PG normalize) ไม่งั้นยัง drift; CI ตรวจ `migrate diff --exit-code` |
| 2026-10-31 | เพิ่ม `market_id` ใน `market_days` | บังคับ "วันขายไม่ซ้ำต่อตลาด" ด้วย unique index ได้ (เดิมมีแค่ `round_id`) |
| 2026-10-31 | ใช้ `bcryptjs` (pure JS) แทน `bcrypt` (native) | ไม่ต้อง build native module บน Windows/Alpine; hash `$2b$` ใช้แทนกันได้ cost 12 เท่าเดิม |
| 2026-10-31 | Postgres ใน docker-compose ใช้ host port **5433** (`POSTGRES_PORT`) | เครื่อง dev Windows มักมี PostgreSQL ติดตั้งอยู่ที่ 5432 แล้วชนกัน (เจอจริงตอน Phase 1.1) |
| 2026-10-31 | Integration test ใช้ DB แยก (`*_test`, สร้างอัตโนมัติ) + `TRUNCATE` ระหว่าง test, รันด้วย `--experimental-vm-modules` | ไม่แตะข้อมูล dev; Prisma 7 โหลด WASM ด้วย dynamic `import()` ซึ่ง Jest CJS ต้องเปิด vm modules |

### Open Questions
- [ ] ใช้กับตลาดเดียวหรือหลายตลาด (ตอนนี้ schema รองรับแล้ว แต่ UI ยังเป็นตลาดเดียว)
- [ ] ผู้ให้บริการ SMS ที่จะใช้
- [ ] ต้องการระบบ Lottery/Waiting Room ตั้งแต่ต้นหรือไม่ (ขึ้นกับจำนวนผู้ค้าที่คาด)
