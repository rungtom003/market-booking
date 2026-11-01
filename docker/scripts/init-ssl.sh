#!/bin/sh
# ออก cert Let's Encrypt ครั้งแรก (1 cert ครอบ WEB_DOMAIN + ADMIN_DOMAIN) แล้ว restart nginx ให้ใช้
#   docker/scripts/init-ssl.sh
# ต้องมีก่อน: DNS ของทั้งสองโดเมนชี้มาที่ VPS, port 80 เปิด, `docker compose ... up -d` แล้ว (nginx ตอบ challenge)
# การรันสคริปต์นี้ถือว่ายอมรับข้อตกลงของ Let's Encrypt (--agree-tos)
# หลังจากนี้ service `certbot` ต่ออายุเองทุก 12 ชั่วโมง และ nginx reload เองทุก 12 ชั่วโมง
# LETSENCRYPT_STAGING=1 ทดสอบกับ server staging ก่อน (ไม่ติด rate limit ของ Let's Encrypt)
set -eu

cd "$(dirname "$0")/.."
. ./scripts/lib.sh

# ค่าโดเมน/อีเมลมาจาก environment ของ service certbot (docker/.env)
$compose run --rm -e LETSENCRYPT_STAGING="${LETSENCRYPT_STAGING:-}" --entrypoint sh certbot -c '
  set -eu
  : "${WEB_DOMAIN:?}" "${ADMIN_DOMAIN:?}" "${LETSENCRYPT_EMAIL:?ต้องตั้ง LETSENCRYPT_EMAIL ใน docker/.env}"
  certbot certonly --webroot -w /var/www/certbot \
    --cert-name "$CERT_NAME" -d "$WEB_DOMAIN" -d "$ADMIN_DOMAIN" \
    --email "$LETSENCRYPT_EMAIL" --agree-tos --no-eff-email --non-interactive \
    ${LETSENCRYPT_STAGING:+--staging}
'

$compose restart nginx
echo "ออก cert แล้ว — nginx ใช้ cert ใหม่"
