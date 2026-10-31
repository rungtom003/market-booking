import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  SOCKET_NAMESPACE,
  SocketEvent,
  type Booking,
  type BookingChangedPayload,
  type RoundChangedPayload,
  type ServerTimePayload,
  type SocketAck,
  type StallUpdatedPayload,
} from '@market-booking/shared';
import { type Socket, io } from 'socket.io-client';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { zonedDate } from '../../src/common/zoned-date';
import type { PrismaClient } from '../../src/generated/prisma/client';
import type { AdminPrincipal, Principal } from '../../src/modules/auth/principal';
import { TokenService } from '../../src/modules/auth/token.service';
import { NotifyService } from '../../src/modules/notify/notify.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { setupApp } from '../../src/setup-app';
import { truncateAll } from './test-db';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

async function startApp(): Promise<{ app: INestApplication; url: string }> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  setupApp(app);
  await app.listen(0);
  return { app, url: (await app.getUrl()).replace('[::1]', 'localhost') };
}

/** event ถัดไปที่ตรงเงื่อนไข ภายใน `timeoutMs` (ไม่มา = reject) */
function nextEvent<T>(
  socket: Socket,
  event: string,
  match: (payload: T) => boolean = () => true,
  timeoutMs = 2_000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`No ${event} within ${timeoutMs} ms`));
    }, timeoutMs);
    const handler = (payload: T) => {
      if (!match(payload)) return;
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(payload);
    };
    socket.on(event, handler);
  });
}

/** ไม่มี event ที่ตรงเงื่อนไขภายใน `ms` */
async function expectNoEvent<T>(
  socket: Socket,
  event: string,
  match: (payload: T) => boolean = () => true,
  ms = 500,
) {
  await expect(nextEvent(socket, event, match, ms)).rejects.toThrow(/^No /);
}

