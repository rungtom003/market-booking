// ConfigModule.forRoot() validate env ตอน import module (ก่อน beforeAll) จึงต้องตั้งค่าที่นี่ (Jest setupFiles)
// ใส่เฉพาะตัวที่ยังไม่มี — integration test ตั้ง DATABASE_URL/REDIS_URL ของ test ไว้ก่อนแล้ว
const defaults: Record<string, string> = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  DATABASE_URL: 'postgresql://market:market_dev@localhost:5433/market_booking',
  REDIS_URL: 'redis://localhost:6379',
  JWT_ACCESS_SECRET: 'test-access',
  JWT_REFRESH_SECRET: 'test-refresh',
  MINIO_ENDPOINT: 'localhost',
  MINIO_ACCESS_KEY: 'test',
  MINIO_SECRET_KEY: 'test',
  MINIO_BUCKET: 'test',
  WEB_ORIGIN: 'http://localhost:5173',
  ADMIN_ORIGIN: 'http://localhost:5174',
  // ไม่รัน BullMQ worker/job ประจำใน test — test ของ worker เรียก start() เอง
  WORKERS_ENABLED: 'false',
  // เหมือน production หลัง Nginx 1 ชั้น — ทดสอบ rate limit ต่อ IP จาก X-Forwarded-For
  TRUST_PROXY: '1',
};

for (const [key, value] of Object.entries(defaults)) {
  process.env[key] ??= value;
}
