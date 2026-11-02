import { execSync } from 'node:child_process';
import Redis from 'ioredis';
import { Client } from 'pg';
import { E2E_ADMIN, E2E_DATABASE_URL, E2E_REDIS_URL, ROOT, apiEnv } from './env';

/** เตรียม DB ของ E2E (สร้าง + migrate + seed) และล้าง Redis db ของ E2E (ยกเว้น queue) */
export default async function globalSetup(): Promise<void> {
  const url = new URL(E2E_DATABASE_URL);
  const dbName = decodeURIComponent(url.pathname.slice(1));
  if (!dbName.endsWith('_e2e'))
    throw new Error(`Refusing to use "${dbName}" for E2E (must end in _e2e)`);

  const admin = new URL(url);
  admin.pathname = '/postgres';
  const client = new Client({ connectionString: admin.toString() });
  await client.connect();
  try {
    const { rowCount } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [
      dbName,
    ]);
    if (!rowCount) await client.query(`CREATE DATABASE "${dbName.replace(/"/g, '""')}"`);
  } finally {
    await client.end();
  }

  const env = {
    ...process.env,
    ...apiEnv(),
    SEED_ADMIN_USERNAME: E2E_ADMIN.username,
    SEED_ADMIN_PASSWORD: E2E_ADMIN.password,
  };
  // migrate deploy ไม่ลบข้อมูล; seed ข้ามถ้ามีตลาดอยู่แล้ว — ผู้ค้าจาก E2E รอบก่อนค้างได้ (ใช้เบอร์สุ่มทุกรอบ)
  execSync('pnpm exec prisma migrate deploy', { cwd: `${ROOT}/apps/api`, env, stdio: 'inherit' });
  execSync('pnpm exec tsx prisma/seed.ts', { cwd: `${ROOT}/apps/api`, env, stdio: 'inherit' });

  // ข้อมูลจาก E2E ครั้งก่อนที่ค้าง (test ล้มก่อนเก็บกวาด) — ยกเลิกทิ้ง ไม่ให้วันขายชนหรือโผล่ใน /rounds/current
  const db = new Client({ connectionString: E2E_DATABASE_URL });
  await db.connect();
  try {
    await db.query("UPDATE booking_rounds SET status = 'CANCELLED' WHERE status <> 'CANCELLED'");
    await db.query('UPDATE market_days SET is_cancelled = true WHERE NOT is_cancelled');
    // การจอง/สลิปที่ค้างจากรอบก่อน — ไม่ให้โผล่ในคิวตรวจสลิปหรือกันล็อค
    await db.query(
      "UPDATE bookings SET status = 'CANCELLED', cancelled_at = now(), cancel_reason = 'E2E cleanup' WHERE status IN ('HOLD','PENDING_PAYMENT','PENDING_VERIFY','CONFIRMED')",
    );
    await db.query(
      "UPDATE payments SET status = 'REJECTED', reject_reason = 'E2E cleanup' WHERE status = 'PENDING'",
    );
  } finally {
    await db.end();
  }

  // ล้าง OTP / rate limit / mock SMS / คิว Waiting Room ของรอบก่อน — แต่ไม่แตะ BullMQ (`bull:*`):
  // API เปิดก่อน global setup และตั้ง job scheduler (worker ตามเวลา) ไว้แล้ว ถ้า FLUSHDB จะหายจนจบการรัน
  const redis = new Redis(E2E_REDIS_URL);
  try {
    let cursor = '0';
    do {
      const [next, found] = await redis.scan(cursor, 'COUNT', 500);
      cursor = next;
      const stale = found.filter((k) => !k.startsWith('bull:'));
      if (stale.length > 0) await redis.del(...stale);
    } while (cursor !== '0');
  } finally {
    redis.disconnect();
  }
}
