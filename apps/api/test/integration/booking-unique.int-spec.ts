import { Prisma } from '../../src/generated/prisma/client';
import type { BookingStatus, PrismaClient } from '../../src/generated/prisma/client';
import { createTestPrisma, truncateAll } from './test-db';

/**
 * ตรวจ partial unique index `uq_active_booking` (Overview §7.2):
 * 1 ล็อค/วันขาย มี booking สถานะ active (HOLD, PENDING_PAYMENT, PENDING_VERIFY, CONFIRMED) ได้รายการเดียว
 */
describe('uq_active_booking (integration)', () => {
  let prisma: PrismaClient;
  let ctx: { marketId: string; stallId: string; marketDayId: string; vendorIds: string[] };

  beforeAll(async () => {
    prisma = createTestPrisma();
    await truncateAll(prisma);

    const market = await prisma.market.create({ data: { name: 'ตลาดทดสอบ', address: '-' } });
    const admin = await prisma.adminUser.create({
      data: { username: 'tester', passwordHash: 'x', displayName: 'Tester', role: 'SUPER_ADMIN' },
    });
    const zone = await prisma.zone.create({
      data: { marketId: market.id, name: 'Z', color: '#000000' },
    });
    const stall = await prisma.stall.create({
      data: {
        marketId: market.id,
        zoneId: zone.id,
        code: 'A1',
        widthM: 2,
        lengthM: 2,
        price: 100,
        shapeW: 60,
        shapeH: 60,
      },
    });
    const round = await prisma.bookingRound.create({
      data: {
        marketId: market.id,
        name: 'รอบทดสอบ',
        openAt: new Date('2026-11-01T00:00:00Z'),
        closeAt: new Date('2026-11-05T00:00:00Z'),
        maxStallsPerVendor: 1,
        createdById: admin.id,
      },
    });
    const day = await prisma.marketDay.create({
      data: { marketId: market.id, roundId: round.id, marketDate: new Date('2026-11-07') },
    });
    const vendors = await Promise.all(
      ['0800000001', '0800000002', '0800000003'].map((phone) =>
        prisma.vendor.create({
          data: {
            marketId: market.id,
            firstName: 'ผู้ค้า',
            lastName: phone,
            phone,
            address: '-',
            pdpaConsentAt: new Date(),
          },
        }),
      ),
    );

    ctx = {
      marketId: market.id,
      stallId: stall.id,
      marketDayId: day.id,
      vendorIds: vendors.map((v) => v.id),
    };
  });

  beforeEach(async () => {
    await prisma.booking.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  function book(vendorIndex: number, status: BookingStatus) {
    return prisma.booking.create({
      data: {
        marketId: ctx.marketId,
        stallId: ctx.stallId,
        marketDayId: ctx.marketDayId,
        vendorId: ctx.vendorIds[vendorIndex]!,
        status,
        amount: 100,
      },
    });
  }

  async function expectUniqueViolation(promise: Promise<unknown>): Promise<void> {
    const error = await promise.then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    // P2002 = unique constraint — Phase 4.1 จะ map เป็น STALL_TAKEN
    expect((error as Prisma.PrismaClientKnownRequestError).code).toBe('P2002');
  }

  const ACTIVE: BookingStatus[] = ['HOLD', 'PENDING_PAYMENT', 'PENDING_VERIFY', 'CONFIRMED'];

  it.each(ACTIVE)('rejects a second active booking when the first is %s', async (status) => {
    await book(0, status);
    await expectUniqueViolation(book(1, 'HOLD'));
  });

  it.each(['EXPIRED', 'CANCELLED'] as BookingStatus[])(
    'allows a new booking when the previous one is %s',
    async (status) => {
      await book(0, status);
      await expect(book(1, 'HOLD')).resolves.toMatchObject({ status: 'HOLD' });
    },
  );

  it('allows a new booking after the active one transitions to EXPIRED', async () => {
    const first = await book(0, 'HOLD');
    await expectUniqueViolation(book(1, 'HOLD'));

    await prisma.booking.update({ where: { id: first.id }, data: { status: 'EXPIRED' } });

    await expect(book(1, 'HOLD')).resolves.toMatchObject({ status: 'HOLD' });
  });

  it('keeps any number of inactive bookings as history', async () => {
    await book(0, 'EXPIRED');
    await book(1, 'CANCELLED');
    await book(2, 'EXPIRED');
    await book(0, 'CONFIRMED');

    await expect(prisma.booking.count()).resolves.toBe(4);
  });

  it('blocks concurrent inserts at the database (only one wins)', async () => {
    const results = await Promise.allSettled(ctx.vendorIds.map((_, i) => book(i, 'HOLD')));

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(2);
  });

  it('enforces the index for raw SQL inserts too', async () => {
    const insert = (vendorId: string) => prisma.$executeRaw`
      INSERT INTO bookings (id, market_id, vendor_id, stall_id, market_day_id, status, amount, updated_at)
      VALUES (gen_random_uuid(), ${ctx.marketId}::uuid, ${vendorId}::uuid, ${ctx.stallId}::uuid,
              ${ctx.marketDayId}::uuid, 'HOLD', 100, now())`;

    await insert(ctx.vendorIds[0]!);
    await expect(insert(ctx.vendorIds[1]!)).rejects.toThrow(/uq_active_booking|unique/i);
  });
});
