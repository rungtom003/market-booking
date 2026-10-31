import { execSync } from 'node:child_process';
import Redis from 'ioredis';
import { Client } from 'pg';
import { E2E_ADMIN, E2E_DATABASE_URL, E2E_REDIS_URL, ROOT, apiEnv } from './env';

/** เตรียม DB ของ E2E (สร้าง + migrate + seed) และล้าง Redis db ของ E2E */
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

  const redis = new Redis(E2E_REDIS_URL);
  try {
    await redis.flushdb();
  } finally {
    redis.disconnect();
  }
}
