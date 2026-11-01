#!/bin/sh
# รันโดย entrypoint ของ nginx image ก่อน start (/docker-entrypoint.d)
# - มี cert จาก Let's Encrypt แล้ว → ใช้ (symlink ไป volume ของ certbot)
# - ยังไม่มี (deploy ครั้งแรก) → สร้าง self-signed ชั่วคราวให้ nginx start ได้และตอบ HTTP-01 challenge
#   ได้ หลัง `docker/scripts/init-ssl.sh` ออก cert แล้วให้ restart nginx
set -eu

live="/etc/letsencrypt/live/${CERT_NAME:-market-booking}"
ssl=/etc/nginx/ssl
mkdir -p "$ssl"

if [ -f "$live/fullchain.pem" ] && [ -f "$live/privkey.pem" ]; then
  ln -sf "$live/fullchain.pem" "$ssl/fullchain.pem"
  ln -sf "$live/privkey.pem" "$ssl/privkey.pem"
  echo "$0: using Let's Encrypt certificate $live"
else
  echo "$0: no Let's Encrypt certificate yet — using a temporary self-signed one"
  openssl req -x509 -nodes -newkey rsa:2048 -days 30 \
    -subj "/CN=${WEB_DOMAIN}" \
    -addext "subjectAltName=DNS:${WEB_DOMAIN},DNS:${ADMIN_DOMAIN}" \
    -keyout "$ssl/privkey.pem" -out "$ssl/fullchain.pem" 2>/dev/null
fi

# certbot ต่ออายุ cert ในที่เดิม — reload ทุก 12 ชั่วโมงให้ nginx อ่านไฟล์ใหม่
(
  while sleep 43200; do
    nginx -s reload
  done
) &
