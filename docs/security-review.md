# Security Review — Phase 11.5

> ทบทวนเมื่อ 2026-11-02 ตาม **OWASP Top 10 (2021)** + dependency audit — อ่านโค้ดจริงและทดสอบที่มีอยู่ ไม่ใช่ penetration test
> ทำซ้ำก่อนเปิดใช้จริงและทุกครั้งที่เพิ่ม endpoint/ผู้ให้บริการภายนอก

## สรุป

| | ผล |
|---|---|
| ช่องโหว่ที่พบและแก้ในรอบนี้ | dependency ทางอ้อมใน runtime 5 ตัว (pnpm `overrides`), ไม่มี CSP/Permissions-Policy ที่ nginx (เพิ่มแล้ว — CSP แบบ Report-Only) |
| ยอมรับความเสี่ยง (มีเหตุผลด้านล่าง) | `@nestjs/core` (SSE — ไม่ได้ใช้), `file-type`, `uuid`, `deepmerge`, `minimatch` ใน production; dev tooling (`@nestjs/cli`, jest, eslint) |
| CI | `pnpm audit --prod --audit-level high` — high/critical ใน dependency ของ production = CI ไม่ผ่าน |
| ต้องทำก่อนเปิดใช้จริง | เปลี่ยน CSP เป็นบังคับหลังตรวจ console บน production, ตรวจ backup/secret ตาม runbook §10, ยืนยันนโยบายเก็บข้อมูลกับฝ่ายกฎหมาย |

## OWASP Top 10 (2021)

| # | หมวด | สิ่งที่ระบบทำ (ที่อยู่ในโค้ด) | ผล |
|---|---|---|---|
| A01 | Broken Access Control | ทุก request ผ่าน guard: token (`JwtAuthGuard`), ประเภทผู้ใช้ (`@ActorTypes`) และสิทธิ์ admin (`AccessGuard` + `@RequirePermission` ตาราง `PERMISSION_ROLES` ใน shared), ผู้ค้าที่อนุมัติแล้ว (`VendorApprovedGuard` อ่านสถานะจาก DB ทุกครั้ง); ข้อมูลของผู้ค้าค้นด้วย `vendorId` ของ token เสมอ (ของคนอื่น = 404) และของ admin จำกัดด้วย `marketId` (`MarketService.resolveForAdmin`); socket `md:join` ตรวจว่าวันขายอยู่ในตลาดของตัวเอง; ไฟล์เข้าถึงด้วย presigned URL อายุ 5 นาที, key ตรวจว่าเป็นของผู้ค้า/การจองนั้น | ✅ มี integration test "ของคนอื่น = 404 / STAFF 403" แทบทุก module |
| A02 | Cryptographic Failures | HTTPS (HSTS 1 ปี) ที่ nginx; รหัส admin `bcryptjs` cost 12; OTP / refresh token เก็บเป็น HMAC-SHA256; refresh cookie `httpOnly` + `secure` + `SameSite=Strict` + path จำกัด; secret ใน production ต้องยาว ≥ 32 (env schema); token monitoring เทียบแบบเวลาคงที่ (`timingSafeEqual`) | ✅ |
| A03 | Injection | SQL ผ่าน Prisma และ `$queryRaw` แบบ tagged template เท่านั้น (ไม่มี `$queryRawUnsafe`/`Prisma.raw`); input ทุกตัวผ่าน Zod (`nestjs-zod`, `.strict()`); React escape ข้อความเสมอ (ประกาศใช้ `whitespace-pre-line` ไม่ใช้ `dangerouslySetInnerHTML`); ไม่มี `eval`/`child_process` | ✅ |
| A04 | Insecure Design | กันจองซ้ำด้วย partial unique index + advisory lock; rate limit ต่อ IP (Redis) + ต่อเบอร์/บัญชี (OTP cooldown 60 วินาที, 5 ครั้ง/รหัส, ต่อชั่วโมง; admin ล็อคหลังกรอกผิด); Waiting Room กั้นการจองตอนคนแน่น; สลิปซ้ำตรวจด้วย hash + เลขอ้างอิง; ลบบัญชีต้องยืนยันด้วยเบอร์ | ✅ |
| A05 | Security Misconfiguration | Helmet ใน API; nginx: HSTS, `nosniff`, `X-Frame-Options: DENY`, Referrer-Policy, **Permissions-Policy (เพิ่ม)**, **CSP Report-Only (เพิ่ม)**; Swagger ปิดใน production; CORS เฉพาะโดเมนเว็บ/หลังบ้าน; error ตอบรูปแบบเดียวไม่มี stack; เปิดออก internet เฉพาะ 80/443 — DB/Redis/MinIO/Grafana อยู่ใน network ภายใน/localhost; `/api/v1/metrics`, `/api/v1/internal/*` nginx ตอบ 404 | ⚠️ CSP ยังเป็น Report-Only (ดูด้านล่าง) |
| A06 | Vulnerable and Outdated Components | `pnpm audit` 38 → 15 รายการ (production: high 0) ด้วย `overrides` ใน `pnpm-workspace.yaml`; CI ตรวจทุก push; pnpm ไม่รัน install script ที่ไม่อนุญาต (`allowBuilds`) และไม่ติดตั้งเวอร์ชันที่เพิ่งออก (minimum release age) | ⚠️ ที่เหลือดู "ยอมรับความเสี่ยง" |
| A07 | Identification and Authentication Failures | ผู้ค้าเข้าด้วย OTP (เบอร์) หรือ LINE (ตรวจ ID token กับ LINE); admin รหัสผ่าน ≥ 10 ตัว + ล็อคชั่วคราว; access token 15 นาที, refresh rotation (ใช้ token เก่าซ้ำ = revoke ทั้ง family), logout/เปลี่ยนรหัส/ลบบัญชี = revoke ทุกเครื่อง | ✅ |
| A08 | Software and Data Integrity Failures | ไม่โหลด script จาก CDN (bundle ทั้งหมด); lockfile + `--frozen-lockfile` ใน CI/Docker; webhook ของ LINE ตรวจลายเซ็น (`LINE_MESSAGING_CHANNEL_SECRET`); webhook ของ Alertmanager ต้องมี token; ไฟล์อัปโหลดตรวจ magic bytes + ขนาด | ✅ |
| A09 | Security Logging and Monitoring Failures | audit log ทุก action ของ admin/ระบบ (ไม่เก็บ password/token — `redact`); log JSON พร้อม request id; ไม่ log OTP (ยกเว้น mock SMS ใน dev); Prometheus alert error rate/latency/queue → LINE เจ้าหน้าที่ + Uptime Kuma | ✅ |
| A10 | Server-Side Request Forgery | API เรียกภายนอกเฉพาะ URL คงที่ (LINE, ThaiBulkSMS, SlipOK) — ไม่มี URL จากผู้ใช้; รูปสลิปส่ง SlipOK เป็นไฟล์ (ไม่ส่ง URL) | ✅ |

