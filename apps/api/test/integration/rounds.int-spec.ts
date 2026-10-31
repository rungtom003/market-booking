import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type {
  CurrentRoundResponse,
  MarketDayStalls,
  RoundDetail,
  StallDayOverride,
} from '@market-booking/shared';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { zonedDate } from '../../src/common/zoned-date';
import type { PrismaClient } from '../../src/generated/prisma/client';
import type { AdminPrincipal } from '../../src/modules/auth/principal';
import { TokenService } from '../../src/modules/auth/token.service';
import { RoundService } from '../../src/modules/round/round.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { setupApp } from '../../src/setup-app';
import { truncateAll } from './test-db';

const TZ = 'Asia/Bangkok';
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const fromNow = (ms: number) => new Date(Date.now() + ms).toISOString();

describe('Booking rounds, market days, overrides (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let marketId: string;
  let otherMarketId: string;
  let admin: AdminPrincipal;
  let staff: AdminPrincipal;
  let otherMarketAdmin: AdminPrincipal;
  let stallId: string;
  let otherMarketStallId: string;
  let vendor: { id: string; headers: Record<string, string> };
  let phoneSeq = 0;
  /** วันขายของแต่ละ test ไม่ชนกัน (DB เดียวกันทั้งไฟล์) */
  let dayOffset = 3;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();
    prisma = app.get(PrismaService);

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
    otherMarketAdmin = await makeAdmin('other', 'ADMIN', otherMarketId);

    const makeStall = async (mkt: string, code: string) => {
      const zone = await prisma.zone.create({
        data: { marketId: mkt, name: 'โซน', color: '#22C55E', sortOrder: 0 },
      });
      return (
        await prisma.stall.create({
          data: {
            marketId: mkt,
            zoneId: zone.id,
            code,
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
    };
    stallId = await makeStall(marketId, 'A1');
    otherMarketStallId = await makeStall(otherMarketId, 'Z1');
    vendor = await makeVendor();
  });

  afterAll(async () => {
    await app.close();
  });

  // ───────────── helpers ─────────────

  const bearer = (p: AdminPrincipal) => `Bearer ${app.get(TokenService).signAccessToken(p)}`;
  const asAdmin = (p: AdminPrincipal = admin) => ({ Authorization: bearer(p) });

  async function makeVendor(status: 'APPROVED' | 'PENDING' = 'APPROVED', mkt = marketId) {
    const phone = `08${String(30000000 + ++phoneSeq).slice(-8)}`;
    const row = await prisma.vendor.create({
      data: {
        marketId: mkt,
        firstName: 'ผู้ค้า',
        lastName: phone,
        phone,
        address: '-',
        pdpaConsentAt: new Date(),
        status,
      },
    });
    const token = app.get(TokenService).signAccessToken({
      actorType: 'VENDOR',
      id: row.id,
      marketId: mkt,
    });
    return { id: row.id, headers: { Authorization: `Bearer ${token}` } };
  }

  /** วันที่ (เวลาตลาด) ถัดไปที่ยังไม่มี test ใช้ — อยู่หลัง close_at ค่าเริ่มต้น (+1 วัน) เสมอ */
  const freshDates = (n: number) =>
    Array.from({ length: n }, () => zonedDate(new Date(Date.now() + dayOffset++ * DAY), TZ));

  const freshDate = () => freshDates(1)[0]!;

  async function createRound(body: Record<string, unknown> = {}, p = admin): Promise<RoundDetail> {
    const res = await http()
      .post('/api/v1/admin/rounds')
      .set(asAdmin(p))
      .send({ name: 'รอบทดสอบ', openAt: fromNow(HOUR), closeAt: fromNow(DAY), ...body })
      .expect(201);
    return res.body.data;
  }

  async function addDays(roundId: string, dates: string[]): Promise<RoundDetail> {
    const res = await http()
      .post(`/api/v1/admin/rounds/${roundId}/market-days`)
      .set(asAdmin())
      .send({ dates })
      .expect(201);
    return res.body.data;
  }

  async function publishedRound(body: Record<string, unknown> = {}, days = 1) {
    const round = await createRound(body);
    await addDays(round.id, freshDates(days));
    const res = await http()
      .post(`/api/v1/admin/rounds/${round.id}/publish`)
      .set(asAdmin())
      .expect(200);
    return res.body.data as RoundDetail;
  }

  const auditActions = async (entityId: string) =>
    (
      await prisma.auditLog.findMany({
        where: { entityId },
        orderBy: { createdAt: 'asc' },
        select: { action: true },
      })
    ).map((a) => a.action);

  // ───────────── สิทธิ์ ─────────────

  it('STAFF ไม่มีสิทธิ์จัดการรอบ → 403; admin ตลาดอื่นไม่เห็นรอบ → 404', async () => {
    await http().get('/api/v1/admin/rounds').set(asAdmin(staff)).expect(403);
    await http()
      .get('/api/v1/admin/market-days/00000000-0000-7000-8000-000000000000/overrides')
      .set(asAdmin(staff))
      .expect(403);
    const round = await createRound();
    const res = await http()
      .get(`/api/v1/admin/rounds/${round.id}`)
      .set(asAdmin(otherMarketAdmin))
      .expect(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  // ───────────── รอบ ─────────────

  describe('rounds', () => {
    it('สร้างรอบ: DRAFT, จำนวนล็อคต่อผู้ค้าจาก Settings, ลง audit', async () => {
      await http()
        .put('/api/v1/admin/settings')
        .set(asAdmin())
        .send({ max_stalls_per_vendor_default: 3 })
        .expect(200);

      const round = await createRound({ name: '  รอบเดือนธันวาคม  ' });
      expect(round).toMatchObject({
        name: 'รอบเดือนธันวาคม',
        status: 'DRAFT',
        phase: null,
        maxStallsPerVendor: 3,
        marketDayCount: 0,
        marketDays: [],
      });
      expect(await auditActions(round.id)).toEqual(['round.create']);

      const explicit = await createRound({ maxStallsPerVendor: 2 });
      expect(explicit.maxStallsPerVendor).toBe(2);
    });

    it('validation: ปิดจองต้องหลังเปิดจอง, รูปแบบเวลาต้องมี timezone', async () => {
      const at = fromNow(HOUR);
      const res = await http()
        .post('/api/v1/admin/rounds')
        .set(asAdmin())
        .send({ name: 'x', openAt: at, closeAt: at })
        .expect(400);
      expect(res.body.error.details).toEqual([expect.objectContaining({ path: 'closeAt' })]);
      await http()
        .post('/api/v1/admin/rounds')
        .set(asAdmin())
        .send({ name: 'x', openAt: '2026-12-01T10:00', closeAt: fromNow(DAY) })
        .expect(400);
    });

    it('publish: ต้องมีวันขาย → PUBLISHED/UPCOMING; publish ซ้ำ → INVALID_STATE_TRANSITION', async () => {
      const round = await createRound();
      const empty = await http()
        .post(`/api/v1/admin/rounds/${round.id}/publish`)
        .set(asAdmin())
        .expect(400);
      expect(empty.body.error.details[0].path).toBe('marketDays');

      await addDays(round.id, freshDates(2));
      const res = await http()
        .post(`/api/v1/admin/rounds/${round.id}/publish`)
        .set(asAdmin())
        .expect(200);
      expect(res.body.data).toMatchObject({ status: 'PUBLISHED', phase: 'UPCOMING' });

      const again = await http()
        .post(`/api/v1/admin/rounds/${round.id}/publish`)
        .set(asAdmin())
        .expect(409);
      expect(again.body.error.code).toBe('INVALID_STATE_TRANSITION');
      expect(await auditActions(round.id)).toEqual([
        'round.create',
        'market_day.add',
        'round.publish',
      ]);
    });

    it('publish รอบที่เลยเวลาปิดจองแล้วไม่ได้', async () => {
      const round = await createRound({ openAt: fromNow(-2 * DAY), closeAt: fromNow(-DAY) });
      await prisma.marketDay.create({
        data: {
          marketId,
          roundId: round.id,
          marketDate: new Date(`${freshDates(1)[0]}T00:00:00Z`),
        },
      });
      const res = await http()
        .post(`/api/v1/admin/rounds/${round.id}/publish`)
        .set(asAdmin())
        .expect(400);
      expect(res.body.error.details[0].path).toBe('closeAt');
    });

    it('แก้ open_at หลังเปิดจองแล้ว → ROUND_ALREADY_OPENED; close_at แก้ได้ (ลง audit before/after)', async () => {
      const round = await publishedRound({ openAt: fromNow(-HOUR) });
      expect(round.phase).toBe('OPEN');

      const res = await http()
        .patch(`/api/v1/admin/rounds/${round.id}`)
        .set(asAdmin())
        .send({ openAt: fromNow(2 * HOUR) })
        .expect(409);
      expect(res.body.error.code).toBe('ROUND_ALREADY_OPENED');

      const closeAt = fromNow(DAY + HOUR);
      const ok = await http()
        .patch(`/api/v1/admin/rounds/${round.id}`)
        .set(asAdmin())
        .send({ closeAt, name: 'รอบขยายเวลา' })
        .expect(200);
      expect(ok.body.data).toMatchObject({ closeAt, name: 'รอบขยายเวลา' });
      const log = await prisma.auditLog.findFirst({
        where: { entityId: round.id, action: 'round.update' },
      });
      expect(log?.before).toMatchObject({ closeAt: round.closeAt });
      expect(log?.after).toMatchObject({ closeAt });
    });

    it('รอบที่ยังไม่เปิด: แก้ open_at ได้ แต่ต้องเป็นอนาคตถ้าเผยแพร่แล้ว', async () => {
      const round = await publishedRound();
      const openAt = fromNow(2 * HOUR);
      await http()
        .patch(`/api/v1/admin/rounds/${round.id}`)
        .set(asAdmin())
        .send({ openAt })
        .expect(200);
      const past = await http()
        .patch(`/api/v1/admin/rounds/${round.id}`)
        .set(asAdmin())
        .send({ openAt: fromNow(-HOUR) })
        .expect(400);
      expect(past.body.error.details[0].path).toBe('openAt');
    });

    it('close_at เกินเวลาเริ่มวันขายวันแรก หรือไม่หลัง open_at เดิม → 400', async () => {
      const round = await createRound();
      const date = freshDate();
      await addDays(round.id, [date]);
      const tooLate = await http()
        .patch(`/api/v1/admin/rounds/${round.id}`)
        .set(asAdmin())
        .send({ closeAt: new Date(Date.parse(`${date}T00:00:00+07:00`) + 1000).toISOString() })
        .expect(400);
      expect(tooLate.body.error.details[0]).toMatchObject({ path: 'closeAt' });
      expect(tooLate.body.error.details[0].message).toMatch(/^ต้องปิดจองก่อนวันขายวันแรก/);

      // ปิดพอดี 00:00 ของวันแรก (เวลาไทย) ได้
      await http()
        .patch(`/api/v1/admin/rounds/${round.id}`)
        .set(asAdmin())
        .send({ closeAt: new Date(`${date}T00:00:00+07:00`).toISOString() })
        .expect(200);

      await http()
        .patch(`/api/v1/admin/rounds/${round.id}`)
        .set(asAdmin())
        .send({ closeAt: round.openAt })
        .expect(400);
    });

    it('ยกเลิกรอบ: วันขายถูกยกเลิกทั้งหมด และใช้วันเดิมในรอบใหม่ได้; แก้รอบที่ยกเลิกไม่ได้', async () => {
      const dates = freshDates(2);
      const round = await createRound();
      await addDays(round.id, dates);
      await http().post(`/api/v1/admin/rounds/${round.id}/publish`).set(asAdmin()).expect(200);

      const other = await createRound();
      const taken = await http()
        .post(`/api/v1/admin/rounds/${other.id}/market-days`)
        .set(asAdmin())
        .send({ dates })
        .expect(409);
      expect(taken.body.error).toMatchObject({ code: 'MARKET_DATE_TAKEN', details: { dates } });

      const res = await http()
        .post(`/api/v1/admin/rounds/${round.id}/cancel`)
        .set(asAdmin())
        .expect(200);
      expect(res.body.data.status).toBe('CANCELLED');
      expect(res.body.data.marketDays.every((d: { isCancelled: boolean }) => d.isCancelled)).toBe(
        true,
      );
      expect(res.body.data.marketDayCount).toBe(0);

      expect((await addDays(other.id, dates)).marketDayCount).toBe(2);

      for (const [method, path, body] of [
        ['patch', '', { name: 'x' }],
        ['post', '/cancel', undefined],
        ['post', '/market-days', { dates: freshDates(1) }],
      ] as const) {
        const r = await http()
          [method](`/api/v1/admin/rounds/${round.id}${path}`)
          .set(asAdmin())
          .send(body)
          .expect(409);
        expect(r.body.error.code).toBe('INVALID_STATE_TRANSITION');
      }
    });

    it('ลบได้เฉพาะ DRAFT (วันขายถูกลบตาม); รอบที่เผยแพร่แล้วลบไม่ได้', async () => {
      const draft = await createRound();
      await addDays(draft.id, freshDates(1));
      await http().delete(`/api/v1/admin/rounds/${draft.id}`).set(asAdmin()).expect(204);
      expect(await prisma.marketDay.count({ where: { roundId: draft.id } })).toBe(0);
      expect(await auditActions(draft.id)).toContain('round.delete');

      const published = await publishedRound();
      const res = await http()
        .delete(`/api/v1/admin/rounds/${published.id}`)
        .set(asAdmin())
        .expect(409);
      expect(res.body.error.code).toBe('INVALID_STATE_TRANSITION');
    });

    it('GET /admin/rounds: ใหม่สุดก่อน ไม่มีรายการวัน และไม่เห็นรอบตลาดอื่น', async () => {
      await createRound({}, otherMarketAdmin);
      const res = await http().get('/api/v1/admin/rounds').set(asAdmin()).expect(200);
      const rounds = res.body.data as RoundDetail[];
      expect(rounds.length).toBeGreaterThan(0);
      expect(rounds[0]).not.toHaveProperty('marketDays');
      const openAts = rounds.map((r) => r.openAt);
      expect([...openAts].sort().reverse()).toEqual(openAts);
      const ids = new Set(
        (await prisma.bookingRound.findMany({ where: { marketId: otherMarketId } })).map(
          (r) => r.id,
        ),
      );
      expect(rounds.some((r) => ids.has(r.id))).toBe(false);
    });
  });

  // ───────────── วันขาย ─────────────

  describe('market days', () => {
    it('เพิ่มหลายวัน: ไม่ซ้ำ + เรียงตามวันที่; วันที่ผ่านมาแล้ว/ก่อนปิดจอง → 400', async () => {
      const round = await createRound();
      const d1 = freshDate();
      const d2 = freshDate();
      const detail = await addDays(round.id, [d2, d1, d2]);
      expect(detail.marketDays.map((d) => d.marketDate)).toEqual([d1, d2]);
      expect(detail).toMatchObject({ marketDayCount: 2, firstMarketDate: d1, lastMarketDate: d2 });

      const past = await http()
        .post(`/api/v1/admin/rounds/${round.id}/market-days`)
        .set(asAdmin())
        .send({ dates: [zonedDate(new Date(Date.now() - DAY), TZ)] })
        .expect(400);
      expect(past.body.error.details[0]).toMatchObject({ path: 'dates' });

      const beforeClose = await http()
        .post(`/api/v1/admin/rounds/${round.id}/market-days`)
        .set(asAdmin())
        .send({ dates: [zonedDate(new Date(), TZ)] })
        .expect(400);
      expect(beforeClose.body.error.details[0].message).toMatch(/^วันขายต้องอยู่หลังเวลาปิดจอง/);

      const dup = await http()
        .post(`/api/v1/admin/rounds/${round.id}/market-days`)
        .set(asAdmin())
        .send({ dates: [d1] })
        .expect(409);
      expect(dup.body.error).toMatchObject({ code: 'MARKET_DATE_TAKEN', details: { dates: [d1] } });
    });

    it('ยกเลิก → คืนสถานะ; เพิ่มวันที่เคยยกเลิกในรอบนี้ = คืนแถวเดิม; คืนสถานะวันที่รอบอื่นใช้แล้ว → 409', async () => {
      const round = await createRound();
      const date = freshDate();
      const dayId = (await addDays(round.id, [date])).marketDays[0]!.id;

      const cancelled = await http()
        .patch(`/api/v1/admin/rounds/${round.id}/market-days/${dayId}`)
        .set(asAdmin())
        .send({ isCancelled: true })
        .expect(200);
      expect(cancelled.body.data.marketDays[0]).toMatchObject({ id: dayId, isCancelled: true });

      const readded = await addDays(round.id, [date]);
      expect(readded.marketDays).toEqual([
        expect.objectContaining({ id: dayId, isCancelled: false }),
      ]);

      await http()
        .patch(`/api/v1/admin/rounds/${round.id}/market-days/${dayId}`)
        .set(asAdmin())
        .send({ isCancelled: true })
        .expect(200);
      const other = await createRound();
      await addDays(other.id, [date]);
      const res = await http()
        .patch(`/api/v1/admin/rounds/${round.id}/market-days/${dayId}`)
        .set(asAdmin())
        .send({ isCancelled: false })
        .expect(409);
      expect(res.body.error.code).toBe('MARKET_DATE_TAKEN');
      expect(await auditActions(dayId)).toEqual(['market_day.cancel', 'market_day.cancel']);
    });

    it('ลบวันขาย: ไม่มีการจอง → 204; มีการจอง → RESOURCE_IN_USE', async () => {
      const round = await createRound();
      const detail = await addDays(round.id, freshDates(2));
      const free = detail.marketDays[0]!;
      const used = detail.marketDays[1]!;
      await http()
        .delete(`/api/v1/admin/rounds/${round.id}/market-days/${free.id}`)
        .set(asAdmin())
        .expect(204);

      await prisma.booking.create({
        data: {
          marketId,
          vendorId: vendor.id,
          stallId,
          marketDayId: used.id,
          status: 'CANCELLED',
          amount: 100,
        },
      });
      const res = await http()
        .delete(`/api/v1/admin/rounds/${round.id}/market-days/${used.id}`)
        .set(asAdmin())
        .expect(409);
      expect(res.body.error).toMatchObject({
        code: 'RESOURCE_IN_USE',
        details: { bookings: 1, waitlists: 0 },
      });
      // การจองที่ยกเลิกแล้วไม่นับใน bookingCount
      const after = await http().get(`/api/v1/admin/rounds/${round.id}`).set(asAdmin()).expect(200);
      expect(after.body.data.marketDays).toEqual([
        expect.objectContaining({ id: used.id, bookingCount: 0 }),
      ]);
    });
  });

  // ───────────── override รายวัน ─────────────

  describe('stall day overrides', () => {
    it('ตั้งปิดล็อค/ราคาเฉพาะวัน → ผังผู้ค้าเห็นผล; ค่าว่าง = ลบ', async () => {
      const round = await createRound();
      const dayId = (await addDays(round.id, freshDates(1))).marketDays[0]!.id;
      const base = `/api/v1/admin/market-days/${dayId}/overrides`;

      const set = await http()
        .put(`${base}/${stallId}`)
        .set(asAdmin())
        .send({ priceOverride: 150.5, isClosed: false })
        .expect(200);
      expect(set.body.data).toEqual<StallDayOverride>({
        stallId,
        stallCode: 'A1',
        priceOverride: 150.5,
        isClosed: false,
      });
      const list = await http().get(base).set(asAdmin()).expect(200);
      expect(list.body.data).toEqual([set.body.data]);

      const stalls = async () =>
        (await http().get(`/api/v1/market-days/${dayId}/stalls`).set(vendor.headers).expect(200))
          .body.data as MarketDayStalls;
      expect((await stalls()).stalls[0]).toMatchObject({ price: 150.5, status: 'AVAILABLE' });

      await http()
        .put(`${base}/${stallId}`)
        .set(asAdmin())
        .send({ priceOverride: null, isClosed: true })
        .expect(200);
      expect((await stalls()).stalls[0]).toMatchObject({ price: 100, status: 'UNAVAILABLE' });

      const cleared = await http()
        .put(`${base}/${stallId}`)
        .set(asAdmin())
        .send({ priceOverride: null, isClosed: false })
        .expect(200);
      expect(cleared.body.data).toBeNull();
      expect((await http().get(base).set(asAdmin())).body.data).toEqual([]);

      await http()
        .put(`${base}/${stallId}`)
        .set(asAdmin())
        .send({ priceOverride: 1, isClosed: true })
        .expect(200);
      await http().delete(`${base}/${stallId}`).set(asAdmin()).expect(204);
      expect((await http().get(base).set(asAdmin())).body.data).toEqual([]);

      const actions = (
        await prisma.auditLog.findMany({
          where: { action: { startsWith: 'stall_day_override.' } },
          orderBy: { createdAt: 'asc' },
          select: { action: true },
        })
      ).map((a) => a.action);
      expect(actions).toEqual([
        'stall_day_override.set',
        'stall_day_override.set',
        'stall_day_override.delete',
        'stall_day_override.set',
        'stall_day_override.delete',
      ]);
    });

    it('ล็อคตลาดอื่น → 404, ราคาติดลบ → 400, วันที่ยกเลิก → INVALID_STATE_TRANSITION', async () => {
      const round = await createRound();
      const dayId = (await addDays(round.id, freshDates(1))).marketDays[0]!.id;
      const base = `/api/v1/admin/market-days/${dayId}/overrides`;

      await http()
        .put(`${base}/${otherMarketStallId}`)
        .set(asAdmin())
        .send({ priceOverride: 1, isClosed: false })
        .expect(404);
      await http()
        .put(`${base}/${stallId}`)
        .set(asAdmin())
        .send({ priceOverride: -1, isClosed: false })
        .expect(400);

      await http()
        .patch(`/api/v1/admin/rounds/${round.id}/market-days/${dayId}`)
        .set(asAdmin())
        .send({ isCancelled: true })
        .expect(200);
      const res = await http()
        .put(`${base}/${stallId}`)
        .set(asAdmin())
        .send({ priceOverride: 1, isClosed: false })
        .expect(409);
      expect(res.body.error.code).toBe('INVALID_STATE_TRANSITION');
      await http().get(base).set(asAdmin(otherMarketAdmin)).expect(404);
    });
  });

  // ───────────── ผู้ค้า ─────────────

  describe('GET /rounds/current', () => {
    beforeEach(async () => {
      // แต่ละ test เริ่มจากไม่มีรอบที่ผู้ค้าเห็น
      await prisma.bookingRound.updateMany({
        where: { marketId, status: 'PUBLISHED' },
        data: { status: 'CANCELLED' },
      });
      await prisma.marketDay.updateMany({ where: { marketId }, data: { isCancelled: true } });
    });

    const current = async (headers = vendor.headers) =>
      (await http().get('/api/v1/rounds/current').set(headers).expect(200)).body
        .data as CurrentRoundResponse;

    it('ไม่มีรอบ → round: null พร้อมเวลา server', async () => {
      await createRound(); // DRAFT ผู้ค้าไม่เห็น
      const before = Date.now();
      const res = await current();
      expect(res.round).toBeNull();
      expect(Date.parse(res.serverTime)).toBeGreaterThanOrEqual(before);
      expect(Date.parse(res.serverTime)).toBeLessThanOrEqual(Date.now());
    });

    it('รอบที่เปิดอยู่มาก่อนรอบที่กำลังจะเปิด; ไม่ส่งวันที่ยกเลิก', async () => {
      const upcoming = await publishedRound({ openAt: fromNow(HOUR) });
      expect((await current()).round).toMatchObject({ id: upcoming.id, phase: 'UPCOMING' });

      const open = await publishedRound({ openAt: fromNow(-HOUR) }, 2);
      const res = await current();
      expect(res.round).toMatchObject({ id: open.id, phase: 'OPEN', maxStallsPerVendor: 3 });
      expect(res.round?.marketDays.map((d) => d.marketDate)).toEqual(
        open.marketDays.map((d) => d.marketDate),
      );

      await http()
        .patch(`/api/v1/admin/rounds/${open.id}/market-days/${open.marketDays[0]!.id}`)
        .set(asAdmin())
        .send({ isCancelled: true })
        .expect(200);
      expect((await current()).round?.marketDays).toHaveLength(1);
    });

    it('ผู้ค้ายังไม่อนุมัติ → 403; ผู้ค้าตลาดอื่นไม่เห็นรอบของตลาดนี้', async () => {
      await publishedRound();
      const pending = await makeVendor('PENDING');
      const res = await http().get('/api/v1/rounds/current').set(pending.headers).expect(403);
      expect(res.body.error.code).toBe('VENDOR_NOT_APPROVED');
      const outsider = await makeVendor('APPROVED', otherMarketId);
      expect((await current(outsider.headers)).round).toBeNull();
    });
  });

  // ───────────── assertRoundOpen (ใช้ตอนจอง Phase 4.1) ─────────────

  it('assertRoundOpen กับ DB: ก่อน open_at 1 วินาที → ROUND_NOT_OPEN, open_at พอดี → ผ่าน', async () => {
    const round = await publishedRound();
    const dayId = round.marketDays[0]!.id;
    const openAt = new Date(round.openAt);
    const service = app.get(RoundService);

    await expect(
      service.assertRoundOpen(dayId, { now: new Date(openAt.getTime() - 1000) }),
    ).rejects.toMatchObject({ code: 'ROUND_NOT_OPEN', details: { phase: 'UPCOMING' } });
    await expect(service.assertRoundOpen(dayId, { now: openAt })).resolves.toMatchObject({
      id: dayId,
      round: { id: round.id },
    });
    await expect(
      service.assertRoundOpen(dayId, { marketId: otherMarketId, now: openAt }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
