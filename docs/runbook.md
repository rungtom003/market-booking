# Runbook — ระบบจองล็อคตลาด (Production)

> คู่มือ deploy และดูแลระบบบน VPS เครื่องเดียวด้วย Docker Compose
> ไฟล์ที่เกี่ยวข้องทั้งหมดอยู่ใน `docker/` — คำสั่งในเอกสารนี้รันจาก root ของ repo บน VPS

## สารบัญ
1. [ภาพรวม](#1-ภาพรวม)
2. [เตรียม VPS](#2-เตรียม-vps)
3. [Deploy ครั้งแรก](#3-deploy-ครั้งแรก)
4. [ตั้งค่า LINE Login (LIFF)](#4-ตั้งค่า-line-login-liff)
5. [Deploy เวอร์ชันใหม่](#5-deploy-เวอร์ชันใหม่)
6. [Rollback](#6-rollback)
7. [Backup และ Restore](#7-backup-และ-restore)
8. [Monitoring และ Log](#8-monitoring-และ-log)
9. [จัดการ Admin](#9-จัดการ-admin)
10. [เปลี่ยน Secret](#10-เปลี่ยน-secret)
11. [แก้ปัญหาที่พบบ่อย](#11-แก้ปัญหาที่พบบ่อย)
12. [ข้อจำกัดที่ต้องรู้](#12-ข้อจำกัดที่ต้องรู้)

---

## 1. ภาพรวม

```
Internet ──► :80/:443  nginx ─┬─ https://WEB_DOMAIN    static apps/web   + /api, /socket.io → api
                              │                         + /<bucket>/…   → minio (presigned URL)
                              └─ https://ADMIN_DOMAIN  static apps/admin + /api, /socket.io → api
            network ภายใน:  api ──► postgres, redis, minio
            one-shot:       migrate (prisma migrate deploy ทุกครั้งที่ start), minio-init (สร้าง bucket)
            เบื้องหลัง:      certbot (ต่ออายุ cert), backup (pg_dump รายวัน), uptime-kuma (ไม่บังคับ)
```

| ไฟล์ | หน้าที่ |
|---|---|
| `docker/docker-compose.prod.yml` | service ทั้งหมด (project `market-booking-prod`) |
| `docker/.env` | ค่าจริงของ production — **ไม่อยู่ใน git**, สร้างจาก `docker/.env.example` |
| `docker/api.Dockerfile` | image `api` (runtime) และ `api-tools` (migrate/seed/สคริปต์) |
| `docker/nginx/` | image `nginx` (build web + admin) + config |
| `docker/scripts/deploy.sh` | build → backup → migrate → start |
| `docker/scripts/rollback.sh` | ย้อน api + nginx ไป image ก่อนหน้า |
| `docker/scripts/restore.sh` | restore DB จากไฟล์ backup |
| `docker/scripts/init-ssl.sh` | ออก cert Let's Encrypt ครั้งแรก |
| `docker/scripts/backup.sh` | ใช้ภายใน service `backup` |
| `docker/backups/` | ไฟล์ backup (`market_booking-<UTC>.dump`) |
| `docker/deploy-history.log` | ประวัติ deploy/rollback (tag = git commit) |

Volume ของ Docker: `postgres-data`, `redis-data`, `minio-data` (สลิป/รูป), `letsencrypt`, `certbot-www`, `uptime-kuma-data` — `docker compose down` ไม่ลบ volume (**ห้ามใช้ `down -v`**)

ตั้ง alias ไว้พิมพ์สั้นลง (ใช้ในเอกสารนี้):
```bash
alias dc='docker compose -f docker/docker-compose.prod.yml'
```

---

## 2. เตรียม VPS

สเปกขั้นต่ำ: **2 vCPU / 4 GB RAM / 40 GB SSD**, Ubuntu 24.04 LTS (ตาม NFR: 500 concurrent connections)

```bash
# 1) อัปเดต + ผู้ใช้สำหรับ deploy (ไม่ใช้ root)
sudo apt update && sudo apt upgrade -y
sudo adduser deploy && sudo usermod -aG sudo deploy

# 2) Docker Engine + Compose plugin (ตามคู่มือทางการ https://docs.docker.com/engine/install/ubuntu/)
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker deploy        # logout/login ใหม่ให้มีผล
docker compose version                # ต้องเป็น v2.24 ขึ้นไป

# 3) Firewall — เปิดเฉพาะ SSH, HTTP, HTTPS
sudo ufw allow OpenSSH && sudo ufw allow 80/tcp && sudo ufw allow 443/tcp && sudo ufw enable

# 4) Swap 2 GB — กัน build (Vite/Nest) ใช้ RAM เกินบนเครื่อง 4 GB
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

**DNS:** สร้าง A record ของ `WEB_DOMAIN` และ `ADMIN_DOMAIN` (เช่น `market.example.com`, `admin.market.example.com`) ชี้ไป IP ของ VPS — ตรวจด้วย `dig +short market.example.com`

---

## 3. Deploy ครั้งแรก

```bash
# 1) โค้ด
git clone https://github.com/rungtom003/market-booking.git && cd market-booking

# 2) ค่า production
cp docker/.env.example docker/.env && chmod 600 docker/.env
openssl rand -hex 32          # รันหลายครั้ง ใช้เป็น POSTGRES_PASSWORD, JWT_ACCESS_SECRET,
                              # JWT_REFRESH_SECRET, MINIO_SECRET_KEY (คนละค่ากัน)
nano docker/.env              # ใส่โดเมน, LETSENCRYPT_EMAIL, secret, SEED_ADMIN_PASSWORD (≥ 12 ตัว)

# 3) build + start (ครั้งแรกยังไม่มี cert จริง — nginx ใช้ self-signed ชั่วคราว)
docker/scripts/deploy.sh

# 4) ข้อมูลเริ่มต้น: ตลาด, SUPER_ADMIN, ประเภทสินค้า, โซน/ล็อคตัวอย่าง, ค่าตั้งค่า (รันซ้ำได้ — มีตลาดแล้วจะข้าม)
dc run --rm migrate pnpm exec prisma db seed

# 5) cert Let's Encrypt (DNS ต้องชี้มาแล้ว) — ลองกับ staging ก่อนได้: LETSENCRYPT_STAGING=1 docker/scripts/init-ssl.sh
docker/scripts/init-ssl.sh
```

**ตรวจหลัง deploy** (ทุกข้อต้องผ่าน):
```bash
dc ps                                                     # ทุก service Up (healthy); migrate/minio-init Exited (0)
curl -fsS https://$WEB_DOMAIN/api/v1/health/ready         # {"data":{"status":"ok","database":"ok","redis":"ok"}}
curl -sI http://$WEB_DOMAIN | head -1                     # 301 → https
```
- เปิด `https://ADMIN_DOMAIN` → login ด้วย `SEED_ADMIN_USERNAME` / `SEED_ADMIN_PASSWORD`
- **ทันทีหลัง login:** เปลี่ยนรหัส SUPER_ADMIN ในหน้า "ผู้ดูแลระบบ" แล้ว **ลบ `SEED_ADMIN_PASSWORD` ออกจาก `docker/.env`**
- หน้า "ตั้งค่าระบบ": ตั้ง `promptpay_id`, เวลาชำระเงิน ฯลฯ — หน้า "ล็อคและผังตลาด"/"โซน": แก้ชื่อตลาด/ล็อคตัวอย่างจาก seed ให้ตรงของจริง
- เปิด `https://WEB_DOMAIN` บนมือถือ → หน้า login แสดงปกติ

---

## 4. ตั้งค่า LINE Login (LIFF)

ผู้ค้าเข้าสู่ระบบด้วย LINE ได้เมื่อตั้งค่าครบ (ไม่ตั้ง = ซ่อนปุ่ม LINE)

1. [LINE Developers Console](https://developers.line.biz/console/) → Provider → สร้าง channel **LINE Login**
   - **Callback URL:** `https://WEB_DOMAIN/`
   - เปิด **OpenID Connect** (ต้องใช้ ID token) — ขอสิทธิ์อีเมลไม่จำเป็น
2. ใน channel เดียวกัน แท็บ **LIFF** → Add
   - Size: `Full`, **Endpoint URL:** `https://WEB_DOMAIN/`
   - Scopes: `openid`, `profile`
3. ใส่ค่าใน `docker/.env`:
   ```
   LINE_LOGIN_CHANNEL_ID=<Channel ID ของ LINE Login channel>
   LINE_LIFF_ID=<LIFF ID เช่น 1234567890-AbCdEfGh>
   ```
4. `docker/scripts/deploy.sh` — LIFF ID ฝังในหน้าเว็บตอน build จึงต้อง build ใหม่ทุกครั้งที่เปลี่ยน
5. ตรวจ: เปิด `https://WEB_DOMAIN/login` → มีปุ่ม LINE → login สำเร็จ
6. เมื่อทดสอบเสร็จ เปลี่ยนสถานะ channel จาก **Developing** เป็น **Published** (ไม่งั้นใช้ได้เฉพาะบัญชี tester)

> เปลี่ยนโดเมนภายหลัง: แก้ Callback URL + Endpoint URL ใน Console ให้ตรงโดเมนใหม่ด้วย

---

## 5. Deploy เวอร์ชันใหม่

```bash
cd market-booking
git pull --ff-only
docker/scripts/deploy.sh
```
สิ่งที่สคริปต์ทำ:
1. build image ติด tag = git commit (`market-booking/api:<sha>`, `api-tools`, `nginx`) — ไม่ build ถ้ามีไฟล์แก้ค้าง
2. **backup DB ก่อน deploy** (`docker/backups/`)
3. จด `IMAGE_TAG=<sha>` ลง `docker/.env` (คำสั่ง `dc` หลังจากนี้ใช้ image ชุดนี้) → `up -d --wait`: `migrate` รัน `prisma migrate deploy` ก่อน `api` start, nginx รอ api healthy, สคริปต์จบเมื่อทุก service healthy
4. บันทึก tag ลง `docker/deploy-history.log`

ระหว่าง deploy api restart ~10 วินาที (ผู้ใช้เห็น "กำลังเชื่อมต่อใหม่" แล้วโหลดข้อมูลใหม่เอง) — **ห้าม deploy ช่วงเปิดรอบจอง**

ตรวจหลัง deploy เหมือนข้อ 3 แล้วดู log: `dc logs --since 5m api`

ล้าง image เก่า (เก็บไว้ rollback อย่างน้อย 2–3 เวอร์ชัน): `docker image ls "market-booking/*"` แล้ว `docker image rm market-booking/{api,api-tools,nginx}:<sha เก่า>`

---

## 6. Rollback

```bash
tail docker/deploy-history.log              # หา tag ที่ใช้ได้ก่อนหน้า
docker/scripts/rollback.sh <tag>            # ย้อน api + nginx (ไม่รัน migrate, ไม่แตะ DB) และจด IMAGE_TAG ใหม่ใน docker/.env
```
- **migration ไม่ถูกย้อน** — ปกติ migration เป็นแบบเพิ่ม (column/table ใหม่) โค้ดเก่าใช้ต่อได้
- ถ้าเวอร์ชันใหม่เปลี่ยน schema แบบที่โค้ดเก่าใช้ไม่ได้ หรือข้อมูลเสียหาย: restore backup ที่ทำตอน deploy (ไฟล์ล่าสุดก่อนเวลา deploy ใน `docker/backups/`) ตามข้อ 7 แล้วค่อย rollback
- เมื่อแก้แล้ว deploy ใหม่ตามปกติ (`git checkout main && git pull && docker/scripts/deploy.sh`)

---

## 7. Backup และ Restore

### Backup อัตโนมัติ
- service `backup` รัน `pg_dump` ทุกวันเวลา `BACKUP_TIME` (UTC, ค่าเริ่มต้น `20:00` = 03:00 น. เวลาไทย)
- เก็บ `BACKUP_KEEP_DAYS` วัน (14) ที่ `docker/backups/market_booking-<YYYYMMDDTHHMMSSZ>.dump` — ไฟล์เก่ากว่านั้นถูกลบเอง
- backup ทันที: `dc run --rm --no-deps backup once`
- ดูผล: `dc logs backup` และ `ls -lh docker/backups/`

**สำเนานอกเครื่อง (ต้องทำ):** backup ที่อยู่บน VPS เดียวกันไม่ช่วยถ้าเครื่องเสีย — ตั้ง cron บนเครื่องอื่นดึงไปเก็บ เช่น
```bash
# บนเครื่องเก็บสำรอง: ทุกวัน 04:00
0 4 * * * rsync -a deploy@VPS:market-booking/docker/backups/ /srv/market-booking-backups/
```

**ไฟล์สลิป/รูป (MinIO)** ไม่อยู่ใน pg_dump — สำรอง volume สัปดาห์ละครั้ง:
```bash
docker run --rm -v market-booking-prod_minio-data:/data:ro -v "$PWD/docker/backups:/out" alpine \
  tar czf /out/minio-$(date -u +%Y%m%d).tar.gz -C /data .
```

### Restore
```bash
ls -lh docker/backups/
docker/scripts/restore.sh docker/backups/market_booking-20261101T200000Z.dump
```
ขั้นตอนในสคริปต์: ตรวจไฟล์ → ถามยืนยัน (`yes`) → **backup ข้อมูลปัจจุบันก่อน** (ย้อนกลับได้) → หยุด api → สร้าง DB ใหม่ → `pg_restore` → migrate (ถ้า backup เก่ากว่า schema) → start api และรอจน healthy

หลัง restore:
- การจองที่สร้างหลังเวลา backup หายไป — ตรวจรายการชำระเงิน/สลิปที่เข้ามาหลังเวลานั้นกับธนาคาร
- session ผู้ใช้ยังอยู่ (เก็บใน Redis) แต่บัญชีที่สร้างหลัง backup จะใช้ไม่ได้

**ซ้อม restore เดือนละครั้ง** (บนเครื่องทดสอบ ไม่ใช่ production): deploy ตามข้อ 3 → copy ไฟล์ backup ล่าสุดมา → `restore.sh` → login admin ดูข้อมูลล่าสุด

---

## 8. Monitoring และ Log

### Endpoint ตรวจสุขภาพ
| URL | ใช้กับ | ความหมาย |
|---|---|---|
| `https://WEB_DOMAIN/api/v1/health` | docker healthcheck | process api ตอบได้ |
| `https://WEB_DOMAIN/api/v1/health/ready` | uptime monitor | ต่อ PostgreSQL + Redis ได้ (ไม่ได้ → 503 พร้อมบอกว่าตัวไหน) |

### Uptime Kuma
แนะนำให้รัน **บนเครื่องอื่น** (ถ้า VPS ล่ม monitor บนเครื่องเดียวกันก็ล่มด้วย) — หรือใช้ตัวที่มากับ compose:
```bash
dc --profile monitoring up -d uptime-kuma
ssh -L 3001:localhost:3001 deploy@VPS        # แล้วเปิด http://localhost:3001 บนเครื่องตัวเอง (ไม่เปิดออก internet)
```
Monitor ที่ควรตั้ง:
1. **HTTP(s) - Keyword** `https://WEB_DOMAIN/api/v1/health/ready` keyword `"database":"ok"` ทุก 60 วินาที
2. **HTTP(s)** `https://ADMIN_DOMAIN/` — เปิด "Certificate Expiry Notification" (แจ้งก่อน cert หมดอายุ)
3. **Push** (backup) — Heartbeat Interval 26 ชั่วโมง → ใส่ URL ที่ได้เป็น `BACKUP_PUSH_URL` ใน `docker/.env` แล้ว `dc up -d backup` (ไม่ได้รับ push = backup ไม่ทำงาน)
4. ช่องทางแจ้งเตือน (Settings → Notifications): LINE Messaging API / Telegram / Email ตามที่ทีมใช้

### Log
- ทุก container เขียน log แบบ json-file หมุนไฟล์ **10 MB × 5 ไฟล์** ต่อ container (ไม่ทำให้ดิสก์เต็ม)
- ดู log: `dc logs -f --since 10m api` / `dc logs nginx | grep ' 5[0-9][0-9] '`
- API log เป็น JSON (pino) — field `req.id` ตรงกับ header `x-request-id` ของ response (ใช้ตามหา request ที่ผู้ใช้แจ้งปัญหาได้)
- ห้าม log OTP/รหัสผ่าน/token (ระบบไม่ log อยู่แล้ว) — ระวังตอน debug อย่าตั้ง `LOG_LEVEL=trace` ทิ้งไว้

---

## 9. จัดการ Admin

- **เพิ่ม/แก้/ปิดบัญชีเจ้าหน้าที่:** login เป็น SUPER_ADMIN → เมนู "ผู้ดูแลระบบ" → เพิ่มผู้ใช้ (เลือก role: ADMIN / STAFF / FINANCE) — การปิดบัญชีตัด session ทันที
- **SUPER_ADMIN ลืมรหัส** (ไม่มี SUPER_ADMIN คนอื่นรีเซ็ตให้):
  ```bash
  dc run --rm -e ADMIN_USERNAME=admin -e ADMIN_PASSWORD='<รหัสใหม่ ≥ 12 ตัว>' \
    migrate pnpm exec tsx scripts/reset-admin-password.ts
  ```
  เปิดบัญชีที่ถูกปิดให้ด้วย และลง audit log (`admin_user.reset_password_cli`) — ใส่ช่องว่างนำหน้าคำสั่งเพื่อไม่ให้รหัสติดใน shell history (`HISTCONTROL=ignorespace`)
- login ผิดเกินกำหนดถูกล็อคชั่วคราว (นับใน Redis) — รอให้หมดเวลา

---

## 10. เปลี่ยน Secret

ทุกครั้ง: แก้ `docker/.env` แล้วรันคำสั่งของแต่ละตัวด้านล่าง (ไม่ต้อง build ใหม่)

| Secret | คำสั่ง | ผลกระทบ |
|---|---|---|
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | `dc up -d api` | ทุกคน (ผู้ค้า + admin) ต้อง login ใหม่ — ใช้เมื่อสงสัยว่า token รั่ว |
| `POSTGRES_PASSWORD` | ดูด้านล่าง | ไม่มี downtime เกิน restart api |
| `MINIO_SECRET_KEY` | `dc up -d minio minio-init api` | presigned URL ที่ออกไปแล้วใช้ไม่ได้ (อายุสั้นอยู่แล้ว) |
| `LINE_*` | `docker/scripts/deploy.sh` (LIFF ID ฝังในหน้าเว็บ) | — |

เปลี่ยนรหัส PostgreSQL (ค่าใน `.env` ใช้ตอนสร้าง DB ครั้งแรกเท่านั้น จึงต้อง ALTER เองก่อน):
```bash
NEW=$(openssl rand -hex 32)
dc exec postgres psql -U market -d market_booking -c "ALTER USER market PASSWORD '$NEW'"
sed -i "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$NEW/" docker/.env
dc up -d api backup
```

---

## 11. แก้ปัญหาที่พบบ่อย

| อาการ | ตรวจ / แก้ |
|---|---|
| เว็บขึ้น 502 | `dc ps api` — ไม่ healthy ดู `dc logs --tail 100 api`; env ผิดรูปแบบ api จะหยุดตอน boot พร้อมบอกชื่อตัวแปร |
| `migrate` Exited (1) | `dc logs migrate` — migration ล้ม: แก้ตามข้อความ หรือ rollback + restore backup ก่อน deploy |
| เบราว์เซอร์เตือน cert ไม่ปลอดภัย | ยังใช้ self-signed: `dc logs nginx | grep certificate` → รัน `docker/scripts/init-ssl.sh` (DNS + port 80 ต้องพร้อม) |
| ออก cert ไม่ผ่าน | `dig +short WEB_DOMAIN` ต้องได้ IP ของ VPS, `curl http://WEB_DOMAIN/healthz` จากนอกเครื่องต้องได้ `ok`; Let's Encrypt จำกัด 5 ครั้ง/สัปดาห์ — ทดลองด้วย `LETSENCRYPT_STAGING=1` |
| ผังไม่อัปเดตแบบ realtime | DevTools → Network → WS ต้องเห็น `/socket.io/` สถานะ 101; ถ้ามี proxy/CDN อื่นหน้า nginx ต้องเปิด WebSocket |
| อัปโหลดสลิป/รูปไม่ได้ | `dc ps minio minio-init` (minio-init ต้อง Exited 0); `MINIO_BUCKET` ใน `.env` ต้องตรงกับที่ nginx proxy (`/<bucket>/`) |
| ผู้ค้าขอ OTP แล้วขึ้น "บริการไม่พร้อมใช้งาน" | ยังไม่มีผู้ให้บริการ SMS จริง (ข้อ 12) — ให้ใช้ LINE |
| rate limit (429) โดนทั้งระบบพร้อมกัน | api ต้องเห็น IP จริงของผู้ใช้: `TRUST_PROXY: 1` ใน compose; ถ้าวาง proxy/CDN เพิ่มหน้า nginx ต้องเพิ่มค่านี้ตามจำนวนชั้น |
| ดิสก์ใกล้เต็ม | `docker system df`; ลบ image เก่า (ข้อ 5), `docker builder prune` |

---

## 12. ข้อจำกัดที่ต้องรู้

- **SMS OTP ยังไม่มีผู้ให้บริการจริง** (`SMS_PROVIDER=mock` ใช้ไม่ได้ใน production — API ตอบ `SERVICE_UNAVAILABLE`) ผู้ค้าต้องเข้าสู่ระบบด้วย **LINE** จนกว่า Phase 7 จะเพิ่ม SMS gateway
- API รัน 1 instance (Socket.IO ใช้ Redis adapter อยู่แล้ว เพิ่ม instance ได้ภายหลังโดยเพิ่ม service + upstream ใน nginx)
- Redis ไม่มีรหัสผ่าน — อยู่ใน network ภายในของ Docker เท่านั้น ห้ามเปิด port ออกนอกเครื่อง
- API ใช้ root credentials ของ MinIO (MVP) — แยก service account ภายหลังได้
