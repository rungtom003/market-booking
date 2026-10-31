import { SETTING_DEFAULTS } from '@market-booking/shared';
import bcrypt from 'bcryptjs';
import type { PrismaClient } from '../../src/generated/prisma/client';
import { seed } from '../../prisma/seed';
import { createTestPrisma, truncateAll } from './test-db';

describe('prisma seed (integration)', () => {
  let prisma: PrismaClient;
  const options = { adminUsername: 'seed-admin', adminPassword: 'seed-password-123' };

  beforeAll(async () => {
    prisma = createTestPrisma();
    await truncateAll(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('creates the initial market data', async () => {
    const result = await seed(prisma, options);
    expect(result.skipped).toBe(false);

    await expect(prisma.market.count()).resolves.toBe(1);
    await expect(prisma.zone.count()).resolves.toBe(2);
    await expect(prisma.stall.count()).resolves.toBe(20);
    await expect(prisma.productCategory.count()).resolves.toBeGreaterThan(0);

    const settings = await prisma.systemSetting.findMany({ where: { marketId: result.marketId } });
    expect(settings.map((s) => s.key).sort()).toEqual(Object.keys(SETTING_DEFAULTS).sort());
    expect(settings.find((s) => s.key === 'registration_mode')?.value).toBe('MANUAL');
    expect(settings.find((s) => s.key === 'promptpay_id')?.value).toBeNull();
  });

  it('creates a SUPER_ADMIN for all markets with a bcrypt cost-12 hash', async () => {
    const admin = await prisma.adminUser.findUniqueOrThrow({
      where: { username: options.adminUsername },
    });

    expect(admin.role).toBe('SUPER_ADMIN');
    expect(admin.marketId).toBeNull();
    expect(bcrypt.getRounds(admin.passwordHash)).toBe(12);
    await expect(bcrypt.compare(options.adminPassword, admin.passwordHash)).resolves.toBe(true);
  });

  it('places stalls without overlapping on the map', async () => {
    const stalls = await prisma.stall.findMany();
    const positions = new Set(stalls.map((s) => `${s.posX.toString()},${s.posY.toString()}`));

    expect(positions.size).toBe(stalls.length);
  });

  it('is safe to run again', async () => {
    const again = await seed(prisma, options);

    expect(again.skipped).toBe(true);
    await expect(prisma.market.count()).resolves.toBe(1);
    await expect(prisma.adminUser.count()).resolves.toBe(1);
  });
});
