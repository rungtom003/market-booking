#!/bin/sh
# ย้อน api + nginx กลับไป image ของ deploy ก่อนหน้า (ไม่แตะฐานข้อมูล)
#   docker/scripts/rollback.sh <tag>      tag ดูได้จาก docker/deploy-history.log
# migration ไม่ถูกย้อน — ถ้า migration ของเวอร์ชันใหม่ไม่เข้ากับโค้ดเก่า ให้ restore backup ก่อน deploy
# (docker/scripts/restore.sh) — ดู docs/runbook.md
set -eu

if [ $# -ne 1 ]; then
  echo "usage: $0 <tag>" >&2
  exit 2
fi
tag=$1

cd "$(dirname "$0")/.."
. ./scripts/lib.sh

for image in api api-tools nginx; do
  docker image inspect "market-booking/$image:$tag" > /dev/null
done

save_image_tag "$tag"
$compose up -d --no-deps --wait api nginx
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $tag (rollback)" >> deploy-history.log
$compose ps api nginx
