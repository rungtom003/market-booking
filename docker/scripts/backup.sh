#!/bin/sh
# Backup PostgreSQL ด้วย pg_dump (custom format, บีบอัดในตัว) — รันใน service `backup` ของ docker-compose.prod.yml
#   backup.sh once     สำรองทันที 1 ครั้ง (deploy.sh / restore.sh เรียกก่อนเปลี่ยนข้อมูล)
#   backup.sh daemon   สำรองทุกวันตาม BACKUP_TIME (UTC) แล้วลบไฟล์ที่เก่ากว่า BACKUP_KEEP_DAYS วัน
# ใช้ตัวแปร PGHOST/PGUSER/PGPASSWORD/PGDATABASE ของ libpq
set -eu

BACKUP_DIR="${BACKUP_DIR:-/backups}"
BACKUP_KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
# 20:00 UTC = 03:00 เวลาไทย (ช่วงที่ไม่มีคนจอง)
BACKUP_TIME="${BACKUP_TIME:-20:00}"

log() {
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) backup: $*"
}

run_backup() {
  file="$BACKUP_DIR/${PGDATABASE}-$(date -u +%Y%m%dT%H%M%SZ).dump"
  # เขียนไฟล์ชั่วคราวก่อน — ไฟล์ .dump ที่เห็นต้องสมบูรณ์เสมอ (dump ล้มกลางทางไม่ทิ้งไฟล์ครึ่งๆ)
  if ! pg_dump --format=custom --file="$file.partial"; then
    rm -f "$file.partial"
    log "FAILED (pg_dump)"
    return 1
  fi
  mv "$file.partial" "$file"
  log "ok $file ($(du -h "$file" | cut -f1))"

  # เก็บ BACKUP_KEEP_DAYS วันล่าสุด (-mtime +N = เก่ากว่า N วันเต็ม)
  find "$BACKUP_DIR" -name "${PGDATABASE}-*.dump" -mtime "+$((BACKUP_KEEP_DAYS - 1))" -print -delete |
    while read -r old; do log "removed $old"; done

  # แจ้ง uptime monitor แบบ push (เช่น Uptime Kuma "Push") — ไม่ได้รับ = backup ไม่ทำงาน
  if [ -n "${BACKUP_PUSH_URL:-}" ]; then
    wget -q -O /dev/null "$BACKUP_PUSH_URL" || log "push notify failed"
  fi
}

mkdir -p "$BACKUP_DIR"

case "${1:-}" in
  once)
    run_backup
    ;;
  daemon)
    log "daily at $BACKUP_TIME UTC, keep $BACKUP_KEEP_DAYS days, dir $BACKUP_DIR"
    last=""
    while :; do
      today=$(date -u +%Y-%m-%d)
      if [ "$(date -u +%H:%M)" = "$BACKUP_TIME" ] && [ "$last" != "$today" ]; then
        # ล้มแล้วลองใหม่รอบถัดไปของนาทีเดียวกันไม่ได้ — จดว่าทำแล้ว แล้วให้ monitor (push) เป็นตัวแจ้ง
        run_backup || true
        last="$today"
      fi
      sleep 20
    done
    ;;
  *)
    echo "usage: $0 once|daemon" >&2
    exit 2
    ;;
esac
