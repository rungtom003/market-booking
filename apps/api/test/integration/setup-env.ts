// Jest setupFiles ของ integration test — ชี้ app ไปที่ DB/Redis ของ test ก่อน module ใดๆ ถูก import
import { testDatabaseUrl, testRedisUrl } from './test-db-url';

process.env.DATABASE_URL = testDatabaseUrl();
process.env.REDIS_URL = testRedisUrl();
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
// ค่าต่ำให้ test rate limit ไม่ต้องยิงเป็นร้อยครั้ง
process.env.RATE_LIMIT_PER_MINUTE = '5';
