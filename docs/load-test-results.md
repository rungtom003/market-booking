# ผล Load Test — ช่วงเปิดรอบจอง (Phase 4.6)

> วันที่ทดสอบ: 2026-10-31 · commit ฐาน: `acf0c54` + การแก้ใน Phase 4.6
> เป้าหมาย: Overview §13 Non-functional

## สรุป

| เป้าหมาย (§13) | ผล (1 instance) | ผล (2 instance) | ผ่าน |
|---|---|---|:-:|
| ≥ 500 concurrent connections | socket 500/500 ต่อสำเร็จ, join ห้องวันขาย 500/500 | 500/500 | ✅ |
| `POST /bookings/hold` p95 < 300 ms ที่ 100 req/s | **18.8 ms** (p99 29 ms, error 0%) | **14.7 ms** (p99 20 ms) | ✅ |
| ผู้ใช้อื่นเห็นสถานะเปลี่ยน < 1 วินาที | `stall:updated` p95 **10 ms** (150,000 event ถึงครบ) | p95 15 ms (ข้าม instance ผ่าน Redis) | ✅ |
| 0 กรณีจองซ้ำ | การจองซ้ำ **0**, เกินโควตา **0**, HOLD = 300 = จำนวนล็อคพอดี | 0 / 0 | ✅ |

**ช่วงกดพร้อมกันตอนเปิดรอบ** (ไม่มีเป้าใน §13 — เป้าคือ 100 req/s): ผู้ค้า 500 คนกด "จอง" ในเวลาเดียวกัน
ได้คำตอบครบทุกคนใน ~1.6 วินาที (1 instance: p50 1.54 s / p95 1.62 s; 2 instance: p50 0.94 s / p95 1.61 s) — ไม่มี error

## สภาพแวดล้อม

- เครื่อง dev: Windows 11 (client), 20 logical CPU, RAM 15.6 GB — **ไม่ใช่ VPS 2 vCPU / 4 GB ตามเป้า** ผลจึงเป็นตัวชี้วัดเบื้องต้น ต้องวัดซ้ำบน VPS จริงใน Phase 6
- API: `node dist/main.js` (Node 24, NestJS 10, Prisma 7 + `@prisma/adapter-pg`, pool 10 ต่อ instance), worker BullMQ เปิดอยู่, `RATE_LIMIT_DISABLED=true` (k6 ยิงจาก IP เดียว — limit hold ต่อผู้ค้า 5 ครั้ง/10 วินาทียังทำงาน)
- Postgres 16 / Redis 7 ใน Docker Desktop (container เดียวกับ dev แต่ใช้ DB `market_booking_load` และ Redis db 13)
- k6 1.0.0 (Docker `grafana/k6`) ยิงเข้า host ผ่าน `host.docker.internal` — latency ที่ k6 วัดรวมเครือข่าย Docker Desktop (~140 ms ในช่วงกดพร้อมกัน, เทียบกับ request log ของ API)

## วิธีทดสอบ

`pnpm test:load` (`apps/api/scripts/load-test.ts` + `load-test/k6/booking-rush.js`)

1. ล้างแล้ว seed DB `*_load`: ผู้ค้า APPROVED 1,000 คน, ล็อค 300 ล็อค (โซนไม่จำกัดประเภท), รอบเปิดในอีก 40 วินาที จองได้ 1 ล็อค/วัน, วันขาย 1 วัน
2. **sockets** — ผู้ค้า 500 คนเปิดผังวันขายค้างไว้ (Socket.IO ผ่าน websocket, `md:join`) กระจายการต่อใน 15 วินาทีแรก นับ `stall:updated` และความหน่วง (`now - updatedAt`)
3. **open_rush** — ผู้ค้าอีก 500 คนโหลดผังก่อนเปิด (มี keep-alive connection) แล้วกด hold **พร้อมกัน** 1 วินาทีหลังเปิดรอบ; ครึ่งหนึ่งแย่ง 10 ล็อคยอดนิยม อีกครึ่งสุ่ม
4. **steady** — 100 req/s นาน 30 วินาที สุ่มผู้ค้าจากทั้ง 1,000 คน และสุ่มล็อค (วัด p95 ตามเป้า)
5. ตรวจ SQL หลังทดสอบ: active booking ซ้ำต่อ (ล็อค, วัน) และผู้ค้าที่เกิน `max_stalls_per_vendor`
6. เก็บ CPU/RAM ของ API ทุก 2 วินาที และ `docker stats` ของ Postgres/Redis

ปรับขนาดได้ด้วย env: `LOAD_API_INSTANCES`, `LOAD_DB_POOL`, `SOCKETS`, `RUSH_VUS`, `STEADY_RATE`, `STEADY_SECONDS`, `LOAD_API_LOG=1` (เก็บ request log ฝั่ง API)

## ผลละเอียด (รอบสุดท้าย)

