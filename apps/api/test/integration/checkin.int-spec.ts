import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { CheckinDay, CheckinQr, CheckinResult, RoundDetail } from '@market-booking/shared';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { zonedDate } from '../../src/common/zoned-date';
import type { PrismaClient } from '../../src/generated/prisma/client';
import type { AdminPrincipal } from '../../src/modules/auth/principal';
import { TokenService } from '../../src/modules/auth/token.service';
import { newCheckinToken } from '../../src/modules/booking/booking-mapper';
import { NoShowService } from '../../src/modules/checkin/noshow.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { setupApp } from '../../src/setup-app';
import { truncateAll } from './test-db';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const bangkokDate = (offsetDays: number) =>
  zonedDate(new Date(Date.now() + offsetDays * DAY), 'Asia/Bangkok');

describe('Check-in & No-show (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let marketId: string;
  let otherMarketId: string;
  let admin: AdminPrincipal;
  let staff: AdminPrincipal;
  let finance: AdminPrincipal;
  let roundId: string;
  let zoneId: string;
  let seq = 0;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    await truncateAll(prisma as unknown as PrismaClient);

    marketId = (await prisma.market.create({ data: { name: 'ตลาดเช็คอิน', address: '-' } })).id;
    otherMarketId = (await prisma.market.create({ data: { name: 'ตลาดอื่น', address: '-' } })).id;
    const makeAdmin = async (username: string, role: AdminPrincipal['role']) => {
      const row = await prisma.adminUser.create({
        data: { username, passwordHash: 'x', displayName: username, role, marketId },
      });
      return { actorType: 'ADMIN', id: row.id, role, marketId } as AdminPrincipal;
    };
    admin = await makeAdmin('ci-admin', 'ADMIN');
    staff = await makeAdmin('ci-staff', 'STAFF');
    finance = await makeAdmin('ci-finance', 'FINANCE');
    roundId = (
      await prisma.bookingRound.create({
        data: {
          marketId,
          name: 'รอบเช็คอิน',
          openAt: new Date(Date.now() - 30 * DAY),
          closeAt: new Date(Date.now() - 20 * DAY),
          maxStallsPerVendor: 5,
          status: 'PUBLISHED',
          createdById: admin.id,
        },
      })
    ).id;
    zoneId = (await prisma.zone.create({ data: { marketId, name: 'โซน A', color: '#3B82F6' } })).id;
  });

  afterAll(async () => {
    await app.close();
  });

  const tokenOf = (p: Parameters<TokenService['signAccessToken']>[0]) =>
    app.get(TokenService).signAccessToken(p);
  const as = (p: AdminPrincipal) => ({ Authorization: `Bearer ${tokenOf(p)}` });

  async function makeVendor(noshowCount = 0) {
    const n = ++seq;
    const row = await prisma.vendor.create({
      data: {
        marketId,
        firstName: 'ผู้ค้า',
        lastName: `ที่${n}`,
        phone: `08${String(70000000 + n).slice(-8)}`,
        address: '-',
        pdpaConsentAt: new Date(),
        status: 'APPROVED',
        noshowCount,
      },
    });
    const token = tokenOf({ actorType: 'VENDOR', id: row.id, marketId });
    return { id: row.id, headers: { Authorization: `Bearer ${token}` } };
  }
  type Vendor = Awaited<ReturnType<typeof makeVendor>>;

  async function makeDay(offsetDays: number, window?: { openAt: Date; closeAt: Date }) {
    return (
      await prisma.marketDay.create({
        data: {
          marketId,
          roundId,
          marketDate: new Date(`${bangkokDate(offsetDays)}T00:00:00Z`),
          checkinOpenAt: window?.openAt,
          checkinCloseAt: window?.closeAt,
        },
      })
    ).id;
  }

  async function book(
    vendor: Vendor,
    marketDayId: string,
    status: 'CONFIRMED' | 'PENDING_PAYMENT' | 'CANCELLED' = 'CONFIRMED',
  ) {
    const stall = await prisma.stall.create({
      data: {
        marketId,
        zoneId,
        code: `C${++seq}`,
        widthM: 2,
        lengthM: 2,
        price: 100,
        shapeW: 60,
        shapeH: 60,
      },
    });
    const confirmed = status !== 'PENDING_PAYMENT';
    const row = await prisma.booking.create({
      data: {
        marketId,
        vendorId: vendor.id,
        stallId: stall.id,
        marketDayId,
        status,
        amount: 100,
        confirmedAt: confirmed ? new Date() : null,
        checkinToken: confirmed ? newCheckinToken() : null,
        paymentDueAt: confirmed ? null : new Date(Date.now() + DAY),
      },
    });
    return { id: row.id, token: row.checkinToken!, stallCode: stall.code };
  }

  const scan = (marketDayId: string, token: string, p = staff) =>
    http().post('/api/v1/admin/checkin/scan').set(as(p)).send({ marketDayId, token });

  it('ผู้ค้าเปิด QR ได้เฉพาะการจองของตัวเองที่ยืนยันแล้ว — ไม่ตั้งเวลา = ทั้งวันขาย', async () => {
    const dayId = await makeDay(10);
    const vendor = await makeVendor();
    const other = await makeVendor();
    const mine = await book(vendor, dayId);
    const unpaid = await book(vendor, dayId, 'PENDING_PAYMENT');

    const res = await http()
      .get(`/api/v1/bookings/${mine.id}/checkin-qr`)
      .set(vendor.headers)
      .expect(200);
    const qr = res.body.data as CheckinQr;
    expect(qr).toMatchObject({
      token: mine.token,
      stallCode: mine.stallCode,
      marketDate: bangkokDate(10),
      checkedInAt: null,
      noshow: false,
    });
    // 00:00 – 24:00 เวลาไทย = 17:00Z วันก่อน – 17:00Z วันนั้น
    expect(Date.parse(qr.closeAt) - Date.parse(qr.openAt)).toBe(DAY);
    expect(qr.openAt).toBe(new Date(Date.parse(`${bangkokDate(10)}T00:00:00+07:00`)).toISOString());

    await http().get(`/api/v1/bookings/${mine.id}/checkin-qr`).set(other.headers).expect(404);
    const pending = await http()
      .get(`/api/v1/bookings/${unpaid.id}/checkin-qr`)
      .set(vendor.headers)
      .expect(409);
    expect(pending.body.error.code).toBe('INVALID_STATE_TRANSITION');
  });

  it('สแกนซ้ำ → แจ้งว่า check-in แล้ว (ไม่นับซ้ำ); QR วันอื่น/ไม่รู้จัก/ตลาดอื่น/ยกเลิกแล้ว → ปฏิเสธ', async () => {
    const today = await makeDay(0, {
      openAt: new Date(Date.now() - HOUR),
      closeAt: new Date(Date.now() + HOUR),
    });
    const tomorrow = await makeDay(1);
    const vendor = await makeVendor();
    const a = await book(vendor, today);
    const later = await book(vendor, tomorrow);
    const cancelled = await book(vendor, today, 'CANCELLED');

    const first = (await scan(today, a.token).expect(200)).body.data as CheckinResult;
    expect(first).toMatchObject({ alreadyCheckedIn: false, marketDayId: today });
    expect(first.entry).toMatchObject({ bookingId: a.id, stall: { code: a.stallCode } });
    expect(first.entry.checkedInAt).not.toBeNull();

    const again = (await scan(today, a.token, admin).expect(200)).body.data as CheckinResult;
    expect(again.alreadyCheckedIn).toBe(true);
    expect(again.entry.checkedInAt).toBe(first.entry.checkedInAt);
    expect(
      await prisma.auditLog.count({ where: { action: 'booking.checkin', entityId: a.id } }),
    ).toBe(1);

    const wrongDay = await scan(today, later.token).expect(409);
    expect(wrongDay.body.error).toMatchObject({
      code: 'CHECKIN_WRONG_DAY',
      details: { marketDate: bangkokDate(1) },
    });
    expect((await scan(today, newCheckinToken()).expect(404)).body.error.code).toBe(
      'CHECKIN_INVALID',
    );
    expect((await scan(today, cancelled.token).expect(404)).body.error).toMatchObject({
      code: 'CHECKIN_INVALID',
      details: { status: 'CANCELLED' },
    });
    await scan(today, 'not-a-token').expect(400);
    await scan(today, a.token, finance).expect(403);

    // QR ของตลาดอื่นไม่รู้จัก
    const outsider = await prisma.adminUser.create({
      data: {
        username: 'ci-other',
        passwordHash: 'x',
        displayName: 'x',
        role: 'STAFF',
        marketId: otherMarketId,
      },
    });
    const res = await scan(today, a.token, {
      actorType: 'ADMIN',
      id: outsider.id,
      role: 'STAFF',
      marketId: otherMarketId,
    });
    expect(res.status).toBe(404);

    // รายการของวันนี้: เฉพาะที่ยืนยันแล้ว พร้อมสถานะ
    const day = (
      await http()
        .get(`/api/v1/admin/checkin?date=${bangkokDate(0)}`)
        .set(as(staff))
        .expect(200)
    ).body.data as CheckinDay;
    expect(day.marketDay).toMatchObject({ id: today, phase: 'OPEN', noshowProcessed: false });
    expect(day.entries.map((e) => [e.bookingId, e.checkedInAt !== null])).toEqual([[a.id, true]]);
    const none = await http()
      .get(`/api/v1/admin/checkin?date=${bangkokDate(400)}`)
      .set(as(staff));
    expect(none.body.data).toBeNull();
  });

  it('ตั้งเวลา check-in ต่อวันขาย: ก่อนเปิด/หลังปิด → ปฏิเสธ; ค้นหาแล้วกด check-in ได้เมื่อเปิด', async () => {
    const dayId = await makeDay(2);
    const vendor = await makeVendor();
    const b = await book(vendor, dayId);
    const setWindow = (body: object) =>
      http()
        .put(`/api/v1/admin/rounds/${roundId}/market-days/${dayId}/checkin-window`)
        .set(as(admin))
        .send(body);
    const at = (ms: number) => new Date(Date.now() + ms).toISOString();

    await setWindow({ checkinOpenAt: at(HOUR), checkinCloseAt: at(3 * HOUR) }).expect(200);
    const early = await scan(dayId, b.token).expect(409);
    expect(early.body.error.code).toBe('CHECKIN_NOT_OPEN');
    expect(Date.parse(early.body.error.details.openAt)).toBeGreaterThan(Date.now());

    await setWindow({ checkinOpenAt: at(-3 * HOUR), checkinCloseAt: at(-HOUR) }).expect(200);
    expect((await scan(dayId, b.token).expect(409)).body.error.code).toBe('CHECKIN_CLOSED');

    await setWindow({ checkinOpenAt: at(2 * HOUR), checkinCloseAt: at(HOUR) }).expect(400);
    // เปิดอย่างเดียวหลังเวลาปิดค่าเริ่มต้น (24:00 ของวันขาย) → ช่วงว่าง
    await setWindow({ checkinOpenAt: at(30 * DAY), checkinCloseAt: null }).expect(400);
    await setWindow({ checkinOpenAt: at(-HOUR), checkinCloseAt: at(HOUR) })
      .expect(200)
      .expect((res) => {
        const day = (res.body.data as RoundDetail).marketDays.find((d) => d.id === dayId);
        expect(day?.checkinOpenAt).not.toBeNull();
      });
    await http()
      .put(`/api/v1/admin/rounds/${roundId}/market-days/${dayId}/checkin-window`)
      .set(as(staff))
      .send({ checkinOpenAt: null, checkinCloseAt: null })
      .expect(403);

    const manual = await http()
      .post(`/api/v1/admin/checkin/bookings/${b.id}`)
      .set(as(staff))
      .expect(200);
    expect(manual.body.data).toMatchObject({ alreadyCheckedIn: false });
    const qr = await http().get(`/api/v1/bookings/${b.id}/checkin-qr`).set(vendor.headers);
    expect(qr.body.data.checkedInAt).not.toBeNull();
  });

  it('หลังปิด check-in: นับ No-show ครั้งเดียวต่อวัน, ครบเกณฑ์ → ระงับ + แจ้ง; ไม่นับซ้ำ/วันเก่า', async () => {
    await http()
      .put('/api/v1/admin/settings')
      .set(as(admin))
      .send({ noshow_threshold: 2, noshow_suspend_days: 14 })
      .expect(200);
    const noshow = app.get(NoShowService);
    const dayId = await makeDay(-1);
    const oldDay = await makeDay(-10);
    const came = await makeVendor();
    const second = await makeVendor(1); // ครั้งนี้ = ครั้งที่ 2 → ครบเกณฑ์
    const twoStalls = await makeVendor();
    const pendingPay = await makeVendor();

    const ok = await book(came, dayId);
    await prisma.booking.update({ where: { id: ok.id }, data: { checkedInAt: new Date() } });
    const missed = await book(second, dayId);
    const s1 = await book(twoStalls, dayId);
    const s2 = await book(twoStalls, dayId);
    await book(pendingPay, dayId, 'PENDING_PAYMENT');
    await book(second, oldDay);

    expect(await noshow.sweep()).toBe(2);

    const vendors = await prisma.vendor.findMany({
      where: { id: { in: [came.id, second.id, twoStalls.id, pendingPay.id] } },
      select: { id: true, noshowCount: true, status: true, suspendedUntil: true },
    });
    const byId = new Map(vendors.map((v) => [v.id, v]));
    expect(byId.get(came.id)).toMatchObject({ noshowCount: 0, status: 'APPROVED' });
    expect(byId.get(twoStalls.id)).toMatchObject({ noshowCount: 1, status: 'APPROVED' });
    expect(byId.get(pendingPay.id)).toMatchObject({ noshowCount: 0 });
    const suspended = byId.get(second.id)!;
    expect(suspended).toMatchObject({ noshowCount: 2, status: 'SUSPENDED' });
    expect(suspended.suspendedUntil!.getTime() - Date.now()).toBeGreaterThan(13.9 * DAY);

    const bookings = await prisma.booking.findMany({
      where: { id: { in: [ok.id, missed.id, s1.id, s2.id] } },
      select: { id: true, noshowAt: true },
    });
    expect(
      bookings
        .filter((b) => b.noshowAt)
        .map((b) => b.id)
        .sort(),
    ).toEqual([missed.id, s1.id, s2.id].sort());

    const logs = await prisma.notificationLog.findMany({
      where: { vendorId: { in: [second.id, twoStalls.id] } },
      select: { vendorId: true, template: true, payload: true },
    });
    expect(logs.find((l) => l.vendorId === twoStalls.id)).toMatchObject({
      template: 'booking.no_show',
      payload: { count: 1, threshold: 2, marketDate: bangkokDate(-1) },
    });
    expect(logs.filter((l) => l.vendorId === second.id).map((l) => l.template)).toEqual([
      'vendor.suspended',
    ]);
    expect(
      await prisma.auditLog.findFirst({ where: { action: 'vendor.suspend', entityId: second.id } }),
    ).toMatchObject({ actorType: 'SYSTEM' });

    // นับแล้วไม่นับซ้ำ, แก้เวลา check-in ไม่ได้, วันเก่ากว่า 3 วันไม่ย้อนนับ
    expect(await noshow.sweep()).toBe(0);
    await http()
      .put(`/api/v1/admin/rounds/${roundId}/market-days/${dayId}/checkin-window`)
      .set(as(admin))
      .send({ checkinOpenAt: null, checkinCloseAt: null })
      .expect(409);
    expect(
      (await prisma.marketDay.findUniqueOrThrow({ where: { id: oldDay } })).noshowProcessedAt,
    ).toBeNull();
    const qr = await http().get(`/api/v1/bookings/${s1.id}/checkin-qr`).set(twoStalls.headers);
    expect(qr.body.data.noshow).toBe(true);
  });
});
