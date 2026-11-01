#!/bin/sh
# Deploy โค้ดตาม git checkout ปัจจุบัน — รันบน VPS หลัง `git pull`
#   docker/scripts/deploy.sh
# build image ติด tag = git commit → backup DB (ถ้าระบบรันอยู่) → ตั้ง IMAGE_TAG ใน docker/.env → up (migrate ก่อน api)
# image ของ commit ก่อนหน้ายังอยู่ในเครื่อง — ย้อนกลับด้วย docker/scripts/rollback.sh <tag>
set -eu

cd "$(dirname "$0")/.."
. ./scripts/lib.sh

if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "มีไฟล์ที่แก้แต่ยังไม่ commit — deploy เฉพาะโค้ดที่ commit แล้วเท่านั้น" >&2
  exit 1
fi
IMAGE_TAG=$(git rev-parse --short HEAD)
export IMAGE_TAG

echo "==> build $IMAGE_TAG"
$compose build

if [ -n "$($compose ps --status running -q postgres)" ]; then
  echo "==> backup ก่อน deploy"
  $compose run --rm --no-deps backup once
fi

echo "==> start"
save_image_tag "$IMAGE_TAG"
$compose up -d --remove-orphans --wait
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $IMAGE_TAG" >> deploy-history.log
$compose ps
echo "deploy $IMAGE_TAG เสร็จ — ประวัติ: docker/deploy-history.log"
