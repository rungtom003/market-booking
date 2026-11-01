import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type {
  AdminWaitlistEntry,
  Booking,
  MarketDayStalls,
  WaitlistEntry,
} from '@market-booking/shared';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { zonedDate } from '../../src/common/zoned-date';
import type { PrismaClient } from '../../src/generated/prisma/client';
import type { AdminPrincipal } from '../../src/modules/auth/principal';
import { TokenService } from '../../src/modules/auth/token.service';
import { BookingExpiryProcessor } from '../../src/modules/booking/booking-expiry.processor';
import { PrismaService } from '../../src/prisma/prisma.service';
import { setupApp } from '../../src/setup-app';
import { truncateAll } from './test-db';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const CLAIM_MINUTES = 15;

describe('Waitlist (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let marketId: string;
  let admin: AdminPrincipal;
  let roundId: string;
  let seq = 0;
  let dayOffset = 3;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    await truncateAll(prisma as unknown as PrismaClient);

    marketId = (await prisma.market.create({ data: { name: 'ตลาดคิว', address: '-' } })).id;
    const row = await prisma.adminUser.create({
      data: { username: 'q-admin', passwordHash: 'x', displayName: 'คิว', role: 'ADMIN', marketId },
    });
    admin = { actorType: 'ADMIN', id: row.id, role: 'ADMIN', marketId };
    roundId = (
      await prisma.bookingRound.create({
        data: {
          marketId,
          name: 'รอบคิว',
          openAt: new Date(Date.now() - DAY),
          closeAt: new Date(Date.now() + DAY),
          maxStallsPerVendor: 1,
          status: 'PUBLISHED',
          createdById: admin.id,
        },
      })
    ).id;
    await http()
      .put('/api/v1/admin/settings')
      .set(asAdmin())
      .send({ payment_required: true, waitlist_claim_minutes: CLAIM_MINUTES })
      .expect(200);
  });

  afterAll(async () => {
    await app.close();
  });

  // ───────────── helpers ─────────────

  const tokenOf = (p: Parameters<TokenService['signAccessToken']>[0]) =>
    app.get(TokenService).signAccessToken(p);
  function asAdmin() {
    return { Authorization: `Bearer ${tokenOf(admin)}` };
  }

  async function makeVendor(name: string) {
    const n = ++seq;
    const row = await prisma.vendor.create({
      data: {
        marketId,
        firstName: name,
        lastName: `ที่${n}`,
        phone: `08${String(60000000 + n).slice(-8)}`,
        address: '-',
        pdpaConsentAt: new Date(),
        status: 'APPROVED',
      },
    });
    const token = tokenOf({ actorType: 'VENDOR', id: row.id, marketId });
    return { id: row.id, name, headers: { Authorization: `Bearer ${token}` } };
  }
  type Vendor = Awaited<ReturnType<typeof makeVendor>>;

  /** วันขาย + โซนใหม่ของแต่ละ test (โควตา 1 ล็อค/วัน ไม่ชนกันข้าม test) */
  async function setup(stallCount = 1) {
    const date = zonedDate(new Date(Date.now() + ++dayOffset * DAY), 'Asia/Bangkok');
    const marketDayId = (
      await prisma.marketDay.create({
        data: { marketId, roundId, marketDate: new Date(`${date}T00:00:00Z`) },
      })
    ).id;
    const zoneId = (
      await prisma.zone.create({ data: { marketId, name: `โซน${++seq}`, color: '#3B82F6' } })
    ).id;
    const stallIds: string[] = [];
    for (let i = 0; i < stallCount; i++) {
      stallIds.push(
        (
          await prisma.stall.create({
            data: {
              marketId,
              zoneId,
              code: `Q${++seq}`,
              widthM: 2,
              lengthM: 2,
              price: 100,
              shapeW: 60,
              shapeH: 60,
            },
          })
        ).id,
      );
    }
    return { marketDayId, zoneId, stallIds };
  }

  async function bookAndConfirm(vendor: Vendor, stallId: string, marketDayId: string) {
    const hold = await http()
      .post('/api/v1/bookings/hold')
      .set(vendor.headers)
      .send({ stallId, marketDayId })
      .expect(201);
    const res = await http()
      .post(`/api/v1/bookings/${hold.body.data.id}/confirm`)
      .set(vendor.headers)
      .expect(200);
    return res.body.data as Booking;
  }

  const join = (vendor: Vendor, body: object) =>
    http().post('/api/v1/waitlists').set(vendor.headers).send(body);

  const entryOf = (vendor: Vendor, marketDayId: string) =>
    prisma.waitlist.findFirstOrThrow({ where: { vendorId: vendor.id, marketDayId } });

  /** การส่งสิทธิ์ทำใน listener ของ booking event (async) — รอจนเป็นสถานะที่ต้องการ */
  async function waitStatus(vendor: Vendor, marketDayId: string, status: string) {
    for (let i = 0; i < 60; i++) {
      const row = await entryOf(vendor, marketDayId);
      if (row.status === status) return row;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`${vendor.name}: waitlist entry never became ${status}`);
  }

  const stallStatus = async (vendor: Vendor, marketDayId: string, stallId: string) => {
    const res = await http().get(`/api/v1/market-days/${marketDayId}/stalls`).set(vendor.headers);
    return (res.body.data as MarketDayStalls).stalls.find((s) => s.id === stallId)!.status;
  };

  const expireHoldsAt = (at: Date) => app.get(BookingExpiryProcessor).sweep(at);

  // ───────────── เข้าคิว ─────────────

  it('เข้าคิวได้เฉพาะล็อค/โซนที่เต็ม, ซ้ำไม่ได้, เจ้าของล็อคไม่ต้องเข้าคิว', async () => {
    const { marketDayId, zoneId, stallIds } = await setup(2);
    const [owner, waiter, other] = await Promise.all([
      makeVendor('เจ้าของ'),
      makeVendor('รอ'),
      makeVendor('อื่น'),
    ]);

    // ยังว่าง → จองได้เลย
    const free = await join(waiter, { marketDayId, stallId: stallIds[0] }).expect(409);
    expect(free.body.error.code).toBe('WAITLIST_NOT_NEEDED');

    await bookAndConfirm(owner, stallIds[0]!, marketDayId);
    const res = await join(waiter, { marketDayId, stallId: stallIds[0] }).expect(201);
    expect(res.body.data).toMatchObject({
      status: 'WAITING',
      ahead: 0,
      stall: { id: stallIds[0] },
      zone: { id: zoneId },
      bookingId: null,
    });
    expect(
      (await join(waiter, { marketDayId, stallId: stallIds[0] }).expect(409)).body.error.code,
    ).toBe('WAITLIST_ALREADY_JOINED');
    expect(
      (await join(owner, { marketDayId, stallId: stallIds[0] }).expect(409)).body.error.code,
    ).toBe('WAITLIST_NOT_NEEDED');

    // โซนยังมี W2 ว่าง → ไม่ต้องรอ; เต็มแล้ว → เข้าคิวโซนได้ และคิวก่อนหน้านับรวมคิวล็อคในโซน
    expect((await join(other, { marketDayId, zoneId }).expect(409)).body.error.code).toBe(
      'WAITLIST_NOT_NEEDED',
    );
    await bookAndConfirm(other, stallIds[1]!, marketDayId);
    const third = await makeVendor('คิวโซน');
    const zoneEntry = await join(third, { marketDayId, zoneId }).expect(201);
    expect(zoneEntry.body.data).toMatchObject({ stall: null, ahead: 1 });

    await join(third, { marketDayId }).expect(400);
  });

  // ───────────── AC ─────────────

  it('AC: ยกเลิก 1 ล็อคที่มีคิว 3 คน ไม่มีใครยืนยัน → สิทธิ์วนครบทั้ง 3 แล้วล็อคกลับเป็น AVAILABLE', async () => {
    const { marketDayId, stallIds } = await setup(1);
    const stallId = stallIds[0]!;
    const owner = await makeVendor('เจ้าของเดิม');
    const queue = [
      await makeVendor('คิวหนึ่ง'),
      await makeVendor('คิวสอง'),
      await makeVendor('คิวสาม'),
    ];
    const booking = await bookAndConfirm(owner, stallId, marketDayId);
    for (const v of queue) await join(v, { marketDayId, stallId }).expect(201);
    const mine = await http().get('/api/v1/waitlists').set(queue[2]!.headers).expect(200);
    expect((mine.body.data as WaitlistEntry[])[0]).toMatchObject({ ahead: 2 });

    // ล็อคว่าง (เจ้าหน้าที่ยกเลิก) → คิวแรกได้ HOLD ในชื่อตัวเอง
    await http()
      .post(`/api/v1/admin/bookings/${booking.id}/cancel`)
      .set(asAdmin())
      .send({ reason: 'ผู้ค้าแจ้งไม่มา' })
      .expect(200);

    let now = Date.now();
    for (const vendor of queue) {
      const offered = await waitStatus(vendor, marketDayId, 'NOTIFIED');
      const hold = await prisma.booking.findUniqueOrThrow({
        where: { id: offered.offerBookingId! },
      });
      expect(hold).toMatchObject({ vendorId: vendor.id, stallId, status: 'HOLD' });
      // ได้เวลายืนยัน waitlist_claim_minutes
      expect(hold.holdExpiresAt!.getTime() - offered.notifiedAt!.getTime()).toBe(
        CLAIM_MINUTES * MINUTE,
      );
      expect(await stallStatus(vendor, marketDayId, stallId)).toBe('HOLD');
      const list = await http().get('/api/v1/waitlists').set(vendor.headers).expect(200);
      expect((list.body.data as WaitlistEntry[])[0]).toMatchObject({
        status: 'NOTIFIED',
        bookingId: hold.id,
        expiresAt: hold.holdExpiresAt!.toISOString(),
      });
      const notice = await prisma.notificationLog.findFirst({
        where: { template: 'waitlist.offer', vendorId: vendor.id },
      });
      expect(notice).not.toBeNull();

      // ไม่ยืนยันภายในเวลา → หมดเวลา → ส่งต่อคิวถัดไป
      now += (CLAIM_MINUTES + 1) * MINUTE;
      await expireHoldsAt(new Date(now));
      await waitStatus(vendor, marketDayId, 'EXPIRED');
    }

    // ครบทั้ง 3 คิว → ไม่มีใครถือล็อค
    await new Promise((r) => setTimeout(r, 200));
    expect(await prisma.booking.count({ where: { stallId, status: 'HOLD' } })).toBe(0);
    expect(await stallStatus(owner, marketDayId, stallId)).toBe('AVAILABLE');
    expect(
      (
        await prisma.waitlist.findMany({ where: { marketDayId }, orderBy: { position: 'asc' } })
      ).map((w) => w.status),
    ).toEqual(['EXPIRED', 'EXPIRED', 'EXPIRED']);
  });

  // ───────────── ยืนยัน / สละสิทธิ์ / ข้ามคิวที่ไม่มีสิทธิ์ ─────────────

  it('ยืนยัน HOLD จากคิว → FULFILLED และล็อคเป็น BOOKED', async () => {
    const { marketDayId, stallIds } = await setup(1);
    const owner = await makeVendor('เดิม');
    const waiter = await makeVendor('ได้');
    const booking = await bookAndConfirm(owner, stallIds[0]!, marketDayId);
    await join(waiter, { marketDayId, stallId: stallIds[0] }).expect(201);

    // เจ้าของเดิมยกเลิกเอง (ก่อน cancel_before_hours) ก็ส่งสิทธิ์เหมือนกัน
    await http()
      .post(`/api/v1/bookings/${booking.id}/cancel`)
      .set(owner.headers)
      .send({})
      .expect(200);
    const offered = await waitStatus(waiter, marketDayId, 'NOTIFIED');
    const confirmed = await http()
      .post(`/api/v1/bookings/${offered.offerBookingId}/confirm`)
      .set(waiter.headers)
      .expect(200);

    expect(confirmed.body.data.status).toBe('PENDING_PAYMENT');
    await waitStatus(waiter, marketDayId, 'FULFILLED');
    expect(await stallStatus(waiter, marketDayId, stallIds[0]!)).toBe('BOOKED');
  });

  it('ออกจากคิวตอนได้สิทธิ์ = สละ HOLD → คิวถัดไปได้สิทธิ์ทันที', async () => {
    const { marketDayId, stallIds } = await setup(1);
    const owner = await makeVendor('เดิม');
    const [first, second] = [await makeVendor('สละ'), await makeVendor('ถัดไป')];
    const booking = await bookAndConfirm(owner, stallIds[0]!, marketDayId);
    for (const v of [first, second])
      await join(v, { marketDayId, stallId: stallIds[0] }).expect(201);

    await http()
      .post(`/api/v1/admin/bookings/${booking.id}/cancel`)
      .set(asAdmin())
      .send({ reason: 'ทดสอบ' });
    const offered = await waitStatus(first, marketDayId, 'NOTIFIED');
    const left = await http()
      .delete(`/api/v1/waitlists/${offered.id}`)
      .set(first.headers)
      .expect(200);

    expect(left.body.data.status).toBe('CANCELLED');
    expect(
      await prisma.booking.findUniqueOrThrow({ where: { id: offered.offerBookingId! } }),
    ).toMatchObject({ status: 'CANCELLED', cancelReason: 'สละสิทธิ์จากคิวรอ' });
    await waitStatus(second, marketDayId, 'NOTIFIED');
  });

  it('ข้ามคิวที่เกินโควตาวันนั้น (ยังรอต่อ) และคิวทั้งโซนได้สิทธิ์ล็อคใดก็ได้ในโซน', async () => {
    const { marketDayId, zoneId, stallIds } = await setup(2);
    const [a, b, busy, zoneWaiter] = [
      await makeVendor('เอ'),
      await makeVendor('บี'),
      await makeVendor('มีล็อคแล้ว'),
      await makeVendor('รอทั้งโซน'),
    ];
    const bookingA = await bookAndConfirm(a, stallIds[0]!, marketDayId);
    await bookAndConfirm(b, stallIds[1]!, marketDayId);
    // busy เข้าคิว A1 ก่อน แล้วไปได้ล็อคอื่นของวันเดียวกันจากโซนใหม่ (โควตา 1/วัน)
    await join(busy, { marketDayId, stallId: stallIds[0] }).expect(201);
    await join(zoneWaiter, { marketDayId, zoneId }).expect(201);
    const otherZone = await prisma.zone.create({
      data: { marketId, name: 'โซนแยก', color: '#000000' },
    });
    const elsewhere = await prisma.stall.create({
      data: {
        marketId,
        zoneId: otherZone.id,
        code: `Q${++seq}`,
        widthM: 2,
        lengthM: 2,
        price: 100,
        shapeW: 60,
        shapeH: 60,
      },
    });
    await bookAndConfirm(busy, elsewhere.id, marketDayId);

    await http()
      .post(`/api/v1/admin/bookings/${bookingA.id}/cancel`)
      .set(asAdmin())
      .send({ reason: 'ว่าง' });

    await waitStatus(zoneWaiter, marketDayId, 'NOTIFIED');
    expect((await entryOf(busy, marketDayId)).status).toBe('WAITING');
  });

  it('วันขายถูกยกเลิก → ไม่ให้สิทธิ์ใคร', async () => {
    const { marketDayId, stallIds } = await setup(1);
    const owner = await makeVendor('เดิม');
    const waiter = await makeVendor('รอ');
    const booking = await bookAndConfirm(owner, stallIds[0]!, marketDayId);
    await join(waiter, { marketDayId, stallId: stallIds[0] }).expect(201);
    await prisma.marketDay.update({ where: { id: marketDayId }, data: { isCancelled: true } });

    await http()
      .post(`/api/v1/admin/bookings/${booking.id}/cancel`)
      .set(asAdmin())
      .send({ reason: 'x' });
    await new Promise((r) => setTimeout(r, 300));

    expect((await entryOf(waiter, marketDayId)).status).toBe('WAITING');
    expect(await prisma.booking.count({ where: { stallId: stallIds[0], status: 'HOLD' } })).toBe(0);
  });

  // ───────────── admin ─────────────

  it('admin เห็นคิวของวันขายพร้อมชื่อผู้ค้า และนำออกจากคิวได้ (ลง audit log)', async () => {
    const { marketDayId, stallIds } = await setup(1);
    const owner = await makeVendor('เดิม');
    const waiter = await makeVendor('ถูกนำออก');
    await bookAndConfirm(owner, stallIds[0]!, marketDayId);
    await join(waiter, { marketDayId, stallId: stallIds[0] }).expect(201);

    const list = await http()
      .get(`/api/v1/admin/market-days/${marketDayId}/waitlists`)
      .set(asAdmin())
      .expect(200);
    const [entry] = list.body.data as AdminWaitlistEntry[];
    expect(entry).toMatchObject({
      status: 'WAITING',
      position: expect.any(Number),
      vendor: { id: waiter.id, name: `ถูกนำออก ที่${seq}` },
    });

    const removed = await http()
      .delete(`/api/v1/admin/waitlists/${entry!.id}`)
      .set(asAdmin())
      .expect(200);
    expect(removed.body.data.status).toBe('CANCELLED');
    expect(
      await prisma.auditLog.count({ where: { action: 'waitlist.remove', entityId: entry!.id } }),
    ).toBe(1);
    await http().delete(`/api/v1/admin/waitlists/${entry!.id}`).set(asAdmin()).expect(409);
  });
});
