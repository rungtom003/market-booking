/**
 * ตั้งรหัสผ่านใหม่ให้ admin (กรณี SUPER_ADMIN คนเดียวลืมรหัส — admin คนอื่นแก้ผ่านหน้า "ผู้ดูแลระบบ" ได้)
 * production: docker compose -f docker/docker-compose.prod.yml run --rm \
 *   -e ADMIN_USERNAME=admin -e ADMIN_PASSWORD='...' migrate pnpm exec tsx scripts/reset-admin-password.ts
 * เปิดบัญชีที่ถูกปิดให้ใช้ได้อีกครั้งด้วย และลง audit log (actor SYSTEM)
 * session เดิมยังอยู่จนหมดอายุ — ถ้าสงสัยว่าบัญชีถูกยึด ให้เปลี่ยน JWT secret ด้วย (docs/runbook.md)
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { hashPassword } from '../src/common/password';
import { PrismaClient } from '../src/generated/prisma/client';

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD ?? '';
  if (!connectionString) throw new Error('DATABASE_URL is not set');
  if (!username) throw new Error('ADMIN_USERNAME is not set');
  // เท่ากับขั้นต่ำของ seed ใน production
  if (password.length < 12) throw new Error('ADMIN_PASSWORD must be at least 12 characters');

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    const admin = await prisma.adminUser.findUnique({ where: { username } });
    if (!admin) throw new Error(`Admin "${username}" not found`);

    await prisma.$transaction([
      prisma.adminUser.update({
        where: { id: admin.id },
        data: { passwordHash: await hashPassword(password), isActive: true },
      }),
      prisma.auditLog.create({
        data: {
          actorType: 'SYSTEM',
          action: 'admin_user.reset_password_cli',
          entityType: 'admin_user',
          entityId: admin.id,
          before: { isActive: admin.isActive },
          after: { isActive: true },
        },
      }),
    ]);
    console.log(`Password reset for ${username} (${admin.role})`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
