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
import { PrismaService } from '../../src/prisma/prisma.service';
import { setupApp } from '../../src/setup-app';
import { truncateAll } from './test-db';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const dateIn = (days: number) => zonedDate(new Date(Date.now() + days * DAY), 'Asia/Bangkok');

describe('Bookings: hold / confirm / cancel (integration)', () => {
  let app: INestApplication;
  let url: string;
  let prisma: PrismaService;
  let marketId: string;
  let otherMarketId: string;
  let admin: AdminPrincipal;
  let staff: AdminPrincipal;
  let finance: AdminPrincipal;
  let otherMarketAdmin: AdminPrincipal;
  let foodCategoryId: string;
  let clothCategoryId: string;
  let generalZoneId: string;
  let foodZoneId: string;
  /** วันขายของรอบที่เปิดจองอยู่ (จองได้ 1 ล็อค/วัน) */
  let dayQuota1: string;
  /** วันขายของรอบที่เปิดจองอยู่ (จองได้ 2 ล็อค/วัน) */
  let dayQuota2: string;
  /** วันขายของรอบที่ยังไม่เปิด */
  let upcomingDay: string;
  let seq = 0;
  const events: BookingChangedEvent[] = [];
  const http = () => request(url);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    // ฟังพอร์ตจริง — ยิง request พร้อมกันหลายสิบตัวโดยไม่เปิด server ใหม่ทุกตัว
    await app.listen(0);
    url = (await app.getUrl()).replace('[::1]', 'localhost');
    prisma = app.get(PrismaService);
    app.get(BookingEvents).onChanged((e) => {
      events.push(e);
    });

    await truncateAll(prisma as unknown as PrismaClient);
    marketId = (await prisma.market.create({ data: { name: 'ตลาดหลัก', address: '-' } })).id;
    otherMarketId = (await prisma.market.create({ data: { name: 'ตลาดอื่น', address: '-' } })).id;

    const makeAdmin = async (
      username: string,
      role: AdminPrincipal['role'],
      mkt: string | null = marketId,
    ): Promise<AdminPrincipal> => {
      const row = await prisma.adminUser.create({
        data: { username, passwordHash: 'x', displayName: username, role, marketId: mkt },
      });
      return { actorType: 'ADMIN', id: row.id, role, marketId: mkt };
    };
    admin = await makeAdmin('admin', 'ADMIN');
    staff = await makeAdmin('staff', 'STAFF');
    finance = await makeAdmin('finance', 'FINANCE');
    otherMarketAdmin = await makeAdmin('other', 'ADMIN', otherMarketId);

    foodCategoryId = (await prisma.productCategory.create({ data: { marketId, name: 'อาหาร' } }))
      .id;
    clothCategoryId = (
      await prisma.productCategory.create({ data: { marketId, name: 'เสื้อผ้า' } })
    ).id;
    generalZoneId = (
      await prisma.zone.create({
        data: { marketId, name: 'ทั่วไป', color: '#3B82F6', sortOrder: 0 },
      })
    ).id;
    foodZoneId = (
      await prisma.zone.create({
        data: {
          marketId,
          name: 'อาหาร',
          color: '#F59E0B',
          sortOrder: 1,
          allowedCategoryIds: [foodCategoryId],
        },
      })
    ).id;

    const openRound = async (max: number, date: string) => {
      const round = await prisma.bookingRound.create({
        data: {
          marketId,
          name: `รอบเปิด ${max}`,
          openAt: new Date(Date.now() - HOUR),
          closeAt: new Date(Date.now() + DAY),
          maxStallsPerVendor: max,
          status: 'PUBLISHED',
          createdById: admin.id,
        },
      });
      return (
        await prisma.marketDay.create({
          data: { marketId, roundId: round.id, marketDate: new Date(`${date}T00:00:00Z`) },
        })
      ).id;
    };
    dayQuota1 = await openRound(1, dateIn(5));
    dayQuota2 = await openRound(2, dateIn(6));
    const upcoming = await prisma.bookingRound.create({
      data: {
        marketId,
        name: 'รอบถัดไป',
        openAt: new Date(Date.now() + HOUR),
        closeAt: new Date(Date.now() + DAY),
        maxStallsPerVendor: 1,
        status: 'PUBLISHED',
        createdById: admin.id,
      },
    });
    upcomingDay = (
      await prisma.marketDay.create({
        data: {
          marketId,
          roundId: upcoming.id,
          marketDate: new Date(`${dateIn(7)}T00:00:00Z`),
        },
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

  const token = (p: AdminPrincipal) => `Bearer ${app.get(TokenService).signAccessToken(p)}`;
  const asAdmin = (p: AdminPrincipal = admin) => ({ Authorization: token(p) });

  async function makeVendor(
    opts: {
      status?: 'APPROVED' | 'PENDING' | 'SUSPENDED';
      categoryId?: string | null;
      market?: string;
    } = {},
  ) {
    const phone = `08${String(40000000 + ++seq).slice(-8)}`;
    const row = await prisma.vendor.create({
      data: {
        marketId: opts.market ?? marketId,
        firstName: 'ผู้ค้า',
        lastName: phone,
        phone,
        address: '-',
        pdpaConsentAt: new Date(),
        status: opts.status ?? 'APPROVED',
        productCategoryId: opts.categoryId === undefined ? foodCategoryId : opts.categoryId,
        ...(opts.status === 'SUSPENDED' && { suspendedUntil: new Date(Date.now() + DAY) }),
      },
    });
    const access = app.get(TokenService).signAccessToken({
      actorType: 'VENDOR',
      id: row.id,
      marketId: opts.market ?? marketId,
    });
    return { id: row.id, headers: { Authorization: `Bearer ${access}` } };
  }
  type Vendor = Awaited<ReturnType<typeof makeVendor>>;

  async function makeStall(
    opts: { zoneId?: string; price?: number; isReserved?: boolean; isActive?: boolean } = {},
  ) {
    const row = await prisma.stall.create({
      data: {
        marketId,
        zoneId: opts.zoneId ?? generalZoneId,
        code: `S${++seq}`,
        widthM: 2,
        lengthM: 2,
        price: opts.price ?? 100,
        posX: 0,
        posY: 0,
        shapeW: 60,
        shapeH: 60,
        isReserved: opts.isReserved ?? false,
        isActive: opts.isActive ?? true,
      },
    });
    return row.id;
  }

  const hold = (vendor: Vendor, stallId: string, marketDayId = dayQuota2) =>
    http().post('/api/v1/bookings/hold').set(vendor.headers).send({ stallId, marketDayId });

  async function holdOk(vendor: Vendor, stallId: string, marketDayId = dayQuota2) {
    const res = await hold(vendor, stallId, marketDayId).expect(201);
    return res.body.data as Booking;
  }

  const confirm = (vendor: Vendor, id: string) =>
    http().post(`/api/v1/bookings/${id}/confirm`).set(vendor.headers);

  async function setSettings(body: Record<string, unknown>) {
    await http().put('/api/v1/admin/settings').set(asAdmin()).send(body).expect(200);
  }

  async function dayStalls(vendor: Vendor, marketDayId = dayQuota2) {
    const res = await http()
      .get(`/api/v1/market-days/${marketDayId}/stalls`)
      .set(vendor.headers)
      .expect(200);
    return new Map((res.body.data as MarketDayStalls).stalls.map((s) => [s.id, s]));
  }

  // ───────────── Acceptance Criteria ─────────────

  it('AC: 50 request พร้อมกันจองล็อคเดียว → สำเร็จ 1, ที่เหลือ STALL_TAKEN', async () => {
    const stallId = await makeStall();
    const vendors = await Promise.all(Array.from({ length: 50 }, () => makeVendor()));

    const results = await Promise.all(vendors.map((v) => hold(v, stallId, dayQuota1)));

    const ok = results.filter((r) => r.status === 201);
    const taken = results.filter((r) => r.status === 409);
    expect(ok).toHaveLength(1);
    expect(taken).toHaveLength(49);
    expect(taken.every((r) => r.body.error.code === 'STALL_TAKEN')).toBe(true);
    expect(
      await prisma.booking.count({ where: { stallId, marketDayId: dayQuota1, status: 'HOLD' } }),
    ).toBe(1);
    // event ส่งเฉพาะรายการที่สำเร็จ
    expect(events.filter((e) => e.stallId === stallId)).toHaveLength(1);
  });

  it('AC: โควตา 1 ยิง hold 2 ล็อคพร้อมกัน → สำเร็จ 1, อีกอัน QUOTA_EXCEEDED', async () => {
    const [a, b] = [await makeStall(), await makeStall()];
    const vendor = await makeVendor();

    const results = await Promise.all([hold(vendor, a, dayQuota1), hold(vendor, b, dayQuota1)]);

    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    const failed = results.find((r) => r.status === 409);
    expect(failed?.body.error).toMatchObject({ code: 'QUOTA_EXCEEDED', details: { limit: 1 } });
    expect(await prisma.booking.count({ where: { vendorId: vendor.id, status: 'HOLD' } })).toBe(1);
  });

  // ───────────── hold ─────────────

  describe('POST /bookings/hold', () => {
    it('สำเร็จ: HOLD, ราคาเฉพาะวัน (override) ถูกเก็บเป็น amount, หมดเวลาตาม hold_minutes', async () => {
      const stallId = await makeStall({ price: 100 });
      await prisma.stallDayOverride.create({
        data: { stallId, marketDayId: dayQuota2, priceOverride: 175.5 },
      });
      const vendor = await makeVendor();
      const before = Date.now();

      const booking = await holdOk(vendor, stallId);

      expect(booking).toMatchObject({
        status: 'HOLD',
        amount: 175.5,
        stall: { id: stallId, zoneName: 'ทั่วไป' },
        marketDay: { id: dayQuota2, marketDate: dateIn(6), roundName: 'รอบเปิด 2' },
        paymentDueAt: null,
      });
      const expires = Date.parse(booking.holdExpiresAt ?? '');
      expect(expires).toBeGreaterThanOrEqual(before + 10 * 60_000);
      expect(expires).toBeLessThanOrEqual(Date.now() + 10 * 60_000);
      expect(events).toEqual([
        expect.objectContaining({
          bookingId: booking.id,
          stallId,
          vendorId: vendor.id,
          marketDayId: dayQuota2,
          status: 'HOLD',
        }),
      ]);
    });

    it('ล็อคที่ตัวเองจองอยู่แล้ว → STALL_TAKEN พร้อม mine: true', async () => {
      const stallId = await makeStall();
      const vendor = await makeVendor();
      await holdOk(vendor, stallId);
      const again = await hold(vendor, stallId).expect(409);
      expect(again.body.error).toMatchObject({ code: 'STALL_TAKEN', details: { mine: true } });
      const other = await hold(await makeVendor(), stallId).expect(409);
      expect(other.body.error.details).toEqual({ mine: false });
    });

    it('รอบยังไม่เปิด → ROUND_NOT_OPEN; วันขายตลาดอื่น/ไม่มี → 404', async () => {
      const stallId = await makeStall();
      const vendor = await makeVendor();
      const res = await hold(vendor, stallId, upcomingDay).expect(409);
      expect(res.body.error).toMatchObject({
        code: 'ROUND_NOT_OPEN',
        details: { phase: 'UPCOMING' },
      });
      const outsider = await makeVendor({ market: otherMarketId });
      await hold(outsider, stallId, dayQuota2).expect(404);
    });

    it('ล็อคสงวน / ปิดเฉพาะวัน / ปิดใช้งาน → STALL_UNAVAILABLE', async () => {
      const reserved = await makeStall({ isReserved: true });
      const inactive = await makeStall({ isActive: false });
      const closed = await makeStall();
      await prisma.stallDayOverride.create({
        data: { stallId: closed, marketDayId: dayQuota2, isClosed: true },
      });
      for (const stallId of [reserved, inactive, closed]) {
        const res = await hold(await makeVendor(), stallId).expect(409);
        expect(res.body.error.code).toBe('STALL_UNAVAILABLE');
      }
    });

    it('ประเภทสินค้าไม่ตรงโซน (หรือไม่ได้เลือกประเภท) → CATEGORY_NOT_ALLOWED (422)', async () => {
      const stallId = await makeStall({ zoneId: foodZoneId });
      for (const categoryId of [clothCategoryId, null]) {
        const res = await hold(await makeVendor({ categoryId }), stallId).expect(422);
        expect(res.body.error.code).toBe('CATEGORY_NOT_ALLOWED');
      }
      await holdOk(await makeVendor({ categoryId: foodCategoryId }), stallId);
    });

    it('ผู้ค้ายังไม่อนุมัติ / ถูกระงับ → 403; body ผิด → 400', async () => {
      const stallId = await makeStall();
      const pending = await hold(await makeVendor({ status: 'PENDING' }), stallId).expect(403);
      expect(pending.body.error.code).toBe('VENDOR_NOT_APPROVED');
      const suspended = await hold(await makeVendor({ status: 'SUSPENDED' }), stallId).expect(403);
      expect(suspended.body.error.code).toBe('VENDOR_SUSPENDED');
      await http()
        .post('/api/v1/bookings/hold')
        .set((await makeVendor()).headers)
        .send({ stallId: 'nope', marketDayId: dayQuota2 })
        .expect(400);
    });

    it('hold ที่หมดเวลาแล้ว (worker ยังไม่ทำงาน) ไม่กันล็อค: คนอื่นจองได้ และของเดิมเป็น EXPIRED', async () => {
      const stallId = await makeStall();
      const first = await makeVendor();
      const old = await holdOk(first, stallId, dayQuota1);
      await prisma.booking.update({
        where: { id: old.id },
        data: { holdExpiresAt: new Date(Date.now() - 1000) },
      });

      const second = await makeVendor();
      expect((await dayStalls(second, dayQuota1)).get(stallId)?.status).toBe('AVAILABLE');
      events.length = 0;
      await holdOk(second, stallId, dayQuota1);

      expect((await prisma.booking.findUniqueOrThrow({ where: { id: old.id } })).status).toBe(
        'EXPIRED',
      );
      expect(events.map((e) => [e.bookingId === old.id ? 'old' : 'new', e.status])).toEqual([
        ['old', 'EXPIRED'],
        ['new', 'HOLD'],
      ]);
      // hold ที่หมดเวลาไม่กินโควตา (วันนี้จองได้ 1 ล็อค)
      await holdOk(first, await makeStall(), dayQuota1);
    });

    it('rate limit: จองเกิน 5 ครั้งใน 10 วินาที → RATE_LIMITED (429)', async () => {
      const vendor = await makeVendor();
      const stallId = await makeStall();
      for (let i = 0; i < 5; i++) await hold(vendor, stallId, upcomingDay).expect(409);
      const res = await hold(vendor, stallId, upcomingDay).expect(429);
      expect(res.body.error.code).toBe('RATE_LIMITED');
      expect(res.body.error.details.retryAfterSeconds).toBeGreaterThan(0);
    });
  });

  // ───────────── confirm ─────────────

  describe('POST /bookings/:id/confirm', () => {
    afterEach(async () => {
      await setSettings({ payment_required: true });
    });

    it('ต้องชำระเงิน → PENDING_PAYMENT ตั้ง payment_due_at; ยืนยันซ้ำ → INVALID_STATE_TRANSITION', async () => {
      const vendor = await makeVendor();
      const booking = await holdOk(vendor, await makeStall());
      const before = Date.now();
      const res = await confirm(vendor, booking.id).expect(200);
      expect(res.body.data).toMatchObject({ status: 'PENDING_PAYMENT', confirmedAt: null });
      const due = Date.parse(res.body.data.paymentDueAt);
      expect(due).toBeGreaterThanOrEqual(before + 1440 * 60_000);
      expect(events.at(-1)).toMatchObject({ bookingId: booking.id, status: 'PENDING_PAYMENT' });

      const again = await confirm(vendor, booking.id).expect(409);
      expect(again.body.error).toMatchObject({
        code: 'INVALID_STATE_TRANSITION',
        details: { status: 'PENDING_PAYMENT' },
      });
    });

    it('ไม่ต้องชำระเงิน หรือราคา 0 → CONFIRMED', async () => {
      const vendor = await makeVendor();
      const free = await holdOk(vendor, await makeStall({ price: 0 }));
      const res = await confirm(vendor, free.id).expect(200);
      expect(res.body.data).toMatchObject({ status: 'CONFIRMED', paymentDueAt: null });
      expect(res.body.data.confirmedAt).not.toBeNull();

      await setSettings({ payment_required: false });
      const other = await makeVendor();
      const paid = await holdOk(other, await makeStall({ price: 300 }));
      expect((await confirm(other, paid.id).expect(200)).body.data.status).toBe('CONFIRMED');
    });

    it('hold หมดเวลา → HOLD_EXPIRED และสถานะเป็น EXPIRED; การจองของคนอื่น → 404', async () => {
      const vendor = await makeVendor();
      const booking = await holdOk(vendor, await makeStall());
      await confirm(await makeVendor(), booking.id).expect(404);

      await prisma.booking.update({
        where: { id: booking.id },
        data: { holdExpiresAt: new Date(Date.now() - 1) },
      });
      const res = await confirm(vendor, booking.id).expect(409);
      expect(res.body.error.code).toBe('HOLD_EXPIRED');
      expect((await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).status).toBe(
        'EXPIRED',
      );
      expect(events.at(-1)).toMatchObject({ bookingId: booking.id, status: 'EXPIRED' });
    });
  });

  // ───────────── cancel ─────────────

  describe('ยกเลิกการจอง', () => {
    afterEach(async () => {
      await setSettings({ cancel_before_hours: 48 });
    });

    it('ผู้ค้ายกเลิก HOLD ได้ทุกเมื่อ → ล็อคว่างให้คนอื่นจอง; ยกเลิกซ้ำ → INVALID_STATE_TRANSITION', async () => {
      const stallId = await makeStall();
      const vendor = await makeVendor();
      const booking = await holdOk(vendor, stallId);
      await setSettings({ cancel_before_hours: 720 });

      const res = await http()
        .post(`/api/v1/bookings/${booking.id}/cancel`)
        .set(vendor.headers)
        .send({ reason: 'เปลี่ยนใจ' })
        .expect(200);
      expect(res.body.data).toMatchObject({
        status: 'CANCELLED',
        cancelReason: 'เปลี่ยนใจ',
        cancelledByAdmin: false,
      });
      expect(events.at(-1)).toMatchObject({ bookingId: booking.id, status: 'CANCELLED' });
      await holdOk(await makeVendor(), stallId);

      const again = await http()
        .post(`/api/v1/bookings/${booking.id}/cancel`)
        .set(vendor.headers)
        .send({})
        .expect(409);
      expect(again.body.error.code).toBe('INVALID_STATE_TRANSITION');
    });

    it('ยืนยันแล้วยกเลิกได้ถ้าเหลือเวลาก่อนวันขาย ≥ cancel_before_hours ไม่งั้น CANCEL_WINDOW_PASSED', async () => {
      const vendor = await makeVendor();
      const late = await holdOk(vendor, await makeStall());
      await confirm(vendor, late.id).expect(200);

      // วันขายอีก ~6 วัน (144 ชม.) — ตั้งให้ต้องยกเลิกก่อน 200 ชม.
      await setSettings({ cancel_before_hours: 200 });
      const res = await http()
        .post(`/api/v1/bookings/${late.id}/cancel`)
        .set(vendor.headers)
        .send({})
        .expect(409);
      expect(res.body.error).toMatchObject({
        code: 'CANCEL_WINDOW_PASSED',
        details: { cancelBeforeHours: 200 },
      });
      // deadline = 00:00 วันขาย (เวลาไทย) − 200 ชม.
      expect(res.body.error.details.deadline).toBe(
        new Date(Date.parse(`${dateIn(6)}T00:00:00+07:00`) - 200 * HOUR).toISOString(),
      );

      await setSettings({ cancel_before_hours: 48 });
      await http()
        .post(`/api/v1/bookings/${late.id}/cancel`)
        .set(vendor.headers)
        .send({})
        .expect(200);
    });

    it('admin ยกเลิกแทน: ต้องมีเหตุผล, STAFF ได้, FINANCE ไม่ได้, ตลาดอื่นไม่พบ, ลง audit', async () => {
      const vendor = await makeVendor();
      const booking = await holdOk(vendor, await makeStall());
      await confirm(vendor, booking.id).expect(200);
      const path = `/api/v1/admin/bookings/${booking.id}/cancel`;

      await http().post(path).set(asAdmin(staff)).send({}).expect(400);
      await http().post(path).set(asAdmin(finance)).send({ reason: 'x' }).expect(403);
      await http().post(path).set(asAdmin(otherMarketAdmin)).send({ reason: 'x' }).expect(404);

      const res = await http()
        .post(path)
        .set(asAdmin(staff))
        .send({ reason: 'ผู้ค้าแจ้งยกเลิกทางโทรศัพท์' })
        .expect(200);
      expect(res.body.data).toMatchObject({ status: 'CANCELLED', cancelledByAdmin: true });
      const log = await prisma.auditLog.findFirst({
        where: { entityId: booking.id, action: 'booking.cancel' },
      });
      expect(log).toMatchObject({
        actorId: staff.id,
        before: { status: 'PENDING_PAYMENT' },
        after: { status: 'CANCELLED', reason: 'ผู้ค้าแจ้งยกเลิกทางโทรศัพท์' },
      });
      await http().post(path).set(asAdmin()).send({ reason: 'ซ้ำ' }).expect(409);
    });
  });

  // ───────────── อ่านข้อมูล ─────────────

  it('GET /bookings/me: เฉพาะของตัวเอง, hold ที่หมดเวลาแสดงเป็น EXPIRED', async () => {
    const vendor = await makeVendor();
    const stallId = await makeStall();
    const lapsed = await holdOk(vendor, stallId);
    await prisma.booking.update({
      where: { id: lapsed.id },
      data: { holdExpiresAt: new Date(Date.now() - 1000) },
    });
    const current = await holdOk(vendor, await makeStall(), dayQuota1);
    await holdOk(await makeVendor(), await makeStall());

    const res = await http().get('/api/v1/bookings/me').set(vendor.headers).expect(200);
    const mine = res.body.data as Booking[];
    expect(mine.map((b) => [b.id, b.status])).toEqual([
      [lapsed.id, 'EXPIRED'], // วันขายล่าสุดก่อน (dayQuota2 อยู่หลัง dayQuota1)
      [current.id, 'HOLD'],
    ]);
  });

  it('ผัง /market-days/:id/stalls: HOLD/BOOKED/CLOSED, mine และ bookingId เฉพาะของตัวเอง', async () => {
    const owner = await makeVendor();
    const viewer = await makeVendor();
    const [held, booked, reserved, free] = [
      await makeStall(),
      await makeStall(),
      await makeStall({ isReserved: true }),
      await makeStall(),
    ];
    const heldBooking = await holdOk(owner, held);
    const other = await makeVendor();
    const b = await holdOk(other, booked);
    await confirm(other, b.id).expect(200);

    const asOwner = await dayStalls(owner);
    expect(asOwner.get(held)).toMatchObject({
      status: 'HOLD',
      mine: true,
      bookingId: heldBooking.id,
    });
    expect(asOwner.get(booked)).toMatchObject({ status: 'BOOKED', mine: false, bookingId: null });

    const asViewer = await dayStalls(viewer);
    expect(asViewer.get(held)).toMatchObject({ status: 'HOLD', mine: false, bookingId: null });
    expect(asViewer.get(reserved)).toMatchObject({ status: 'CLOSED', mine: false });
    expect(asViewer.get(free)).toMatchObject({ status: 'AVAILABLE', bookingId: null });
    // ไม่มีข้อมูลผู้ค้าคนอื่นในผัง
    expect(JSON.stringify([...asViewer.values()])).not.toContain(owner.id);
  });
});
