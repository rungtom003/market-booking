// แยกจาก test-db.ts เพราะ globalSetup ของ Jest ไม่ใช้ moduleNameMapper จึง import Prisma client ไม่ได้

function loadEnvFile(): void {
  for (const path of ['.env', '../../.env']) {
    try {
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
  return url.toString();
}