| | 1 instance | 2 instance |
|---|---|---|
| HTTP requests ทั้งหมด | 4,001 | 4,001 |
| hold สำเร็จ / ล็อคถูกจองแล้ว / เกินโควตา / กดถี่เกิน (429) / ผิดปกติ | 300 / 2,359 / 841 / 1 / **0** | 300 / 2,309 / 888 / 4 / **0** |
| steady: avg / p95 / p99 / max | 10.3 / 18.8 / 29.2 / 54 ms | 10.2 / 14.7 / 20.2 / 38 ms |
| open_rush hold: min / p50 / p95 / max | 371 ms / 1.54 s / 1.62 s / 1.88 s | 238 ms / 0.94 s / 1.61 s / 1.72 s |
| socket ต่อสำเร็จ / ต่อใช้เวลา p95 | 500 / 3 ms | 500 |
| `stall:updated` ที่ได้รับ / p95 delay | 150,000 / 10 ms | 150,000 / 15 ms |
| CPU API (% ของ 1 core) peak / avg ช่วงทดสอบ | 95% / 26% | 76% / 31% (รวม 2 process) |
| RAM API peak (working set) | 497 MB | 911 MB (รวม 2 process) |
| Postgres CPU peak / RAM peak | 22% / 107 MiB | 75% / 130 MiB |
| Redis CPU peak / RAM peak | 5% / 11 MiB | 6% / 14 MiB |

ฝั่ง API (request log, 1 instance, รอบวัดแยก): ช่วงกดพร้อมกัน p50 1.53 s / p95 1.54 s, steady p95 15 ms — ความหน่วงช่วงกดพร้อมกันส่วนใหญ่อยู่ใน API ไม่ใช่เครือข่าย

## ปัญหาที่พบและการแก้

| ปัญหา | สาเหตุ | การแก้ |
|---|---|---|
| request ล้มแบบ `EOF` ~2% | Node `keepAliveTimeout` ค่าเริ่มต้น 5 วินาที — server ปิด connection ที่ client กำลังจะใช้ซ้ำ (หลัง Nginx ก็เกิดได้) | ตั้ง `keepAliveTimeout` 65 s / `headersTimeout` 66 s ใน `main.ts` (มากกว่า keepalive ของ Nginx) → 0 |
| socket/request `connection refused` เมื่อเปิด 500 connection พร้อมกัน, latency 1.3 s | Windows รุ่น client จำกัด listen backlog ที่ 200 → SYN ถูกทิ้งแล้ว retry 1 วินาที (สภาพแวดล้อมทดสอบ — Linux ใช้ 511 และ Nginx รับ connection แทน) | ทดสอบให้ใกล้ของจริง: ผู้ค้าเปิดผังกระจายกัน และกดจองบน keep-alive connection ที่เปิดไว้ตอนโหลดผัง |
| `VendorApprovedGuard` ทำ `UPDATE` ทุก request | ปลดการระงับที่หมดเวลาแบบเขียนก่อนอ่าน | อ่านก่อน เขียนเฉพาะเมื่อการระงับหมดเวลาจริง |
| hold ใช้ query มากเกินจำเป็น | `expireLapsed` 2 UPDATE, INSERT แล้วอ่าน relation ซ้ำ | UPDATE เดียว (OR), INSERT select เฉพาะคอลัมน์แล้วประกอบ DTO จากข้อมูลที่อ่านแล้ว — rush p95 1.81 → 1.62 s, steady p95 21 → 19 ms |
| pool size ไม่มีผล (10 vs 30: rush p95 1.81 s ทั้งคู่) | คอขวดคือ CPU ของ Node process เดียว (~330 hold/วินาที ต่อ instance บนเครื่องนี้) ไม่ใช่ connection | เพิ่ม env `DATABASE_POOL_SIZE` ไว้ปรับตอน deploy; ขยายด้วยหลาย instance (2 instance: p50 1.54 → 0.94 s) |

## ข้อเสนอสำหรับ Phase 6 (deploy)

- รัน API **2 instance** บน VPS 2 vCPU (PM2 cluster / 2 container) หลัง Nginx — ระบบ stateless และ socket ข้าม instance ผ่าน Redis แล้ว (ยืนยันด้วยรอบ 2 instance)
- Nginx: `keepalive_timeout` ฝั่ง upstream < 65 s, proxy `/socket.io` แบบ upgrade (client ใช้ websocket อย่างเดียว ไม่ต้อง sticky session)
- `DATABASE_POOL_SIZE` × จำนวน instance ≤ `max_connections` ของ Postgres (ค่าเริ่มต้น 100) — เผื่อ worker/migration
- วัดซ้ำบน VPS จริงด้วย `pnpm test:load` (ชี้ API/DB ด้วย env) และดู RAM: API ~500 MB ต่อ instance ตอน peak บนเครื่องนี้ — VPS 4 GB รับ 2 instance + Postgres + Redis ได้ แต่ควรตั้ง `--max-old-space-size`
- ช่วงกดพร้อมกัน ~1.6 วินาทีสำหรับ 500 คน ยังยอมรับได้ (UI แสดงสถานะ "กำลังจอง" แบบ optimistic) — ถ้าต้องการเร็วกว่านี้: เพิ่ม instance, ลด query ใน guard/settings ด้วย cache ต่อ request หรือรวม event fan-out เป็น batch (§10.3)
