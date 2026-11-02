// Jest setupFiles ของ integration test — ชี้ app ไปที่ DB/Redis ของ test ก่อน module ใดๆ ถูก import
import { testDatabaseUrl, testRedisUrl } from './test-db-url';

process.env.DATABASE_URL = testDatabaseUrl();
process.env.REDIS_URL = testRedisUrl();
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
// limit รวมสูงไว้ไม่ให้ test ที่ยิงหลาย request ติด 429 — test ของ rate limit ใช้ route ที่ตั้ง @Throttle เอง
process.env.RATE_LIMIT_PER_MINUTE = '1000';
// ไฟล์ของ test อยู่คนละ bucket กับ dev
process.env.MINIO_BUCKET = process.env.TEST_MINIO_BUCKET ?? 'market-booking-test';
// monitoring endpoint (Phase 11.4) — token ของ test เท่านั้น
process.env.METRICS_TOKEN = 'test-metrics-token-0123456789';
process.env.ALERT_WEBHOOK_TOKEN = 'test-alert-token-0123456789';
