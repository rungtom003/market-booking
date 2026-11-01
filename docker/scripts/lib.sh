# ใช้ร่วมกันใน docker/scripts/*.sh (source จากโฟลเดอร์ docker/)

compose="docker compose -f docker-compose.prod.yml"

# จด tag ของ image ที่ใช้อยู่ลง docker/.env — คำสั่ง `docker compose` ทุกคำสั่งหลังจากนี้ใช้ image ชุดเดียวกัน
# (tag เปลี่ยน = config ของ service เปลี่ยน → compose สร้าง container ใหม่เฉพาะ service ที่ใช้ image นี้)
save_image_tag() {
  if grep -q '^IMAGE_TAG=' .env; then
    sed -i "s/^IMAGE_TAG=.*/IMAGE_TAG=$1/" .env
  else
    printf '\n# ตั้งโดย docker/scripts/deploy.sh / rollback.sh — image ที่ใช้อยู่ (git commit)\nIMAGE_TAG=%s\n' "$1" >> .env
  fi
}
