// แยกจาก test-db.ts เพราะ globalSetup ของ Jest ไม่ใช้ moduleNameMapper จึง import Prisma client ไม่ได้

function loadEnvFile(): void {
  for (const path of ['.env', '../../.env']) {
    try {
      // ไม่ทับค่าที่มีใน process.env อยู่แล้ว (CI ตั้งผ่าน env)
      process.loadEnvFile(path);
      return;
    } catch {
      // ลองตัวถัดไป / CI ใช้ env ของระบบ
    }
  }
}

/**
 * URL ของ DB สำหรับ integration test — แยกจาก DB dev เสมอ
 * ใช้ TEST_DATABASE_URL ถ้ามี ไม่งั้นต่อท้ายชื่อ DB ของ DATABASE_URL ด้วย `_test`
 * ผลลัพธ์เก็บกลับลง TEST_DATABASE_URL — เรียกซ้ำหลัง setup-env เปลี่ยน DATABASE_URL แล้วก็ได้ค่าเดิม
 */
export function testDatabaseUrl(): string {
  loadEnvFile();
  const raw = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!raw) throw new Error('Set TEST_DATABASE_URL (or DATABASE_URL) to run integration tests');

  const url = new URL(raw);
  if (!process.env.TEST_DATABASE_URL) url.pathname = `${url.pathname}_test`;

  // กันพลาดล้างข้อมูล DB จริง: test จะ TRUNCATE ทุกตาราง
  if (!url.pathname.endsWith('_test')) {
    throw new Error(
      `Refusing to run integration tests on "${url.pathname}" (name must end in _test)`,
    );
  }
  process.env.TEST_DATABASE_URL = url.toString();
  return process.env.TEST_DATABASE_URL;
}

/**
 * Redis สำหรับ integration test — ใช้ TEST_REDIS_URL ถ้ามี ไม่งั้น REDIS_URL เปลี่ยนเป็น db 15
 * ห้ามเป็น db 0 เพราะ test สั่ง FLUSHDB
 */
export function testRedisUrl(): string {
  loadEnvFile();
  const raw = process.env.TEST_REDIS_URL ?? process.env.REDIS_URL ?? 'redis://localhost:6379';

  const url = new URL(raw);
  if (!process.env.TEST_REDIS_URL) url.pathname = '/15';

  const db = Number(url.pathname.slice(1) || '0');
  if (!Number.isInteger(db) || db === 0) {
    throw new Error(`Refusing to run integration tests on Redis db ${url.pathname} (use db 1-15)`);
  }
  process.env.TEST_REDIS_URL = url.toString();
  return process.env.TEST_REDIS_URL;
}
