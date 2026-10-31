import { execSync } from 'node:child_process';
import Redis from 'ioredis';
import { Client } from 'pg';
import { testDatabaseUrl, testRedisUrl } from './test-db-url';

async function ensureDatabase(url: URL): Promise<void> {
  const dbName = decodeURIComponent(url.pathname.slice(1));
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
}

/**
 * รันครั้งเดียวก่อน integration test ทุกไฟล์:
 * สร้าง DB test (ถ้ายังไม่มี) + apply migration ทั้งหมด และล้าง Redis db ของ test
 */
export default async function globalSetup(): Promise<void> {
  const dbUrl = new URL(testDatabaseUrl());
  await ensureDatabase(dbUrl);

  // migrate deploy ไม่ลบข้อมูล และไม่ต้องตอบคำถามแบบ interactive
  execSync('pnpm exec prisma migrate deploy', {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: dbUrl.toString() },
  });

  const redis = new Redis(testRedisUrl());
  try {
    await redis.flushdb();
  } finally {
    redis.disconnect();
  }
}
