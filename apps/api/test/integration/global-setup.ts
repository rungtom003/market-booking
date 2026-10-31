import { execSync } from 'node:child_process';
import { CreateBucketCommand, HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';
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

/** bucket ของ test ใน MinIO (สร้างถ้ายังไม่มี) — ค่าเชื่อมต่อมาจาก .env / env ของ CI */
async function ensureBucket(): Promise<void> {
  const bucket = process.env.TEST_MINIO_BUCKET ?? 'market-booking-test';
  const scheme = process.env.MINIO_USE_SSL === 'true' ? 'https' : 'http';
  const client = new S3Client({
    region: 'us-east-1',
    forcePathStyle: true,
    endpoint: `${scheme}://${process.env.MINIO_ENDPOINT ?? 'localhost'}:${process.env.MINIO_PORT ?? '9000'}`,
    credentials: {
      accessKeyId: process.env.MINIO_ACCESS_KEY ?? '',
      secretAccessKey: process.env.MINIO_SECRET_KEY ?? '',
    },
  });
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch {
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
  } finally {
    client.destroy();
  }
}

/**
 * รันครั้งเดียวก่อน integration test ทุกไฟล์:
 * สร้าง DB test (ถ้ายังไม่มี) + apply migration ทั้งหมด, ล้าง Redis db ของ test, สร้าง bucket ของ test
 */
export default async function globalSetup(): Promise<void> {
  const dbUrl = new URL(testDatabaseUrl());
  await ensureDatabase(dbUrl);

  // migrate deploy ไม่ลบข้อมูล และไม่ต้องตอบคำถามแบบ interactive
  execSync('pnpm exec prisma migrate deploy', {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: dbUrl.toString() },
  });

  await ensureBucket();

  const redis = new Redis(testRedisUrl());
  try {
    await redis.flushdb();
  } finally {
    redis.disconnect();
  }
}
