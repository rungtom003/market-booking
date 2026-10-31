import { resolve } from 'node:path';

/**
 * ค่าที่ E2E ใช้ — แยกจาก dev ทั้งหมด (port, DB, Redis db, bucket) จึงรันพร้อม `pnpm dev` ได้
 * อ่าน .env ที่ root เป็นฐาน (CI ตั้งผ่าน env แทน)
 */
export const ROOT = resolve(__dirname, '..');

try {
  // ไม่ทับค่าที่ตั้งไว้แล้ว (CI)
  process.loadEnvFile(resolve(ROOT, '.env'));
} catch {
  // ไม่มีไฟล์ .env — ใช้ env ของระบบ
}

export const API_PORT = 3100;
export const WEB_PORT = 5183;
export const WEB_URL = `http://localhost:${WEB_PORT}`;
export const ADMIN_PORT = 5184;
export const ADMIN_URL = `http://localhost:${ADMIN_PORT}`;
export const API_URL = `http://localhost:${API_PORT}/api/v1`;

function withPath(url: string, path: string): string {
  const u = new URL(url);
  u.pathname = path;
  return u.toString();
}

const baseDb =
  process.env.DATABASE_URL ?? 'postgresql://market:market_dev@localhost:5433/market_booking';
const baseRedis = process.env.REDIS_URL ?? 'redis://localhost:6379';

export const E2E_DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? withPath(baseDb, '/market_booking_e2e');
/** db 14: แยกจาก dev (0) และ integration test (15) — ถูกล้างทุกครั้งที่เริ่ม E2E */
export const E2E_REDIS_URL = process.env.E2E_REDIS_URL ?? withPath(baseRedis, '/14');
export const E2E_BUCKET = process.env.TEST_MINIO_BUCKET ?? 'market-booking-test';
export const E2E_ADMIN = { username: 'admin', password: 'e2e-admin-password-123' };

/** env ของ API ที่ E2E เปิด — ค่า dev-only สำหรับตัวที่ยังไม่มี (เช่นบน CI) */
export function apiEnv(): Record<string, string> {
  const pick = (key: string, fallback: string) => process.env[key] ?? fallback;
  return {
    NODE_ENV: 'test',
    LOG_LEVEL: 'warn',
    PORT: String(API_PORT),
    DATABASE_URL: E2E_DATABASE_URL,
    REDIS_URL: E2E_REDIS_URL,
    MINIO_BUCKET: E2E_BUCKET,
    MINIO_ENDPOINT: pick('MINIO_ENDPOINT', 'localhost'),
    MINIO_PORT: pick('MINIO_PORT', '9000'),
    MINIO_ACCESS_KEY: pick('MINIO_ACCESS_KEY', 'market_minio'),
    MINIO_SECRET_KEY: pick('MINIO_SECRET_KEY', 'market_minio_dev'),
    JWT_ACCESS_SECRET: pick('JWT_ACCESS_SECRET', 'e2e-access-secret'),
    JWT_REFRESH_SECRET: pick('JWT_REFRESH_SECRET', 'e2e-refresh-secret'),
    WEB_ORIGIN: WEB_URL,
    ADMIN_ORIGIN: ADMIN_URL,
    // E2E ยิง request มากกว่าผู้ใช้จริงในเวลาสั้น
    RATE_LIMIT_PER_MINUTE: '1000',
  };
}