describe('Realtime gateway /booking (integration)', () => {
  let app: INestApplication;
  let url: string;
  let prisma: PrismaService;
  let marketId: string;
  let otherMarketId: string;
  let admin: AdminPrincipal;
  let zoneId: string;
  let marketDayId: string;
  let otherMarketDayId: string;
  let seq = 0;
  const sockets: Socket[] = [];

  beforeAll(async () => {
    ({ app, url } = await startApp());
    prisma = app.get(PrismaService);
    await truncateAll(prisma as unknown as PrismaClient);

    marketId = (await prisma.market.create({ data: { name: 'ตลาดหลัก', address: '-' } })).id;
    otherMarketId = (await prisma.market.create({ data: { name: 'ตลาดอื่น', address: '-' } })).id;
    const adminRow = await prisma.adminUser.create({
      data: { username: 'admin', passwordHash: 'x', displayName: 'admin', role: 'ADMIN', marketId },
    });
    admin = { actorType: 'ADMIN', id: adminRow.id, role: 'ADMIN', marketId };
    zoneId = (
      await prisma.zone.create({
        data: { marketId, name: 'ทั่วไป', color: '#3B82F6', sortOrder: 0 },
      })
    ).id;
    marketDayId = await makeDay(marketId, 5);
    otherMarketDayId = await makeDay(otherMarketId, 5);
  });

  afterEach(() => {
    sockets.splice(0).forEach((s) => s.disconnect());
  });

  afterAll(async () => {
    await app.close();
  });

  // ───────────── helpers ─────────────

  async function makeDay(mkt: string, inDays: number) {
    const round = await prisma.bookingRound.create({
      data: {
        marketId: mkt,
        name: 'รอบเปิด',
        openAt: new Date(Date.now() - HOUR),
        closeAt: new Date(Date.now() + DAY),
        maxStallsPerVendor: 3,
        status: 'PUBLISHED',
        createdById: admin.id,
      },
    });
    const date = zonedDate(new Date(Date.now() + (inDays + seq++) * DAY), 'Asia/Bangkok');
    return (
      await prisma.marketDay.create({
        data: { marketId: mkt, roundId: round.id, marketDate: new Date(`${date}T00:00:00Z`) },
      })
    ).id;
  }

  const tokenOf = (p: Principal) => app.get(TokenService).signAccessToken(p);

  async function makeVendor(status: 'APPROVED' | 'PENDING' = 'APPROVED') {
    const phone = `08${String(60000000 + ++seq).slice(-8)}`;
    const row = await prisma.vendor.create({
      data: {
        marketId,
        firstName: 'ผู้ค้า',
        lastName: phone,
        phone,
        address: '-',
        pdpaConsentAt: new Date(),
        status,
      },
    });
    const token = tokenOf({ actorType: 'VENDOR', id: row.id, marketId });
    return { id: row.id, token, headers: { Authorization: `Bearer ${token}` } };
  }

  async function makeStall() {
    return (
      await prisma.stall.create({
        data: {
          marketId,
          zoneId,
          code: `R${++seq}`,
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

  /** ต่อ socket — ตั้ง listener ไว้ก่อนเชื่อมต่อ (server ส่ง server:time ทันทีที่ต่อ) */
  function connect(
    token: string | undefined,
    base = url,
  ): { socket: Socket; ready: Promise<Socket>; serverTime: Promise<ServerTimePayload> } {
    const socket = io(`${base}${SOCKET_NAMESPACE}`, {
      auth: token ? { token } : {},
      transports: ['websocket'],
      autoConnect: false,
      reconnection: false,
    });
    sockets.push(socket);
    const serverTime = nextEvent<ServerTimePayload>(socket, SocketEvent.SERVER_TIME);
    // การเชื่อมต่อที่ตั้งใจให้ล้มจะไม่ได้ server:time — ไม่ให้เป็น unhandled rejection
    serverTime.catch(() => undefined);
    const ready = new Promise<Socket>((resolve, reject) => {
      socket.once('connect', () => resolve(socket));
      socket.once('connect_error', reject);
    });
    socket.connect();
    return { socket, ready, serverTime };
  }

  const join = (socket: Socket, id: string): Promise<SocketAck> =>
    socket.emitWithAck(SocketEvent.MD_JOIN, { marketDayId: id });

  async function hold(vendor: { headers: Record<string, string> }, stallId: string, base = url) {
    const res = await request(base)
      .post('/api/v1/bookings/hold')
      .set(vendor.headers)
      .send({ stallId, marketDayId })
      .expect(201);
    return res.body.data as Booking;
  }

  // ───────────── การเชื่อมต่อ ─────────────

  describe('handshake', () => {
    it('ไม่มี token / token ปลอม → UNAUTHORIZED; ผู้ค้ายังไม่อนุมัติ → VENDOR_NOT_APPROVED', async () => {
      await expect(connect(undefined).ready).rejects.toThrow('UNAUTHORIZED');
      await expect(connect('not-a-jwt').ready).rejects.toThrow('UNAUTHORIZED');
      const pending = await makeVendor('PENDING');
      await expect(connect(pending.token).ready).rejects.toThrow('VENDOR_NOT_APPROVED');
    });

    it('ต่อสำเร็จ → ได้ server:time ทันที (เวลา server)', async () => {
      const vendor = await makeVendor();
      const before = Date.now();
      const { ready, serverTime } = connect(vendor.token);
      await ready;
      const { now } = await serverTime;
      expect(Date.parse(now)).toBeGreaterThanOrEqual(before);
      expect(Date.parse(now)).toBeLessThanOrEqual(Date.now());
    });

    it('md:join: body ผิด / วันขายตลาดอื่น / เกิน 3 ห้อง → ไม่ให้เข้า', async () => {
      const vendor = await makeVendor();
      const socket = await connect(vendor.token).ready;
      expect(await socket.emitWithAck(SocketEvent.MD_JOIN, { marketDayId: 'x' })).toEqual({
        ok: false,
        code: 'VALIDATION_ERROR',
      });
      expect(await join(socket, otherMarketDayId)).toEqual({ ok: false, code: 'NOT_FOUND' });

      const days = [marketDayId, await makeDay(marketId, 10), await makeDay(marketId, 11)];
      for (const id of days) expect(await join(socket, id)).toEqual({ ok: true });
      // join ซ้ำห้องเดิมได้ ไม่นับเพิ่ม
      expect(await join(socket, marketDayId)).toEqual({ ok: true });
      expect(await join(socket, await makeDay(marketId, 12))).toEqual({
        ok: false,
        code: 'BAD_REQUEST',
      });
      expect(await socket.emitWithAck(SocketEvent.MD_LEAVE, { marketDayId: days[2] })).toEqual({
        ok: true,
      });
      expect(await join(socket, await makeDay(marketId, 13))).toEqual({ ok: true });
    });
  });

  // ───────────── Acceptance Criteria ─────────────

  it('AC: ผู้ค้า A จองล็อค → ผู้ค้า B (ดูผังวันเดียวกัน) ได้ stall:updated ภายใน 1 วินาที', async () => {
    const a = await makeVendor();
    const b = await makeVendor();
    const stallId = await makeStall();
    const socketA = await connect(a.token).ready;
    const socketB = await connect(b.token).ready;
    expect(await join(socketA, marketDayId)).toEqual({ ok: true });
    expect(await join(socketB, marketDayId)).toEqual({ ok: true });

    const forStall = (p: StallUpdatedPayload) => p.stallId === stallId;
    const seenByB = nextEvent<StallUpdatedPayload>(
      socketB,
      SocketEvent.STALL_UPDATED,
      forStall,
      1_000,
    );
    const seenByA = nextEvent<StallUpdatedPayload>(
      socketA,
      SocketEvent.STALL_UPDATED,
      forStall,
      1_000,
    );
    const bookingForA = nextEvent<BookingChangedPayload>(socketA, SocketEvent.BOOKING_CHANGED);

    const started = Date.now();
    const booking = await hold(a, stallId);

    expect(await seenByB).toMatchObject({ marketDayId, stallId, state: 'HOLD', mine: false });
    expect(Date.now() - started).toBeLessThan(1_000);
    // เจ้าของได้ครั้งเดียว (mine: true) ไม่ได้ซ้ำจากห้องวันขาย
    expect(await seenByA).toMatchObject({ state: 'HOLD', mine: true });
    await expectNoEvent<StallUpdatedPayload>(socketA, SocketEvent.STALL_UPDATED, forStall, 300);
    expect(await bookingForA).toEqual({
      bookingId: booking.id,
      marketDayId,
      stallId,
      status: 'HOLD',
      holdExpiresAt: booking.holdExpiresAt,
      paymentDueAt: null,
    });
    // booking:changed เป็นของเจ้าของเท่านั้น และไม่มี vendor id ของคนอื่นใน event สาธารณะ
    await expectNoEvent(socketB, SocketEvent.BOOKING_CHANGED);

    const freed = nextEvent<StallUpdatedPayload>(socketB, SocketEvent.STALL_UPDATED, forStall);
    await request(url)
      .post(`/api/v1/bookings/${booking.id}/cancel`)
      .set(a.headers)
      .send({})
      .expect(200);
    const payload = await freed;
    expect(payload).toMatchObject({ state: 'AVAILABLE', mine: false });
    expect(JSON.stringify(payload)).not.toContain(a.id);
  });

  it('AC: API 2 instance (Redis adapter) — จองที่ instance 1 → socket ที่ต่อกับ instance 2 ได้ event', async () => {
    const second = await startApp();
    try {
      const a = await makeVendor();
      const b = await makeVendor();
      const stallId = await makeStall();
      const socketB = await connect(b.token, second.url).ready;
      expect(await join(socketB, marketDayId)).toEqual({ ok: true });

      const seen = nextEvent<StallUpdatedPayload>(
        socketB,
        SocketEvent.STALL_UPDATED,
        (p) => p.stallId === stallId,
        1_000,
      );
      await hold(a, stallId, url);
      expect(await seen).toMatchObject({ stallId, state: 'HOLD', mine: false });

      // ห้องส่วนตัวก็ข้าม instance: ผู้ค้า A ต่อกับ instance 2 แต่จองผ่าน instance 1
      const socketA = await connect(a.token, second.url).ready;
      const own = nextEvent<BookingChangedPayload>(socketA, SocketEvent.BOOKING_CHANGED);
      await hold(a, await makeStall(), url);
      expect((await own).status).toBe('HOLD');
    } finally {
      sockets.splice(0).forEach((s) => s.disconnect());
      await second.app.close();
    }
  });

  // ───────────── event อื่นๆ ─────────────

  it('stall:updated ส่งสถานะจริงจาก DB: ล็อคที่ปิดวันนั้นหลังยกเลิกการจอง = CLOSED', async () => {
    const vendor = await makeVendor();
    const viewer = await makeVendor();
    const stallId = await makeStall();
    const booking = await hold(vendor, stallId);
    await prisma.stallDayOverride.create({ data: { stallId, marketDayId, isClosed: true } });
    const socket = await connect(viewer.token).ready;
    await join(socket, marketDayId);

    const seen = nextEvent<StallUpdatedPayload>(
      socket,
      SocketEvent.STALL_UPDATED,
      (p) => p.stallId === stallId,
    );
    await request(url)
      .post(`/api/v1/bookings/${booking.id}/cancel`)
      .set(vendor.headers)
      .send({})
      .expect(200);
    expect((await seen).state).toBe('CLOSED');
  });

  it('round:changed ถึงผู้ค้าทุกคนในตลาดเมื่อรอบที่เผยแพร่แล้วเปลี่ยน (DRAFT ไม่ส่ง)', async () => {
    const vendor = await makeVendor();
    const socket = await connect(vendor.token).ready;
    const asAdmin = { Authorization: `Bearer ${tokenOf(admin)}` };

    const draft = await request(url)
      .post('/api/v1/admin/rounds')
      .set(asAdmin)
      .send({
        name: 'รอบใหม่',
        openAt: new Date(Date.now() + HOUR).toISOString(),
        closeAt: new Date(Date.now() + DAY).toISOString(),
      })
      .expect(201);
    const roundId = draft.body.data.id as string;
    await request(url)
      .post(`/api/v1/admin/rounds/${roundId}/market-days`)
      .set(asAdmin)
      .send({ dates: [zonedDate(new Date(Date.now() + 40 * DAY), 'Asia/Bangkok')] })
      .expect(201);
    await expectNoEvent(socket, SocketEvent.ROUND_CHANGED);

    const published = nextEvent<RoundChangedPayload>(socket, SocketEvent.ROUND_CHANGED);
    await request(url).post(`/api/v1/admin/rounds/${roundId}/publish`).set(asAdmin).expect(200);
    expect(await published).toMatchObject({ roundId, status: 'PUBLISHED' });

    const cancelled = nextEvent<RoundChangedPayload>(socket, SocketEvent.ROUND_CHANGED);
    await request(url).post(`/api/v1/admin/rounds/${roundId}/cancel`).set(asAdmin).expect(200);
    expect(await cancelled).toMatchObject({ roundId, status: 'CANCELLED' });
  });

  it('vendor:registered ถึง admin ของตลาดนั้นเท่านั้น (ผู้ค้าไม่ได้)', async () => {
    const adminSocket = await connect(tokenOf(admin)).ready;
    const vendorSocket = await connect((await makeVendor()).token).ready;
    const seen = nextEvent(adminSocket, SocketEvent.VENDOR_REGISTERED);

    await app.get(NotifyService).vendorStatusChanged({
      vendorId: 'new-vendor',
      marketId,
      from: null,
      to: 'PENDING',
    });
    expect(await seen).toEqual({ vendorId: 'new-vendor' });
    await expectNoEvent(vendorSocket, SocketEvent.VENDOR_REGISTERED);

    // อนุมัติอัตโนมัติ (AUTO) ไม่ต้องแจ้ง
    await app.get(NotifyService).vendorStatusChanged({
      vendorId: 'auto',
      marketId,
      from: null,
      to: 'APPROVED',
    });
    await expectNoEvent(adminSocket, SocketEvent.VENDOR_REGISTERED);
  });
});