## Dependency audit

`pnpm audit` (2026-11-02): ก่อนแก้ low 6 / moderate 17 / high 15 → หลังแก้ low 4 / moderate 8 / high 3 (production: low 1 / moderate 5 / high 0)

แก้ด้วย `overrides` (major เดิม — ไม่เปลี่ยนพฤติกรรม): `body-parser` 1.20.9, `qs` 6.17.1, `multer` 2.5.0, `lodash` 4.18.1, `js-yaml` 4.3.2 — test ทั้งชุดผ่านหลังแก้

### ยอมรับความเสี่ยง (production)

| Package | Advisory | เหตุผล |
|---|---|---|
| `@nestjs/core` 10.x | GHSA-36xv-jgw5-4q75 (SSE `type`/`id` ไม่กรองขึ้นบรรทัดใหม่) | ไม่ได้ใช้ SSE (`@Sse`) — realtime ใช้ Socket.IO; แก้แค่ใน 11.1.18 (ยังใช้ Nest 10 เพราะ `nestjs-pino`/NestJS CLI — Decision Log) |
| `file-type` (ผ่าน `@nestjs/common`) | ASF parser / ZIP bomb | ใช้เฉพาะ `FileTypeValidator` ของ Nest ซึ่งระบบไม่ได้ใช้ (ตรวจรูปเองด้วย magic bytes); แก้ต้องขึ้น major 21 (ESM) |
| `uuid` (ผ่าน `exceljs`) | ตรวจ bounds ใน v3/v5/v6 เมื่อส่ง buffer | exceljs ใช้ v4 ไม่ส่ง buffer |
| `deepmerge` (ผ่าน `nestjs-zod`) | prototype poisoning ของผลลัพธ์ | ใช้ตอนสร้างเอกสาร OpenAPI จาก schema ของเราเอง ไม่ใช่ input ของผู้ใช้ (Swagger ปิดใน production) |
| `minimatch` (ผ่าน `exceljs` → archiver) | ReDoS ของ pattern | pattern มาจากโค้ดของ library ไม่ใช่ผู้ใช้ |

### Dev tooling (ไม่อยู่ใน image production — `pnpm install --prod`)
`@nestjs/cli` (tmp, glob, webpack, ajv, picomatch), jest (glob), eslint (minimatch) — ใช้ตอนพัฒนา/CI กับไฟล์ของเราเอง ทบทวนอีกครั้งเมื่ออัปเกรด NestJS 11

## ที่ต้องทำต่อ

1. **CSP บังคับใช้**: nginx ส่ง `Content-Security-Policy-Report-Only` อยู่ — หลัง deploy เปิดเว็บผู้ค้า (รวม LINE login, ผัง, หน้าชำระ, QR เช็คอิน) และหลังบ้าน (Map Editor, เช็คอินด้วยกล้อง, ตรวจสลิป) ดู DevTools Console ว่าไม่มี "violates the following Content Security Policy" แล้วเปลี่ยนชื่อ header เป็น `Content-Security-Policy` ใน `docker/nginx/templates/security.inc.template`
2. อัปเกรด NestJS 11 เมื่อ `nestjs-pino`/CLI รองรับ — ปิด advisory ของ `@nestjs/core`/`file-type`/`multer` ที่เหลือ
3. ทดสอบเจาะระบบ (penetration test) โดยบุคคลภายนอกก่อนใช้กับผู้ค้าจำนวนมาก
4. ทบทวน `RETENTION_DAYS` และนโยบายความเป็นส่วนตัวกับเจ้าของตลาด/ฝ่ายกฎหมาย
