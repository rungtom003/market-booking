// ConfigModule.forRoot() validate env ตอน import module (ก่อน beforeAll) จึงต้องตั้งค่าที่นี่
// ค่าใน process.env มีความสำคัญกว่าไฟล์ .env ทำให้ test ไม่ขึ้นกับเครื่องที่รัน
Object.assign(process.env, {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://market:market_dev@localhost:5432/market_booking',
  REDIS_URL: 'redis://localhost:6379',
  JWT_ACCESS_SECRET: 'test-access',
  JWT_REFRESH_SECRET: 'test-refresh',
  MINIO_ENDPOINT: 'localhost',
  MINIO_ACCESS_KEY: 'test',
  MINIO_SECRET_KEY: 'test',
  MINIO_BUCKET: 'test',
  WEB_ORIGIN: 'http://localhost:5173',
  ADMIN_ORIGIN: 'http://localhost:5174',
});
