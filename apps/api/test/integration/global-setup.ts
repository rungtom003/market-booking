import { execSync } from 'node:child_process';
import { Client } from 'pg';
import { testDatabaseUrl } from './test-db-url';

/** สร้าง DB test (ถ้ายังไม่มี) แล้ว apply migration ทั้งหมด — รันครั้งเดียวก่อน integration test ทุกไฟล์ */
export default async function globalSetup(): Promise<void> {
  const url = new URL(testDatabaseUrl());
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

  // migrate deploy ไม่ลบข้อมูล และไม่ต้องตอบคำถามแบบ interactive
  execSync('pnpm exec prisma migrate deploy', {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: url.toString() },
  });
}
