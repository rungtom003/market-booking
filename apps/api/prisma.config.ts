import { defineConfig } from 'prisma/config';

// Prisma 7 ไม่โหลด .env ให้เอง — ใช้ของ Node (รันจาก apps/api หรือ root ก็เจอ)
for (const path of ['.env', '../../.env']) {
  try {
    process.loadEnvFile(path);
    break;
  } catch {
    // ไม่มีไฟล์ — ลองตัวถัดไป / ใช้ env ของระบบ (CI)
  }
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    // ไม่ใช้ env() ของ prisma/config เพราะจะ throw ตอน `prisma generate` ใน CI ที่ไม่มี DATABASE_URL
    url: process.env.DATABASE_URL ?? '',
  },
});
