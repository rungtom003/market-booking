#!/bin/sh
# Restore ฐานข้อมูลจากไฟล์ backup (pg_dump custom format) — รันบน VPS จากโฟลเดอร์ใดก็ได้
#   docker/scripts/restore.sh docker/backups/market_booking-20261101T200000Z.dump
# ขั้นตอน: backup ข้อมูลปัจจุบันไว้ก่อน → หยุด api → สร้าง DB ใหม่ → pg_restore → migrate → start api
# ตั้ง RESTORE_CONFIRM=yes เพื่อข้ามคำถามยืนยัน (ใช้ในการทดสอบ)
set -eu

if [ $# -ne 1 ] || [ ! -f "$1" ]; then
  echo "usage: $0 <backup-file.dump>" >&2
  exit 2
fi
file=$(cd "$(dirname "$1")" && pwd)/$(basename "$1")

cd "$(dirname "$0")/.."
. ./scripts/lib.sh

# ตรวจว่าเป็นไฟล์ pg_dump ที่อ่านได้ก่อนลบอะไร
$compose exec -T postgres pg_restore --list < "$file" > /dev/null

echo "จะแทนที่ฐานข้อมูลทั้งหมดด้วย: $file"
if [ "${RESTORE_CONFIRM:-}" != "yes" ]; then
  printf 'พิมพ์ yes เพื่อยืนยัน: '
  read -r answer
  [ "$answer" = "yes" ] || { echo "ยกเลิก"; exit 1; }
fi

echo "==> backup ข้อมูลปัจจุบันก่อน restore (ย้อนกลับได้)"
$compose run --rm --no-deps backup once

echo "==> หยุด api"
$compose stop api

echo "==> สร้างฐานข้อมูลใหม่และ restore"
# --force ตัด connection ที่ค้าง (PostgreSQL 13+)
$compose exec -T postgres sh -c \
  'dropdb --force --username="$POSTGRES_USER" "$POSTGRES_DB" && createdb --username="$POSTGRES_USER" "$POSTGRES_DB"'
$compose exec -T postgres sh -c \
  'pg_restore --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --no-owner --exit-on-error' < "$file"

echo "==> migrate (backup อาจเก่ากว่า schema ปัจจุบัน) และ start api"
$compose up -d --wait api
$compose ps api
echo "restore เสร็จ — ตรวจด้วย: curl -fsS https://\$WEB_DOMAIN/api/v1/health/ready"
