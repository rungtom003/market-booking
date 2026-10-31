import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { MarketDayStalls, MarketLayout, Stall, Zone } from '@market-booking/shared';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import type { PrismaClient } from '../../src/generated/prisma/client';
import type { AdminPrincipal } from '../../src/modules/auth/principal';
import { TokenService } from '../../src/modules/auth/token.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { setupApp } from '../../src/setup-app';
import { truncateAll } from './test-db';

describe('Market setup: categories, zones, stalls, layout (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let marketId: string;
  let otherMarketId: string;
  let admin: AdminPrincipal;
  let staff: AdminPrincipal;
  let otherMarketAdmin: AdminPrincipal;
  let superAdminId: string;
  let phoneSeq = 0;
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
    superAdminId = (await makeAdmin('root', 'SUPER_ADMIN', null)).id;
  });

  afterAll(async () => {
    await app.close();
  });

  // ───────────── helpers ─────────────

  const bearer = (p: AdminPrincipal) => `Bearer ${app.get(TokenService).signAccessToken(p)}`;
  const asAdmin = (p: AdminPrincipal = admin) => ({ Authorization: bearer(p) });

  async function makeVendor(status: 'APPROVED' | 'PENDING' = 'APPROVED', mkt = marketId) {
    const phone = `08${String(20000000 + ++phoneSeq).slice(-8)}`;
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

  async function createZone(body: Record<string, unknown> = {}, p = admin): Promise<Zone> {
    const res = await http()
      .post('/api/v1/admin/zones')
      .set(asAdmin(p))
      .send({ name: `โซน${Math.random()}`, color: '#22c55e', ...body })
      .expect(201);
    return res.body.data;
  }

  async function createStall(zoneId: string, body: Record<string, unknown> = {}): Promise<Stall> {
    const res = await http()
      .post('/api/v1/admin/stalls')
      .set(asAdmin())
      .send({
        zoneId,
        code: `S${Math.floor(Math.random() * 1e6)}`,
        widthM: 2,
        lengthM: 2,
        price: 100,
        ...body,
      })
      .expect(201);
    return res.body.data;
  }

  async function makeMarketDay(mkt = marketId, date = '2026-12-05') {
    const round = await prisma.bookingRound.create({
      data: {
        marketId: mkt,
        name: 'รอบทดสอบ',
        openAt: new Date('2026-11-20T00:00:00Z'),
        closeAt: new Date('2026-11-25T00:00:00Z'),
        maxStallsPerVendor: 2,
        createdById: superAdminId,
      },
    });
    return prisma.marketDay.create({
      data: { marketId: mkt, roundId: round.id, marketDate: new Date(date) },
    });
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

  describe('permissions', () => {
    it.each(['product-categories', 'zones', 'stalls'])(
      'STAFF ไม่มีสิทธิ์จัดการ /admin/%s → 403',
      async (path) => {
        const res = await http().get(`/api/v1/admin/${path}`).set(asAdmin(staff)).expect(403);
        expect(res.body.error.code).toBe('FORBIDDEN');
      },
    );

    it('ผู้ค้าเรียก endpoint ของ admin ไม่ได้', async () => {
      const vendor = await makeVendor();
      await http().get('/api/v1/admin/zones').set(vendor.headers).expect(403);
    });
  });

  // ───────────── ประเภทสินค้า ─────────────

  describe('product categories', () => {
    it('CRUD + audit, sortOrder ต่อท้ายอัตโนมัติ', async () => {
      const a = await http()
        .post('/api/v1/admin/product-categories')
        .set(asAdmin())
        .send({ name: '  ผลไม้ ' })
        .expect(201);
      expect(a.body.data).toMatchObject({ name: 'ผลไม้', vendorCount: 0 });
      const b = await http()
        .post('/api/v1/admin/product-categories')
        .set(asAdmin())
        .send({ name: 'ขนม' })
        .expect(201);
      expect(b.body.data.sortOrder).toBe(a.body.data.sortOrder + 1);

      const updated = await http()
        .patch(`/api/v1/admin/product-categories/${a.body.data.id}`)
        .set(asAdmin())
        .send({ name: 'ผลไม้สด' })
        .expect(200);
      expect(updated.body.data.name).toBe('ผลไม้สด');

      const list = await http().get('/api/v1/admin/product-categories').set(asAdmin()).expect(200);
      expect(list.body.data.map((c: { name: string }) => c.name)).toEqual(
        expect.arrayContaining(['ผลไม้สด', 'ขนม']),
      );

      await http()
        .delete(`/api/v1/admin/product-categories/${b.body.data.id}`)
        .set(asAdmin())
        .expect(204);
      expect(await auditActions(a.body.data.id)).toEqual([
        'product_category.create',
        'product_category.update',
      ]);
      expect(await auditActions(b.body.data.id)).toEqual([
        'product_category.create',
        'product_category.delete',
      ]);
    });

    it('ลบประเภทที่ผู้ค้าใช้อยู่ไม่ได้ → RESOURCE_IN_USE', async () => {
      const cat = await prisma.productCategory.create({ data: { marketId, name: 'ใช้อยู่' } });
      const vendor = await makeVendor();
      await prisma.vendor.update({ where: { id: vendor.id }, data: { productCategoryId: cat.id } });

      const res = await http()
        .delete(`/api/v1/admin/product-categories/${cat.id}`)
        .set(asAdmin())
        .expect(409);
      expect(res.body.error).toMatchObject({ code: 'RESOURCE_IN_USE', details: { vendors: 1 } });
    });

    it('ลบประเภทแล้วถูกเอาออกจากโซนที่อนุญาตด้วย', async () => {
      const keep = await prisma.productCategory.create({ data: { marketId, name: 'คงไว้' } });
      const drop = await prisma.productCategory.create({ data: { marketId, name: 'ลบทิ้ง' } });
      const zone = await createZone({ allowedCategoryIds: [keep.id, drop.id] });

      await http().delete(`/api/v1/admin/product-categories/${drop.id}`).set(asAdmin()).expect(204);
      const row = await prisma.zone.findUniqueOrThrow({ where: { id: zone.id } });
      expect(row.allowedCategoryIds).toEqual([keep.id]);
    });

    it('แก้ประเภทของตลาดอื่นไม่ได้ → 404', async () => {
      const cat = await prisma.productCategory.create({ data: { marketId, name: 'ของตลาดหลัก' } });
      await http()
        .patch(`/api/v1/admin/product-categories/${cat.id}`)
        .set(asAdmin(otherMarketAdmin))
        .send({ name: 'x' })
        .expect(404);
    });
  });

  // ───────────── โซน ─────────────

  describe('zones', () => {
    it('สร้าง/แก้ไข: สีเป็นตัวใหญ่, ประเภทซ้ำถูกรวม, audit', async () => {
      const cat = await prisma.productCategory.create({ data: { marketId, name: 'โซนเทส' } });
      const zone = await createZone({ name: 'โซน C', allowedCategoryIds: [cat.id, cat.id] });
      expect(zone).toMatchObject({
        name: 'โซน C',
        color: '#22C55E',
        allowedCategoryIds: [cat.id],
        stallCount: 0,
      });

      const res = await http()
        .patch(`/api/v1/admin/zones/${zone.id}`)
        .set(asAdmin())
        .send({ color: '#ff0000', allowedCategoryIds: [] })
        .expect(200);
      expect(res.body.data).toMatchObject({ color: '#FF0000', allowedCategoryIds: [] });
      expect(await auditActions(zone.id)).toEqual(['zone.create', 'zone.update']);
    });

    it('สีผิดรูปแบบ → VALIDATION_ERROR', async () => {
      const res = await http()
        .post('/api/v1/admin/zones')
        .set(asAdmin())
        .send({ name: 'x', color: 'red' })
        .expect(400);
      expect(res.body.error.details[0].path).toBe('color');
    });

    it('ประเภทสินค้าของตลาดอื่น → VALIDATION_ERROR ที่ allowedCategoryIds', async () => {
      const foreign = await prisma.productCategory.create({
        data: { marketId: otherMarketId, name: 'ต่างตลาด' },
      });
      const res = await http()
        .post('/api/v1/admin/zones')
        .set(asAdmin())
        .send({ name: 'x', color: '#000000', allowedCategoryIds: [foreign.id] })
        .expect(400);
      expect(res.body.error).toMatchObject({
        code: 'VALIDATION_ERROR',
        details: [{ path: 'allowedCategoryIds' }],
      });
    });

    it('ลบโซนที่มีล็อคไม่ได้ ลบโซนว่างได้', async () => {
      const zone = await createZone();
      await createStall(zone.id);
      const res = await http().delete(`/api/v1/admin/zones/${zone.id}`).set(asAdmin()).expect(409);
      expect(res.body.error).toMatchObject({ code: 'RESOURCE_IN_USE', details: { stalls: 1 } });

      const empty = await createZone();
      await http().delete(`/api/v1/admin/zones/${empty.id}`).set(asAdmin()).expect(204);
      expect(await prisma.zone.count({ where: { id: empty.id } })).toBe(0);
    });
  });

  // ───────────── ล็อค ─────────────

  describe('stalls', () => {
    it('สร้างล็อค: รหัสเป็นตัวใหญ่, ค่า default ของผัง, ตัวเลขเป็น number', async () => {
      const zone = await createZone();
      const stall = await createStall(zone.id, { code: ' x1 ', price: 150.5 });
      expect(stall).toMatchObject({
        code: 'X1',
        price: 150.5,
        widthM: 2,
        posX: 0,
        posY: 0,
        shapeW: 60,
        shapeH: 60,
        isActive: true,
        isReserved: false,
        hasBookings: false,
      });
      expect(await auditActions(stall.id)).toEqual(['stall.create']);
    });

    it('รหัสซ้ำในตลาด → STALL_CODE_TAKEN แต่ตลาดอื่นใช้รหัสเดียวกันได้', async () => {
      const zone = await createZone();
      await createStall(zone.id, { code: 'DUP1' });
      const res = await http()
        .post('/api/v1/admin/stalls')
        .set(asAdmin())
        .send({ zoneId: zone.id, code: 'dup1', widthM: 2, lengthM: 2, price: 100 })
        .expect(409);
      expect(res.body.error).toMatchObject({
        code: 'STALL_CODE_TAKEN',
        details: { codes: ['DUP1'] },
      });

      const otherZone = await createZone({}, otherMarketAdmin);
      await http()
        .post('/api/v1/admin/stalls')
        .set(asAdmin(otherMarketAdmin))
        .send({ zoneId: otherZone.id, code: 'DUP1', widthM: 2, lengthM: 2, price: 100 })
        .expect(201);
    });

    it('สร้างในโซนของตลาดอื่นไม่ได้ → 404', async () => {
      const otherZone = await createZone({}, otherMarketAdmin);
      await http()
        .post('/api/v1/admin/stalls')
        .set(asAdmin())
        .send({ zoneId: otherZone.id, code: 'Q1', widthM: 2, lengthM: 2, price: 100 })
        .expect(404);
    });

    it('bulk create A1–A20 วางเป็นตาราง 10 คอลัมน์ + audit', async () => {
      const zone = await createZone();
      const res = await http()
        .post('/api/v1/admin/stalls/bulk')
        .set(asAdmin())
        .send({
          zoneId: zone.id,
          prefix: 'bk',
          from: 1,
          to: 20,
          widthM: 2,
          lengthM: 3,
          price: 120,
          originX: 20,
          originY: 500,
        })
        .expect(201);
      expect(res.body.data.created).toBe(20);
      expect(res.body.data.codes.slice(0, 3)).toEqual(['BK1', 'BK2', 'BK3']);

      const list = await http()
        .get(`/api/v1/admin/stalls?zoneId=${zone.id}`)
        .set(asAdmin())
        .expect(200);
      const stalls: Stall[] = list.body.data;
      // เรียงแบบตัวเลข: BK2 มาก่อน BK10
      expect(stalls.map((s) => s.code)).toEqual(res.body.data.codes);
      const pos = (code: string) => stalls.find((s) => s.code === code)!;
      expect(pos('BK1')).toMatchObject({ posX: 20, posY: 500, lengthM: 3, price: 120 });
      expect(pos('BK10')).toMatchObject({ posX: 20 + 9 * 70, posY: 500 });
      expect(pos('BK11')).toMatchObject({ posX: 20, posY: 570 });

      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { action: 'stall.bulk_create', entityId: zone.id },
      });
      expect((audit.after as { codes: string[] }).codes).toHaveLength(20);
    });

    it('bulk create ไม่ระบุ originY → วางต่อใต้ล็อคล่างสุด, padLength เติม 0', async () => {
      const zone = await createZone();
      const bottom = await prisma.$queryRaw<{ b: number }[]>`
        SELECT COALESCE(MAX(pos_y + shape_h), 0)::float AS b FROM stalls WHERE market_id = ${marketId}::uuid`;
      const res = await http()
        .post('/api/v1/admin/stalls/bulk')
        .set(asAdmin())
        .send({
          zoneId: zone.id,
          prefix: 'pd',
          from: 1,
          to: 3,
          padLength: 2,
          widthM: 2,
          lengthM: 2,
          price: 1,
        })
        .expect(201);
      expect(res.body.data.codes).toEqual(['PD01', 'PD02', 'PD03']);
      const first = await prisma.stall.findFirstOrThrow({ where: { marketId, code: 'PD01' } });
      expect(Number(first.posY)).toBeGreaterThan(bottom[0]!.b);
    });

    it('bulk create มีรหัสซ้ำบางตัว → ไม่สร้างเลยสักตัว', async () => {
      const zone = await createZone();
      await createStall(zone.id, { code: 'CF3' });
      const res = await http()
        .post('/api/v1/admin/stalls/bulk')
        .set(asAdmin())
        .send({ zoneId: zone.id, prefix: 'CF', from: 1, to: 5, widthM: 2, lengthM: 2, price: 1 })
        .expect(409);
      expect(res.body.error).toMatchObject({
        code: 'STALL_CODE_TAKEN',
        details: { codes: ['CF3'] },
      });
      expect(await prisma.stall.count({ where: { marketId, code: { startsWith: 'CF' } } })).toBe(1);
    });

    it.each([
      [{ from: 5, to: 1 }, 'to'],
      [{ from: 1, to: 201 }, 'to'],
      [{ prefix: 'A B' }, 'prefix'],
    ])('bulk create ค่าผิด %j → VALIDATION_ERROR ที่ %s', async (patch, path) => {
      const zone = await createZone();
      const res = await http()
        .post('/api/v1/admin/stalls/bulk')
        .set(asAdmin())
        .send({
          zoneId: zone.id,
          prefix: 'V',
          from: 1,
          to: 2,
          widthM: 2,
          lengthM: 2,
          price: 1,
          ...patch,
        })
        .expect(400);
      expect(res.body.error.details.map((d: { path: string }) => d.path)).toContain(path);
    });

    it('แก้ตำแหน่ง/ย้ายโซน + audit before/after', async () => {
      const zone = await createZone();
      const zone2 = await createZone();
      const stall = await createStall(zone.id);
      const res = await http()
        .patch(`/api/v1/admin/stalls/${stall.id}`)
        .set(asAdmin())
        .send({ posX: 123.45, posY: 67, rot: 90, zoneId: zone2.id, isReserved: true })
        .expect(200);
      expect(res.body.data).toMatchObject({
        posX: 123.45,
        posY: 67,
        rot: 90,
        zoneId: zone2.id,
        isReserved: true,
      });
      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { action: 'stall.update', entityId: stall.id },
      });
      expect(audit.before).toMatchObject({ posX: 0, zoneId: zone.id });
      expect(audit.after).toMatchObject({ posX: 123.45, zoneId: zone2.id });
    });

    it('เปลี่ยนรหัสเป็นรหัสที่มีอยู่ → STALL_CODE_TAKEN', async () => {
      const zone = await createZone();
      await createStall(zone.id, { code: 'RN1' });
      const b = await createStall(zone.id, { code: 'RN2' });
      const res = await http()
        .patch(`/api/v1/admin/stalls/${b.id}`)
        .set(asAdmin())
        .send({ code: 'rn1' })
        .expect(409);
      expect(res.body.error.code).toBe('STALL_CODE_TAKEN');
    });

    it('ล็อคที่มีการจองลบไม่ได้ → RESOURCE_IN_USE แต่ปิดการใช้งานได้; ล็อคไม่มีการจองลบได้', async () => {
      const zone = await createZone();
      const used = await createStall(zone.id);
      const day = await makeMarketDay(marketId, '2026-12-01');
      const vendor = await makeVendor();
      await prisma.booking.create({
        data: {
          marketId,
          stallId: used.id,
          marketDayId: day.id,
          vendorId: vendor.id,
          status: 'CANCELLED',
          amount: 100,
        },
      });

      const res = await http().delete(`/api/v1/admin/stalls/${used.id}`).set(asAdmin()).expect(409);
      expect(res.body.error).toMatchObject({ code: 'RESOURCE_IN_USE', details: { bookings: 1 } });
      const list = await http().get(`/api/v1/admin/stalls?zoneId=${zone.id}`).set(asAdmin());
      expect(list.body.data[0].hasBookings).toBe(true);

      const off = await http()
        .patch(`/api/v1/admin/stalls/${used.id}`)
        .set(asAdmin())
        .send({ isActive: false })
        .expect(200);
      expect(off.body.data.isActive).toBe(false);

      const free = await createStall(zone.id);
      await prisma.stallDayOverride.create({
        data: { stallId: free.id, marketDayId: day.id, isClosed: true },
      });
      await http().delete(`/api/v1/admin/stalls/${free.id}`).set(asAdmin()).expect(204);
      expect(await prisma.stall.count({ where: { id: free.id } })).toBe(0);
      expect(await auditActions(free.id)).toEqual(['stall.create', 'stall.delete']);
    });

    it('?isActive=false กรองเฉพาะล็อคที่ปิด', async () => {
      const zone = await createZone();
      await createStall(zone.id);
      const off = await createStall(zone.id, { isActive: false });
      const res = await http()
        .get(`/api/v1/admin/stalls?zoneId=${zone.id}&isActive=false`)
        .set(asAdmin())
        .expect(200);
      expect(res.body.data.map((s: Stall) => s.id)).toEqual([off.id]);
    });
  });

  // ───────────── ผังตลาดฝั่งผู้ค้า ─────────────

  describe('vendor layout', () => {
    let zone: Zone;
    let open: Stall;
    let reserved: Stall;
    let closedToday: Stall;
    let repriced: Stall;
    let inactive: Stall;

    beforeAll(async () => {
      zone = await createZone({ name: 'โซนผัง', sortOrder: 0 });
      open = await createStall(zone.id, { code: 'M1', posX: 10, posY: 20 });
      reserved = await createStall(zone.id, { code: 'M2', isReserved: true });
      closedToday = await createStall(zone.id, { code: 'M3' });
      repriced = await createStall(zone.id, { code: 'M10', price: 100 });
      inactive = await createStall(zone.id, { code: 'M4', isActive: false });
    });

    it('GET /market/layout: ผู้ค้าที่อนุมัติแล้วเห็นเฉพาะล็อคที่เปิดใช้งาน', async () => {
      const vendor = await makeVendor();
      const res = await http().get('/api/v1/market/layout').set(vendor.headers).expect(200);
      const layout: MarketLayout = res.body.data;
      const ids = layout.stalls.map((s) => s.id);
      expect(ids).toEqual(expect.arrayContaining([open.id, reserved.id, repriced.id]));
      expect(ids).not.toContain(inactive.id);
      expect(layout.stalls.find((s) => s.id === open.id)).toMatchObject({
        code: 'M1',
        posX: 10,
        posY: 20,
        shapeW: 60,
        isReserved: false,
      });
      expect(layout.zones).toEqual(
        expect.arrayContaining([{ id: zone.id, name: 'โซนผัง', color: '#22C55E', sortOrder: 0 }]),
      );
      // ไม่มีข้อมูลภายในของ admin
      expect(layout.stalls[0]).not.toHaveProperty('note');
    });

    it('ผู้ค้าที่ยังไม่อนุมัติ → VENDOR_NOT_APPROVED', async () => {
      const vendor = await makeVendor('PENDING');
      const res = await http().get('/api/v1/market/layout').set(vendor.headers).expect(403);
      expect(res.body.error.code).toBe('VENDOR_NOT_APPROVED');
    });

    it('GET /market-days/:id/stalls: ราคา/ปิดล็อคตามวัน, สงวนไว้ = CLOSED', async () => {
      const day = await makeMarketDay(marketId, '2026-12-12');
      await prisma.stallDayOverride.createMany({
        data: [
          { stallId: closedToday.id, marketDayId: day.id, isClosed: true },
          { stallId: repriced.id, marketDayId: day.id, priceOverride: 250 },
        ],
      });
      const vendor = await makeVendor();
      const res = await http()
        .get(`/api/v1/market-days/${day.id}/stalls`)
        .set(vendor.headers)
        .expect(200);
      const body: MarketDayStalls = res.body.data;
      expect(body.marketDay).toEqual({
        id: day.id,
        roundId: day.roundId,
        marketDate: '2026-12-12',
        isCancelled: false,
      });
      // รอบ + เวลา server สำหรับ Countdown (รอบ DRAFT = ไม่มี phase)
      expect(body.round).toEqual({
        id: day.roundId,
        name: 'รอบทดสอบ',
        status: 'DRAFT',
        phase: null,
        openAt: '2026-11-20T00:00:00.000Z',
        closeAt: '2026-11-25T00:00:00.000Z',
        maxStallsPerVendor: 2,
      });
      expect(Math.abs(Date.parse(body.serverTime) - Date.now())).toBeLessThan(5_000);
      const byId = new Map(body.stalls.map((s) => [s.id, s]));
      expect(byId.get(open.id)).toMatchObject({ status: 'AVAILABLE', price: 100 });
      expect(byId.get(reserved.id)?.status).toBe('CLOSED');
      expect(byId.get(closedToday.id)?.status).toBe('CLOSED');
      expect(byId.get(repriced.id)).toMatchObject({ status: 'AVAILABLE', price: 250 });
      expect(byId.has(inactive.id)).toBe(false);
      // M3 ก่อน M10 (เรียงแบบตัวเลข)
      const codes = body.stalls.map((s) => s.code);
      expect(codes.indexOf('M3')).toBeLessThan(codes.indexOf('M10'));
    });

    it('วันขายของตลาดอื่น → 404', async () => {
      const day = await makeMarketDay(otherMarketId, '2026-12-19');
      const vendor = await makeVendor();
      await http().get(`/api/v1/market-days/${day.id}/stalls`).set(vendor.headers).expect(404);
    });
  });
});
