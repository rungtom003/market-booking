import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { WaitingRoomStatus } from '@market-booking/shared';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { zonedDate } from '../../src/common/zoned-date';
import type { PrismaClient } from '../../src/generated/prisma/client';
import type { AdminPrincipal, VendorPrincipal } from '../../src/modules/auth/principal';
import { TokenService } from '../../src/modules/auth/token.service';
import { WaitingRoomService } from '../../src/modules/waiting-room/waiting-room.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { setupApp } from '../../src/setup-app';
import { truncateAll } from './test-db';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const SESSION_MINUTES = 5;

describe('Waiting Room (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let room: WaitingRoomService;
  let marketId: string;
  let admin: AdminPrincipal;
  let zoneId: string;
  let seq = 0;
  let dayOffset = 20;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    room = app.get(WaitingRoomService);
    await truncateAll(prisma as unknown as PrismaClient);

    marketId = (await prisma.market.create({ data: { name: 'ตลาดคิวหน้าจอง', address: '-' } })).id;
    const row = await prisma.adminUser.create({
      data: { username: 'wr-admin', passwordHash: 'x', displayName: 'wr', role: 'ADMIN', marketId },
    });
    admin = { actorType: 'ADMIN', id: row.id, role: 'ADMIN', marketId };
    zoneId = (await prisma.zone.create({ data: { marketId, name: 'โซน W', color: '#3B82F6' } })).id;
    await http()
      .put('/api/v1/admin/settings')
      .set(asAdmin())
      .send({ waiting_room_session_minutes: SESSION_MINUTES, payment_required: true })
      .expect(200);
  });

  afterAll(async () => {
    await app.close();
  });

  const tokenOf = (p: Parameters<TokenService['signAccessToken']>[0]) =>
    app.get(TokenService).signAccessToken(p);
  function asAdmin() {
    return { Authorization: `Bearer ${tokenOf(admin)}` };
  }

  async function makeVendor() {
    const n = ++seq;
    const row = await prisma.vendor.create({
      data: {
        marketId,
        firstName: 'คิว',
        lastName: `ที่${n}`,
        phone: `08${String(80000000 + n).slice(-8)}`,
        address: '-',
        pdpaConsentAt: new Date(),
        status: 'APPROVED',
      },
    });
    const principal: VendorPrincipal = { actorType: 'VENDOR', id: row.id, marketId };
    return { id: row.id, principal, headers: { Authorization: `Bearer ${tokenOf(principal)}` } };
  }
  type Vendor = Awaited<ReturnType<typeof makeVendor>>;

  /** รอบ + วันขาย + ล็อค — `openAt` เทียบกับตอนนี้ */
  async function makeRound(capacity: number | null, openOffsetMs = -MINUTE) {
    const round = await prisma.bookingRound.create({
      data: {
        marketId,
        name: `รอบ ${++seq}`,
        openAt: new Date(Date.now() + openOffsetMs),
        closeAt: new Date(Date.now() + DAY),
        maxStallsPerVendor: 3,
        status: 'PUBLISHED',
        waitingRoomCapacity: capacity,
        createdById: admin.id,
      },
    });
    const date = zonedDate(new Date(Date.now() + ++dayOffset * DAY), 'Asia/Bangkok');
    const dayId = (
      await prisma.marketDay.create({
        data: { marketId, roundId: round.id, marketDate: new Date(`${date}T00:00:00Z`) },
      })
    ).id;
    const stallIds: string[] = [];
    for (let i = 0; i < 3; i++) {
      stallIds.push(
        (
          await prisma.stall.create({
            data: {
              marketId,
              zoneId,
              code: `W${++seq}`,
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
    return { round, dayId, stallIds };
  }

  const hold = (v: Vendor, stallId: string, marketDayId: string) =>
    http().post('/api/v1/bookings/hold').set(v.headers).send({ stallId, marketDayId });

  it('เข้าคิวตามลำดับ → ปล่อยเข้าเท่าที่ว่าง → จองได้เฉพาะคนที่ได้เข้า; ออกแล้วคนถัดไปได้เข้า', async () => {
    const { round, dayId, stallIds } = await makeRound(2);
    const [a, b, c] = [await makeVendor(), await makeVendor(), await makeVendor()];
    const t0 = Date.now();

    // ผ่าน HTTP: คนแรกเข้าคิว
    const joined = await http()
      .post(`/api/v1/rounds/${round.id}/waiting-room`)
      .set(a.headers)
      .expect(200);
    expect(joined.body.data).toMatchObject({ state: 'WAITING', position: 1, waiting: 1 });
    await room.join(b.principal, round.id, new Date(t0 + 1_000));
    expect(await room.join(c.principal, round.id, new Date(t0 + 2_000))).toMatchObject({
      state: 'WAITING',
      position: 3,
    });
    // เข้าซ้ำไม่เสียลำดับ
    expect((await room.join(a.principal, round.id)).position).toBe(1);

    // ยังไม่ได้เข้า → จองไม่ได้
    const blocked = await hold(a, stallIds[0]!, dayId).expect(409);
    expect(blocked.body.error).toMatchObject({
      code: 'WAITING_ROOM_REQUIRED',
      details: { roundId: round.id },
    });

    expect(await room.admit(round)).toBe(2);
    const statusA = (
      await http().get(`/api/v1/rounds/${round.id}/waiting-room`).set(a.headers).expect(200)
    ).body.data as WaitingRoomStatus;
    expect(statusA.state).toBe('ADMITTED');
    expect(Date.parse(statusA.admittedUntil!) - Date.now()).toBeGreaterThan(
      (SESSION_MINUTES - 1) * MINUTE,
    );
    expect(await room.status(c.principal, round.id)).toMatchObject({
      state: 'WAITING',
      position: 1,
      waiting: 1,
    });
    await hold(a, stallIds[0]!, dayId).expect(201);

    // เต็มแล้วไม่ปล่อยเพิ่ม; มีคนออก → คนถัดไปได้เข้า
    expect(await room.admit(round)).toBe(0);
    await http().delete(`/api/v1/rounds/${round.id}/waiting-room`).set(b.headers).expect(204);
    expect(await room.admit(round)).toBe(1);
    expect((await room.status(c.principal, round.id)).state).toBe('ADMITTED');
    await hold(c, stallIds[1]!, dayId).expect(201);

    const stats = await http()
      .get(`/api/v1/admin/rounds/${round.id}/waiting-room`)
      .set(asAdmin())
      .expect(200);
    expect(stats.body.data).toEqual({ enabled: true, capacity: 2, waiting: 0, admitted: 2 });
  });

  it('หมดเวลาในหน้าจอง → จองไม่ได้และต้องเข้าคิวใหม่ (ต่อท้าย); ปิดหน้าไปแล้วไม่ได้รับที่', async () => {
    const { round } = await makeRound(1);
    const [a, b, gone] = [await makeVendor(), await makeVendor(), await makeVendor()];
    const t0 = Date.now();
    await room.join(a.principal, round.id, new Date(t0));
    await room.join(gone.principal, round.id, new Date(t0 + 1_000));
    await room.join(b.principal, round.id, new Date(t0 + 2_000));
    expect(await room.admit(round, new Date(t0 + 3_000))).toBe(1);

    // หมดเวลาของ a: gone ไม่ได้ถามสถานะเกิน 45 วินาที → ข้าม, b ถามอยู่ → ได้เข้า
    const later = new Date(t0 + SESSION_MINUTES * MINUTE + 5_000);
    await room.status(b.principal, round.id, new Date(later.getTime() - 1_000));
    expect(await room.admit(round, later)).toBe(1);
    expect((await room.status(b.principal, round.id, later)).state).toBe('ADMITTED');
    expect((await room.status(gone.principal, round.id, later)).state).toBe('NOT_JOINED');
    expect((await room.status(a.principal, round.id, later)).state).toBe('NOT_JOINED');
    await expect(room.assertAdmitted(round, a.id, later)).rejects.toMatchObject({
      code: 'WAITING_ROOM_REQUIRED',
    });
    // เข้าใหม่ = ต่อท้าย
    expect(await room.join(a.principal, round.id, later)).toMatchObject({
      state: 'WAITING',
      position: 1,
    });
  });

  it('เข้าคิวก่อนรอบเปิด: ลำดับสุ่มแต่มาก่อนเปิดได้ก่อนคนที่มาหลังเปิดเสมอ; ยังไม่ปล่อยก่อนเปิด', async () => {
    const { round } = await makeRound(10, 10 * MINUTE);
    const early = [await makeVendor(), await makeVendor(), await makeVendor()];
    for (const v of early) await room.join(v.principal, round.id);
    const late = await makeVendor();
    const afterOpen = new Date(round.openAt.getTime() + 1_000);
    for (const v of early) await room.status(v.principal, round.id, afterOpen);
    expect(await room.join(late.principal, round.id, afterOpen)).toMatchObject({ position: 4 });

    expect(await room.admitAll()).toBe(0); // ยังไม่ถึงเวลาเปิด
    expect(await room.admit(round, afterOpen)).toBe(4);
  });

  it('รอบที่ไม่เปิด Waiting Room: NOT_REQUIRED และจองได้เลย', async () => {
    const { round, dayId, stallIds } = await makeRound(null);
    const v = await makeVendor();
    const res = await http()
      .post(`/api/v1/rounds/${round.id}/waiting-room`)
      .set(v.headers)
      .expect(200);
    expect(res.body.data.state).toBe('NOT_REQUIRED');
    await hold(v, stallIds[2]!, dayId).expect(201);

    // admin เปิดใช้ภายหลังได้ (แก้รอบ) → ต้องเข้าคิว
    await http()
      .patch(`/api/v1/admin/rounds/${round.id}`)
      .set(asAdmin())
      .send({ waitingRoomCapacity: 50 })
      .expect(200)
      .expect((r) => expect(r.body.data.waitingRoomCapacity).toBe(50));
    const current = await http().get('/api/v1/rounds/current').set(v.headers).expect(200);
    if (current.body.data.round?.id === round.id) {
      expect(current.body.data.round.waitingRoom).toBe(true);
    }
    const day = await http().get(`/api/v1/market-days/${dayId}/stalls`).set(v.headers).expect(200);
    expect(day.body.data.round.waitingRoom).toBe(true);
    await http()
      .patch(`/api/v1/admin/rounds/${round.id}`)
      .set(asAdmin())
      .send({ waitingRoomCapacity: 0 })
      .expect(400);
  });
});
