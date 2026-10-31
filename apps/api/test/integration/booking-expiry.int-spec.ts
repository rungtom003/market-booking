import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Booking, MarketDayStalls } from '@market-booking/shared';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { zonedDate } from '../../src/common/zoned-date';
import type { PrismaClient } from '../../src/generated/prisma/client';
import type { AdminPrincipal } from '../../src/modules/auth/principal';
import { TokenService } from '../../src/modules/auth/token.service';
import { type BookingChangedEvent, BookingEvents } from '../../src/modules/booking/booking-events';
import {
  BookingExpiryProcessor,
  SWEEP_INTERVAL_MS,
  SWEEP_SCHEDULER_ID,
} from '../../src/modules/booking/booking-expiry.processor';
import { PrismaService } from '../../src/prisma/prisma.service';
import { setupApp } from '../../src/setup-app';
import { truncateAll } from './test-db';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** รอจนเงื่อนไขเป็นจริง (ตรวจทุก `everyMs`) — ไม่ทันเวลาคืน false */
async function waitFor(check: () => Promise<boolean>, timeoutMs: number, everyMs = 200) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await check()) return true;
    await sleep(everyMs);
  }
  return check();
}

describe('Booking expiry worker (integration)', () => {
  let app: INestApplication;
  let url: string;
  let prisma: PrismaService;
  let expiry: BookingExpiryProcessor;
  let marketId: string;
  let admin: AdminPrincipal;
  let zoneId: string;
  let marketDayId: string;
  let seq = 0;
  const events: BookingChangedEvent[] = [];
  const http = () => request(url);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.listen(0);
    url = (await app.getUrl()).replace('[::1]', 'localhost');
    prisma = app.get(PrismaService);
    expiry = app.get(BookingExpiryProcessor);
    app.get(BookingEvents).onChanged((e) => {
      events.push(e);
    });

    await truncateAll(prisma as unknown as PrismaClient);
    await expiry.getQueue().obliterate({ force: true });
    // setup-env ปิด worker ไว้ — ไฟล์นี้ทดสอบ worker จึงเปิดเอง
    await expiry.start();

    marketId = (await prisma.market.create({ data: { name: 'ตลาดหลัก', address: '-' } })).id;
    const adminRow = await prisma.adminUser.create({
      data: { username: 'admin', passwordHash: 'x', displayName: 'admin', role: 'ADMIN', marketId },
    });
    admin = { actorType: 'ADMIN', id: adminRow.id, role: 'ADMIN', marketId };
    zoneId = (
      await prisma.zone.create({
        data: { marketId, name: 'ทั่วไป', color: '#3B82F6', sortOrder: 0 },
      })
    ).id;
    const round = await prisma.bookingRound.create({
      data: {
        marketId,
        name: 'รอบเปิด',
        openAt: new Date(Date.now() - HOUR),
        closeAt: new Date(Date.now() + DAY),
        maxStallsPerVendor: 5,
        status: 'PUBLISHED',
        createdById: admin.id,
      },
    });
    const date = zonedDate(new Date(Date.now() + 5 * DAY), 'Asia/Bangkok');
    marketDayId = (
      await prisma.marketDay.create({
        data: { marketId, roundId: round.id, marketDate: new Date(`${date}T00:00:00Z`) },
      })
    ).id;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    events.length = 0;
  });

  // ───────────── helpers ─────────────

  const asAdmin = () => ({
    Authorization: `Bearer ${app.get(TokenService).signAccessToken(admin)}`,
  });

  async function makeVendor() {
    const phone = `08${String(50000000 + ++seq).slice(-8)}`;
    const row = await prisma.vendor.create({
      data: {
        marketId,
        firstName: 'ผู้ค้า',
        lastName: phone,
        phone,
        address: '-',
        pdpaConsentAt: new Date(),
        status: 'APPROVED',
      },
    });
    const token = app
      .get(TokenService)
      .signAccessToken({ actorType: 'VENDOR', id: row.id, marketId });
    return { id: row.id, headers: { Authorization: `Bearer ${token}` } };
  }
  type Vendor = Awaited<ReturnType<typeof makeVendor>>;

  async function makeStall() {
    return (
      await prisma.stall.create({
        data: {
          marketId,
          zoneId,
          code: `E${++seq}`,
          widthM: 2,
          lengthM: 2,
          price: 100,
          posX: 0,
          posY: 0,
          shapeW: 60,
          shapeH: 60,
        },
      })
    ).id;
  }

  async function hold(vendor: Vendor, stallId: string): Promise<Booking> {
    const res = await http()
      .post('/api/v1/bookings/hold')
      .set(vendor.headers)
      .send({ stallId, marketDayId })
      .expect(201);
    return res.body.data;
  }

  const statusOf = async (id: string) =>
    (await prisma.booking.findUniqueOrThrow({ where: { id } })).status;

  /** เวลาที่ delayed job จะรัน (ms) — null = ไม่มี job รอรัน (score ของ zset delayed = เวลา × 0x1000 + ลำดับ) */
  async function jobRunsAt(bookingId: string): Promise<number | null> {
    const queue = expiry.getQueue();
    const score = await (await queue.client).zscore(queue.toKey('delayed'), bookingId);
    return score === null ? null : Math.floor(Number(score) / 0x1000);
  }

  // ───────────── Acceptance Criteria ─────────────

  it(
    'AC: hold_minutes = 1 → ล็อคว่างเองหลัง 1 นาที (ไม่ต้องมีใครจองทับ)',
    async () => {
      await http()
        .put('/api/v1/admin/settings')
        .set(asAdmin())
        .send({ hold_minutes: 1 })
        .expect(200);
      try {
        const vendor = await makeVendor();
        const stallId = await makeStall();
        const booking = await hold(vendor, stallId);
        const expiresAt = Date.parse(booking.holdExpiresAt ?? '');
        // created_at มาจากนาฬิกา DB, hold_expires_at จากนาฬิกา app — ต่างกันได้ไม่กี่ ms
        expect(Math.abs(expiresAt - Date.parse(booking.createdAt) - 60_000)).toBeLessThan(1_000);

        const expired = await waitFor(
          async () => (await statusOf(booking.id)) === 'EXPIRED',
          60_000 + SWEEP_INTERVAL_MS,
          500,
        );
        expect(expired).toBe(true);
        // หมดตามเวลา hold (± sweeper) — ไม่ก่อนเวลา
        expect(Date.now()).toBeGreaterThanOrEqual(expiresAt);
        expect(Date.now() - expiresAt).toBeLessThan(SWEEP_INTERVAL_MS);
        expect(events).toContainEqual(
          expect.objectContaining({ bookingId: booking.id, stallId, status: 'EXPIRED' }),
        );

        const viewer = await makeVendor();
        const res = await http()
          .get(`/api/v1/market-days/${marketDayId}/stalls`)
          .set(viewer.headers)
          .expect(200);
        const stall = (res.body.data as MarketDayStalls).stalls.find((s) => s.id === stallId);
        expect(stall?.status).toBe('AVAILABLE');
      } finally {
        await http()
          .put('/api/v1/admin/settings')
          .set(asAdmin())
          .send({ hold_minutes: 10 })
          .expect(200);
      }
    },
    60_000 + SWEEP_INTERVAL_MS + 30_000,
  );

  it('AC: confirm ชนกับ expire ที่วินาทีเดียวกัน → ได้อย่างใดอย่างหนึ่ง สถานะไม่เพี้ยน', async () => {
    const pairs = await Promise.all(
      Array.from({ length: 20 }, async () => {
        const vendor = await makeVendor();
        return { vendor, booking: await hold(vendor, await makeStall()) };
      }),
    );
    // ทุกรายการหมดเวลาพร้อมกันที่ T แล้วยิง confirm กับ expire ใกล้ๆ T (ก่อน/หลังเล็กน้อย)
    const T = Date.now() + 500;
    await prisma.booking.updateMany({
      where: { id: { in: pairs.map((p) => p.booking.id) } },
      data: { holdExpiresAt: new Date(T) },
    });
    await sleep(T - Date.now() - 20);
    events.length = 0;

    const outcomes = await Promise.all(
      pairs.map(async ({ vendor, booking }, i) => {
        const jitter = (i % 5) * 10; // 0–40 ms
        const [confirm, expire] = await Promise.all([
          sleep(jitter).then(() =>
            http().post(`/api/v1/bookings/${booking.id}/confirm`).set(vendor.headers),
          ),
          sleep(40 - jitter).then(() => expiry.expireBooking(booking.id)),
        ]);
        const row = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
        return { booking, confirm, expire, row };
      }),
    );

    for (const { booking, confirm, expire, row } of outcomes) {
      expect(['PENDING_PAYMENT', 'EXPIRED']).toContain(row.status);
      // เปลี่ยนสถานะครั้งเดียวเท่านั้น
      expect(row.version).toBe(1);
      const changes = events.filter((e) => e.bookingId === booking.id);
      expect(changes).toHaveLength(1);
      expect(changes[0]?.status).toBe(row.status);
      if (row.status === 'PENDING_PAYMENT') {
        expect(confirm.status).toBe(200);
        expect(expire.expired).toBe(false);
      } else {
        expect(confirm.status).toBe(409);
        expect(['HOLD_EXPIRED', 'INVALID_STATE_TRANSITION']).toContain(confirm.body.error.code);
      }
    }
  });

  // ───────────── job lifecycle ─────────────

  it('hold ตั้ง job ที่เวลาหมด hold → confirm ย้ายไปเวลาหมดชำระ → cancel ลบ job', async () => {
    const vendor = await makeVendor();
    const booking = await hold(vendor, await makeStall());
    await waitFor(async () => (await jobRunsAt(booking.id)) !== null, 2_000, 50);
    expect(
      Math.abs((await jobRunsAt(booking.id))! - Date.parse(booking.holdExpiresAt!)),
    ).toBeLessThan(1_000);

    const confirmed = (
      await http().post(`/api/v1/bookings/${booking.id}/confirm`).set(vendor.headers).expect(200)
    ).body.data as Booking;
    const due = Date.parse(confirmed.paymentDueAt!);
    expect(
      await waitFor(
        async () => Math.abs(((await jobRunsAt(booking.id)) ?? 0) - due) < 1_000,
        2_000,
        50,
      ),
    ).toBe(true);

    await http()
      .post(`/api/v1/bookings/${booking.id}/cancel`)
      .set(vendor.headers)
      .send({})
      .expect(200);
    expect(await waitFor(async () => (await jobRunsAt(booking.id)) === null, 2_000, 50)).toBe(true);
  });

  it('processor idempotent: job ของการจองที่ยืนยัน/ยกเลิกแล้วไม่เปลี่ยนอะไร; job มาก่อนเวลาถูกเลื่อน', async () => {
    const vendor = await makeVendor();
    const done = await hold(vendor, await makeStall());
    await prisma.booking.update({
      where: { id: done.id },
      data: { status: 'CONFIRMED', holdExpiresAt: new Date(Date.now() - 1000) },
    });
    expect(await expiry.expireBooking(done.id)).toEqual({ expired: false });
    expect(await statusOf(done.id)).toBe('CONFIRMED');

    // job รันก่อนเวลาหมดจริง → worker เลื่อน job เดิมไปเวลาหมด ไม่ expire
    const early = await hold(vendor, await makeStall());
    const queue = expiry.getQueue();
    await waitFor(async () => (await jobRunsAt(early.id)) !== null, 2_000, 50);
    await (await queue.getJob(early.id))?.remove();
    await queue.add('expire', { bookingId: early.id }, { jobId: early.id, removeOnComplete: true });
    expect(
      await waitFor(
        async () => (await (await queue.getJob(early.id))?.getState()) === 'delayed',
        5_000,
        100,
      ),
    ).toBe(true);
    expect(Math.abs((await jobRunsAt(early.id))! - Date.parse(early.holdExpiresAt!))).toBeLessThan(
      1_000,
    );
    expect(await statusOf(early.id)).toBe('HOLD');
  });

  it('sweeper: กวาดการจองที่หมดเวลาแต่ไม่มี job (Redis หาย) + ตั้งรอบทุก 1 นาทีไว้แล้ว', async () => {
    const vendor = await makeVendor();
    const stallId = await makeStall();
    const orphan = await prisma.booking.create({
      data: {
        marketId,
        vendorId: vendor.id,
        stallId,
        marketDayId,
        status: 'PENDING_PAYMENT',
        amount: 100,
        paymentDueAt: new Date(Date.now() - 1000),
      },
    });

    expect(await expiry.sweep()).toBeGreaterThanOrEqual(1);
    expect(await statusOf(orphan.id)).toBe('EXPIRED');
    expect(events).toContainEqual(
      expect.objectContaining({ bookingId: orphan.id, status: 'EXPIRED' }),
    );
    expect(await expiry.sweep()).toBe(0);

    const scheduler = await expiry.getQueue().getJobScheduler(SWEEP_SCHEDULER_ID);
    expect(scheduler).toMatchObject({ every: SWEEP_INTERVAL_MS });
  });
});
