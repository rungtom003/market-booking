import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  SOCKET_NAMESPACE,
  SocketEvent,
  type AdminBooking,
  type AdminMarketDayOption,
  type AdminMarketDayStalls,
  type Booking,
  type BookingChangedPayload,
  type StallUpdatedPayload,
} from '@market-booking/shared';
import ExcelJS from 'exceljs';
import { type Socket, io } from 'socket.io-client';
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

function nextEvent<T>(socket: Socket, event: string, match: (p: T) => boolean, ms = 2_000) {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`No ${event}`)), ms);
    const handler = (p: T) => {
      if (!match(p)) return;
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(p);
    };
    socket.on(event, handler);
  });
}

describe('Admin booking management (integration)', () => {
  let app: INestApplication;
  let url: string;
  let prisma: PrismaService;
  let marketId: string;
  let otherMarketId: string;
  let admin: AdminPrincipal;
  let staff: AdminPrincipal;
  let finance: AdminPrincipal;
  let otherAdmin: AdminPrincipal;
  let zoneId: string;
  let seq = 0;
  let dayOffset = 3;
  const sockets: Socket[] = [];
  const events: BookingChangedEvent[] = [];
  const http = () => request(url);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
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
    otherAdmin = await makeAdmin('other', 'ADMIN', otherMarketId);
    zoneId = (
      await prisma.zone.create({
        data: { marketId, name: 'ทั่วไป', color: '#3B82F6', sortOrder: 0 },
      })
    ).id;
  });

  afterEach(() => {
    sockets.splice(0).forEach((s) => s.disconnect());
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    events.length = 0;
  });

  // ───────────── helpers ─────────────

  const tokenOf = (p: Parameters<TokenService['signAccessToken']>[0]) =>
    app.get(TokenService).signAccessToken(p);
  const asAdmin = (p: AdminPrincipal = admin) => ({ Authorization: `Bearer ${tokenOf(p)}` });

  async function makeVendor(
    opts: { status?: 'APPROVED' | 'PENDING'; firstName?: string; shopName?: string } = {},
  ) {
    const phone = `08${String(70000000 + ++seq).slice(-8)}`;
    const row = await prisma.vendor.create({
      data: {
        marketId,
        firstName: opts.firstName ?? 'ผู้ค้า',
        lastName: `ที่${seq}`,
        shopName: opts.shopName ?? null,
        phone,
        address: '-',
        pdpaConsentAt: new Date(),
        status: opts.status ?? 'APPROVED',
      },
    });
    const token = tokenOf({ actorType: 'VENDOR', id: row.id, marketId });
    return { id: row.id, phone, token, headers: { Authorization: `Bearer ${token}` } };
  }

  async function makeStall(code: string, opts: { isReserved?: boolean; isActive?: boolean } = {}) {
    return (
      await prisma.stall.create({
        data: {
          marketId,
          zoneId,
          code: `${code}-${seq++}`,
          widthM: 2,
          lengthM: 2,
          price: 100,
          posX: 0,
          posY: 0,
          shapeW: 60,
          shapeH: 60,
          isReserved: opts.isReserved ?? false,
          isActive: opts.isActive ?? true,
        },
      })
    ).id;
  }

  /** รอบ + วันขาย — ค่าเริ่มต้นเปิดจองอยู่ จองได้ 1 ล็อค/วัน */
  async function makeDay(
    opts: { status?: 'PUBLISHED' | 'DRAFT'; openInMs?: number; mkt?: string } = {},
  ) {
    const round = await prisma.bookingRound.create({
      data: {
        marketId: opts.mkt ?? marketId,
        name: `รอบ ${seq++}`,
        openAt: new Date(Date.now() + (opts.openInMs ?? -HOUR)),
        closeAt: new Date(Date.now() + DAY),
        maxStallsPerVendor: 1,
        status: opts.status ?? 'PUBLISHED',
        createdById: admin.id,
      },
    });
    const date = zonedDate(new Date(Date.now() + dayOffset++ * DAY), 'Asia/Bangkok');
    const day = await prisma.marketDay.create({
      data: {
        marketId: opts.mkt ?? marketId,
        roundId: round.id,
        marketDate: new Date(`${date}T00:00:00Z`),
      },
    });
    return { roundId: round.id, dayId: day.id, date };
  }

  async function hold(vendor: { headers: Record<string, string> }, stallId: string, dayId: string) {
    const res = await http()
      .post('/api/v1/bookings/hold')
      .set(vendor.headers)
      .send({ stallId, marketDayId: dayId })
      .expect(201);
    return res.body.data as Booking;
  }

  async function connect(token: string) {
    const socket = io(`${url}${SOCKET_NAMESPACE}`, {
      auth: { token },
      transports: ['websocket'],
      reconnection: false,
    });
    sockets.push(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', () => resolve());
      socket.once('connect_error', reject);
    });
    return socket;
  }

  // ───────────── Acceptance Criteria ─────────────

  it('AC: admin ยกเลิก → เจ้าของและผู้ดูผังคนอื่นเห็นทันที + มี audit log', async () => {
    const { dayId } = await makeDay();
    const stallId = await makeStall('C');
    const owner = await makeVendor();
    const viewer = await makeVendor();
    const booking = await hold(owner, stallId, dayId);
    await http().post(`/api/v1/bookings/${booking.id}/confirm`).set(owner.headers).expect(200);

    const ownerSocket = await connect(owner.token);
    const viewerSocket = await connect(viewer.token);
    const adminSocket = await connect(tokenOf(staff));
    for (const s of [ownerSocket, viewerSocket, adminSocket]) {
      expect(await s.emitWithAck(SocketEvent.MD_JOIN, { marketDayId: dayId })).toEqual({
        ok: true,
      });
    }
    const forStall = (p: StallUpdatedPayload) => p.stallId === stallId;
    const seenByViewer = nextEvent<StallUpdatedPayload>(
      viewerSocket,
      SocketEvent.STALL_UPDATED,
      forStall,
      1_000,
    );
    const seenByOwner = nextEvent<StallUpdatedPayload>(
      ownerSocket,
      SocketEvent.STALL_UPDATED,
      forStall,
      1_000,
    );
    const seenByAdmin = nextEvent<StallUpdatedPayload>(
      adminSocket,
      SocketEvent.STALL_UPDATED,
      forStall,
      1_000,
    );
    const ownerBooking = nextEvent<BookingChangedPayload>(
      ownerSocket,
      SocketEvent.BOOKING_CHANGED,
      (p) => p.bookingId === booking.id,
      1_000,
    );

    const res = await http()
      .post(`/api/v1/admin/bookings/${booking.id}/cancel`)
      .set(asAdmin(staff))
      .send({ reason: 'ล็อคต้องใช้จัดงานพิเศษ' })
      .expect(200);
    expect(res.body.data).toMatchObject({ status: 'CANCELLED', cancelledByAdmin: true });

    expect(await seenByViewer).toMatchObject({ state: 'AVAILABLE', mine: false });
    expect(await seenByOwner).toMatchObject({ state: 'AVAILABLE', mine: false });
    expect(await seenByAdmin).toMatchObject({ state: 'AVAILABLE' });
    expect((await ownerBooking).status).toBe('CANCELLED');

    const log = await prisma.auditLog.findFirst({
      where: { entityId: booking.id, action: 'booking.cancel' },
    });
    expect(log).toMatchObject({
      actorId: staff.id,
      before: { status: 'PENDING_PAYMENT' },
      after: { status: 'CANCELLED', reason: 'ล็อคต้องใช้จัดงานพิเศษ' },
    });
    const mine = await http().get('/api/v1/bookings/me').set(owner.headers).expect(200);
    expect(mine.body.data[0]).toMatchObject({
      id: booking.id,
      status: 'CANCELLED',
      cancelReason: 'ล็อคต้องใช้จัดงานพิเศษ',
      cancelledByAdmin: true,
    });
  });

  // ───────────── รายการ / ผัง ─────────────

  it('GET /admin/bookings: กรองวัน/สถานะ/ค้นหา + ข้อมูลผู้ค้า; FINANCE ไม่มีสิทธิ์', async () => {
    const { dayId } = await makeDay();
    const somchai = await makeVendor({ firstName: 'สมชายค้นหา', shopName: 'ร้านหมูปิ้ง' });
    const other = await makeVendor();
    const a = await hold(somchai, await makeStall('Q'), dayId);
    const b = await hold(other, await makeStall('Q'), dayId);
    await http().post(`/api/v1/bookings/${b.id}/cancel`).set(other.headers).send({}).expect(200);

    const list = async (query: Record<string, string>) =>
      (await http().get('/api/v1/admin/bookings').query(query).set(asAdmin(staff)).expect(200))
        .body as { data: AdminBooking[]; meta: { total: number } };

    const all = await list({ marketDayId: dayId });
    expect(all.meta.total).toBe(2);
    expect((await list({ marketDayId: dayId, status: 'ACTIVE' })).data.map((x) => x.id)).toEqual([
      a.id,
    ]);
    expect((await list({ marketDayId: dayId, status: 'CANCELLED' })).data.map((x) => x.id)).toEqual(
      [b.id],
    );
    const found = await list({ q: 'ค้นหา' });
    expect(found.data).toEqual([
      expect.objectContaining({
        id: a.id,
        vendor: {
          id: somchai.id,
          name: expect.stringMatching(/^สมชายค้นหา /),
          shopName: 'ร้านหมูปิ้ง',
          phone: somchai.phone,
        },
      }),
    ]);
    expect((await list({ q: somchai.phone.slice(-6) })).data.map((x) => x.id)).toEqual([a.id]);
    expect((await list({ q: a.stall.code.toLowerCase() })).data.map((x) => x.id)).toEqual([a.id]);

    await http().get('/api/v1/admin/bookings').set(asAdmin(finance)).expect(403);
    const outsider = await http()
      .get('/api/v1/admin/bookings')
      .query({ marketDayId: dayId })
      .set(asAdmin(otherAdmin))
      .expect(200);
    expect(outsider.body.data).toEqual([]);
  });

  it('GET /admin/market-days + /:id/stalls: เฉพาะรอบที่ไม่ใช่ DRAFT, ผังมีชื่อผู้ค้า (ผู้ค้าไม่เห็น)', async () => {
    const draft = await makeDay({ status: 'DRAFT' });
    const { dayId } = await makeDay();
    const stallId = await makeStall('M');
    const vendor = await makeVendor({ firstName: 'เจ้าของล็อค' });
    await hold(vendor, stallId, dayId);

    const days = (await http().get('/api/v1/admin/market-days').set(asAdmin(staff)).expect(200))
      .body.data as AdminMarketDayOption[];
    expect(days.some((d) => d.id === draft.dayId)).toBe(false);
    expect(days.find((d) => d.id === dayId)).toMatchObject({
      activeBookings: 1,
      isCancelled: false,
    });

    const map = (
      await http().get(`/api/v1/admin/market-days/${dayId}/stalls`).set(asAdmin(staff)).expect(200)
    ).body.data as AdminMarketDayStalls;
    expect(map.stalls.find((s) => s.id === stallId)).toMatchObject({
      status: 'HOLD',
      booking: { status: 'HOLD', amount: 100, vendor: { id: vendor.id, phone: vendor.phone } },
    });
    expect(map.stalls.find((s) => s.id !== stallId)?.booking ?? null).toBeNull();

    const asVendor = await http()
      .get(`/api/v1/market-days/${dayId}/stalls`)
      .set((await makeVendor()).headers)
      .expect(200);
    expect(JSON.stringify(asVendor.body.data)).not.toContain('เจ้าของล็อค');
    await http().get(`/api/v1/admin/market-days/${dayId}/stalls`).set(vendor.headers).expect(403);
  });

  // ───────────── จองแทน ─────────────

  it('POST /admin/bookings: ข้ามรอบยังไม่เปิด/โควตา/ล็อคสงวน ได้ แต่ชนการจองที่มีอยู่ = STALL_TAKEN', async () => {
    const { dayId } = await makeDay({ openInMs: HOUR }); // ยังไม่เปิดจอง
    const vendor = await makeVendor();
    const reserved = await makeStall('R', { isReserved: true });
    const second = await makeStall('R');

    const res = await http()
      .post('/api/v1/admin/bookings')
      .set(asAdmin(staff))
      .send({ vendorId: vendor.id, stallId: reserved, marketDayId: dayId })
      .expect(201);
    expect(res.body.data).toMatchObject({
      status: 'CONFIRMED',
      amount: 100,
      vendor: { id: vendor.id },
      paymentDueAt: null,
    });
    expect(res.body.data.confirmedAt).not.toBeNull();
    expect(events).toContainEqual(
      expect.objectContaining({ bookingId: res.body.data.id, status: 'CONFIRMED' }),
    );
    expect(
      await prisma.auditLog.count({
        where: { entityId: res.body.data.id, action: 'booking.create_by_admin' },
      }),
    ).toBe(1);

    // โควตา 1 ล็อค/วัน ไม่บังคับกับ admin; ตั้งราคาเองและให้รอชำระ
    const pending = await http()
      .post('/api/v1/admin/bookings')
      .set(asAdmin())
      .send({
        vendorId: vendor.id,
        stallId: second,
        marketDayId: dayId,
        status: 'PENDING_PAYMENT',
        amount: 50,
      })
      .expect(201);
    expect(pending.body.data).toMatchObject({ status: 'PENDING_PAYMENT', amount: 50 });
    expect(Date.parse(pending.body.data.paymentDueAt)).toBeGreaterThan(Date.now() + 23 * HOUR);

    const taken = await http()
      .post('/api/v1/admin/bookings')
      .set(asAdmin())
      .send({ vendorId: (await makeVendor()).id, stallId: reserved, marketDayId: dayId })
      .expect(409);
    expect(taken.body.error.code).toBe('STALL_TAKEN');
  });

  it('POST /admin/bookings: ผู้ค้าไม่อนุมัติ / ล็อคปิดใช้งาน / วันขายยกเลิก / ตลาดอื่น → error', async () => {
    const { dayId } = await makeDay();
    const stallId = await makeStall('E');
    const send = (body: Record<string, unknown>) =>
      http().post('/api/v1/admin/bookings').set(asAdmin()).send(body);

    const pending = await makeVendor({ status: 'PENDING' });
    expect(
      (await send({ vendorId: pending.id, stallId, marketDayId: dayId }).expect(403)).body.error
        .code,
    ).toBe('VENDOR_NOT_APPROVED');
    const vendor = await makeVendor();
    const inactive = await makeStall('E', { isActive: false });
    expect(
      (await send({ vendorId: vendor.id, stallId: inactive, marketDayId: dayId }).expect(409)).body
        .error.code,
    ).toBe('STALL_UNAVAILABLE');
    const other = await makeDay({ mkt: otherMarketId });
    await send({ vendorId: vendor.id, stallId, marketDayId: other.dayId }).expect(404);

    await prisma.marketDay.update({ where: { id: dayId }, data: { isCancelled: true } });
    expect(
      (await send({ vendorId: vendor.id, stallId, marketDayId: dayId }).expect(409)).body.error
        .code,
    ).toBe('INVALID_STATE_TRANSITION');
  });

  // ───────────── export ─────────────

  it('GET /admin/market-days/:id/bookings.xlsx: รายชื่อการจองที่ยังมีผล เรียงตามล็อค + audit', async () => {
    const { dayId, date } = await makeDay();
    const v1 = await makeVendor({ firstName: 'ส่งออก', shopName: 'ร้านหนึ่ง' });
    const v2 = await makeVendor({ firstName: 'ยกเลิก' });
    const first = await makeStall('X');
    await hold(v1, first, dayId);
    const cancelled = await hold(v2, await makeStall('X'), dayId);
    await http()
      .post(`/api/v1/bookings/${cancelled.id}/cancel`)
      .set(v2.headers)
      .send({})
      .expect(200);

    const res = await http()
      .get(`/api/v1/admin/market-days/${dayId}/bookings.xlsx`)
      .set(asAdmin(staff))
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');
    expect(res.headers['content-disposition']).toBe(`attachment; filename="bookings-${date}.xlsx"`);

    const book = new ExcelJS.Workbook();
    await book.xlsx.load(res.body as unknown as ExcelJS.Buffer);
    const sheet = book.getWorksheet('รายชื่อผู้ค้า');
    expect(sheet?.getRow(1).values).toEqual([
      undefined,
      'ล็อค',
      'โซน',
      'ชื่อผู้ค้า',
      'ชื่อร้าน',
      'เบอร์โทร',
      'สถานะ',
      'ราคา (บาท)',
    ]);
    expect(sheet?.rowCount).toBe(2);
    expect(sheet?.getRow(2).values).toEqual([
      undefined,
      expect.stringMatching(/^X-/),
      'ทั่วไป',
      expect.stringMatching(/^ส่งออก /),
      'ร้านหนึ่ง',
      v1.phone,
      'รอยืนยัน',
      100,
    ]);
    expect(
      await prisma.auditLog.count({ where: { entityId: dayId, action: 'booking.export' } }),
    ).toBe(1);
  });

  // ───────────── ยกเลิกรอบ/วันขาย → ยกเลิกการจอง ─────────────

  it('ยกเลิกรอบ/วันขาย → การจองที่ยังมีผลถูกยกเลิกใน transaction เดียวกัน + ส่ง event', async () => {
    const r1 = await makeDay();
    const r2 = await makeDay();
    const v1 = await makeVendor();
    const v2 = await makeVendor();
    const inRound = await hold(v1, await makeStall('Y'), r1.dayId);
    const inDay = await hold(v2, await makeStall('Y'), r2.dayId);
    events.length = 0;

    await http().post(`/api/v1/admin/rounds/${r1.roundId}/cancel`).set(asAdmin()).expect(200);
    expect(await prisma.booking.findUniqueOrThrow({ where: { id: inRound.id } })).toMatchObject({
      status: 'CANCELLED',
      cancelReason: 'รอบการจองถูกยกเลิก',
      cancelledByAdminId: admin.id,
    });
    expect(events).toContainEqual(
      expect.objectContaining({ bookingId: inRound.id, status: 'CANCELLED' }),
    );
    expect(
      await prisma.auditLog.findFirst({ where: { entityId: r1.roundId, action: 'round.cancel' } }),
    ).toMatchObject({ after: { status: 'CANCELLED', cancelledBookings: 1 } });

    await http()
      .patch(`/api/v1/admin/rounds/${r2.roundId}/market-days/${r2.dayId}`)
      .set(asAdmin())
      .send({ isCancelled: true })
      .expect(200);
    expect(await prisma.booking.findUniqueOrThrow({ where: { id: inDay.id } })).toMatchObject({
      status: 'CANCELLED',
      cancelReason: 'วันขายถูกยกเลิก',
    });
  });

  it('ปิดล็อคเฉพาะวันที่มีการจองอยู่ไม่ได้ (RESOURCE_IN_USE) — ราคาเฉพาะวันยังตั้งได้', async () => {
    const { dayId } = await makeDay();
    const stallId = await makeStall('Z');
    await hold(await makeVendor(), stallId, dayId);
    const path = `/api/v1/admin/market-days/${dayId}/overrides/${stallId}`;

    const res = await http()
      .put(path)
      .set(asAdmin())
      .send({ priceOverride: null, isClosed: true })
      .expect(409);
    expect(res.body.error).toMatchObject({ code: 'RESOURCE_IN_USE', details: { bookings: 1 } });
    await http().put(path).set(asAdmin()).send({ priceOverride: 80, isClosed: false }).expect(200);
  });
});
