import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type {
  AdminMapLayout,
  MarketDayStalls,
  MarketLayout,
  SaveMapLayoutInput,
  UploadTicket,
} from '@market-booking/shared';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import type { PrismaClient } from '../../src/generated/prisma/client';
import type { AdminPrincipal } from '../../src/modules/auth/principal';
import { TokenService } from '../../src/modules/auth/token.service';
import { StorageService } from '../../src/modules/storage/storage.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { setupApp } from '../../src/setup-app';
import { truncateAll } from './test-db';

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(100, 1),
]);

describe('Map editor layout (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let marketId: string;
  let otherStallId: string;
  let admin: AdminPrincipal;
  let staff: AdminPrincipal;
  let zoneId: string;
  let vendorHeaders: { Authorization: string };
  let marketDayId: string;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    await truncateAll(prisma as unknown as PrismaClient);

    marketId = (await prisma.market.create({ data: { name: 'ตลาดผัง', address: '-' } })).id;
    const other = (await prisma.market.create({ data: { name: 'ตลาดอื่น', address: '-' } })).id;
    const makeAdmin = async (username: string, role: AdminPrincipal['role']) => {
      const row = await prisma.adminUser.create({
        data: { username, passwordHash: 'x', displayName: username, role, marketId },
      });
      return { actorType: 'ADMIN', id: row.id, role, marketId } as AdminPrincipal;
    };
    admin = await makeAdmin('layout', 'ADMIN');
    staff = await makeAdmin('staffer', 'STAFF');

    zoneId = (await prisma.zone.create({ data: { marketId, name: 'โซนเอ', color: '#F59E0B' } })).id;
    const otherZone = (
      await prisma.zone.create({ data: { marketId: other, name: 'อื่น', color: '#000000' } })
    ).id;
    const stall = (mkt: string, zone: string, code: string, x: number, isActive = true) =>
      prisma.stall.create({
        data: {
          marketId: mkt,
          zoneId: zone,
          code,
          widthM: 2,
          lengthM: 2,
          price: 100,
          posX: x,
          posY: 20,
          shapeW: 60,
          shapeH: 60,
          isActive,
        },
      });
    await stall(marketId, zoneId, 'A1', 20);
    await stall(marketId, zoneId, 'A2', 90);
    await stall(marketId, zoneId, 'A9', 160, false);
    otherStallId = (await stall(other, otherZone, 'X1', 20)).id;

    const vendor = await prisma.vendor.create({
      data: {
        marketId,
        firstName: 'ดู',
        lastName: 'ผัง',
        phone: '0899999999',
        address: '-',
        pdpaConsentAt: new Date(),
        status: 'APPROVED',
      },
    });
    vendorHeaders = {
      Authorization: `Bearer ${app.get(TokenService).signAccessToken({ actorType: 'VENDOR', id: vendor.id, marketId })}`,
    };
    const round = await prisma.bookingRound.create({
      data: {
        marketId,
        name: 'รอบ',
        openAt: new Date(Date.now() + 86_400_000),
        closeAt: new Date(Date.now() + 2 * 86_400_000),
        maxStallsPerVendor: 1,
        status: 'PUBLISHED',
        createdById: admin.id,
      },
    });
    marketDayId = (
      await prisma.marketDay.create({
        data: { marketId, roundId: round.id, marketDate: new Date('2027-01-09T00:00:00Z') },
      })
    ).id;
  });

  afterAll(async () => {
    await app.close();
  });

  const as = (p: AdminPrincipal) => ({
    Authorization: `Bearer ${app.get(TokenService).signAccessToken(p)}`,
  });
  const getLayout = async () =>
    (await http().get('/api/v1/admin/stalls/layout').set(as(admin)).expect(200)).body
      .data as AdminMapLayout;
  const save = (body: SaveMapLayoutInput | Record<string, unknown>, p = admin) =>
    http().put('/api/v1/admin/stalls/layout').set(as(p)).send(body);

  /** ผังเดิมทั้งชุด (ไม่เปลี่ยนอะไร) เป็นจุดตั้งต้นของแต่ละ test */
  function unchanged(layout: AdminMapLayout): SaveMapLayoutInput {
    return {
      version: layout.version,
      stalls: layout.stalls.map(({ id, posX, posY, shapeW, shapeH, rot }) => ({
        id,
        posX,
        posY,
        shapeW,
        shapeH,
        rot,
      })),
      newStalls: [],
      features: layout.features.map(({ id, kind, label, posX, posY, width, height, rot }) => ({
        id,
        kind,
        label,
        posX,
        posY,
        width,
        height,
        rot,
      })),
      background: layout.background && {
        key: layout.background.key,
        width: layout.background.width,
        height: layout.background.height,
      },
    };
  }

  it('GET: ทุกล็อครวมที่ปิดใช้งาน + version เริ่มต้น 0, ยังไม่มีสัญลักษณ์/พื้นหลัง', async () => {
    const layout = await getLayout();

    expect(layout.version).toBe(0);
    expect(layout.stalls.map((s) => [s.code, s.isActive])).toEqual([
      ['A1', true],
      ['A2', true],
      ['A9', false],
    ]);
    expect(layout).toMatchObject({ features: [], background: null });
    expect(layout.zones).toEqual([expect.objectContaining({ id: zoneId, name: 'โซนเอ' })]);
  });

  it('PUT: ย้าย/ย่อ-ขยาย/หมุนล็อค + ล็อคใหม่ + สัญลักษณ์ บันทึกพร้อมกัน, version +1, ลง audit log', async () => {
    const layout = await getLayout();
    const body = unchanged(layout);
    const a1 = body.stalls.find((s) => s.id === layout.stalls[0]!.id)!;
    Object.assign(a1, { posX: 40, posY: 100, shapeW: 80, rot: 90 });
    body.newStalls = [
      {
        zoneId,
        code: 'a3',
        widthM: 2,
        lengthM: 3,
        price: 150,
        posX: 230,
        posY: 20,
        shapeW: 60,
        shapeH: 90,
        rot: 0,
      },
    ];
    body.features = [
      { kind: 'WALKWAY', label: null, posX: 0, posY: 90, width: 400, height: 30, rot: 0 },
      { kind: 'TOILET', label: 'ห้องน้ำหญิง', posX: 300, posY: 150, width: 40, height: 40, rot: 0 },
    ];

    const res = await save(body).expect(200);
    const saved = res.body.data as AdminMapLayout;

    expect(saved.version).toBe(1);
    expect(saved.stalls.find((s) => s.code === 'A1')).toMatchObject({
      posX: 40,
      posY: 100,
      shapeW: 80,
      shapeH: 60,
      rot: 90,
    });
    expect(saved.stalls.find((s) => s.code === 'A3')).toMatchObject({
      zoneId,
      price: 150,
      lengthM: 3,
      posX: 230,
      isActive: true,
    });
    expect(saved.features.map((f) => [f.kind, f.label])).toEqual([
      ['WALKWAY', null],
      ['TOILET', 'ห้องน้ำหญิง'],
    ]);
    const log = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'market_layout.update' },
    });
    expect(log.after).toMatchObject({ movedStalls: 1, newStalls: ['A3'], features: 2 });
  });

  it('version เก่า → 409 LAYOUT_OUTDATED (คนอื่นบันทึกไปก่อน) และไม่เปลี่ยนอะไร', async () => {
    const layout = await getLayout();
    const stale = { ...unchanged(layout), version: layout.version - 1, features: [] };

    const res = await save(stale).expect(409);

    expect(res.body.error.code).toBe('LAYOUT_OUTDATED');
    expect((await getLayout()).features).toHaveLength(2);
  });

  it('ข้อผิดพลาดกลางทางย้อนกลับทั้งชุด: ล็อคของตลาดอื่น (404), รหัสล็อคใหม่ซ้ำ (409)', async () => {
    const layout = await getLayout();
    const moved = unchanged(layout);
    moved.stalls[0]!.posX = 999;
    moved.features = [];

    await save({
      ...moved,
      stalls: [
        ...moved.stalls,
        { id: otherStallId, posX: 0, posY: 0, shapeW: 10, shapeH: 10, rot: 0 },
      ],
    }).expect(404);
    const dup = await save({
      ...moved,
      newStalls: [
        {
          zoneId,
          code: 'A2',
          widthM: 2,
          lengthM: 2,
          price: 100,
          posX: 0,
          posY: 0,
          shapeW: 60,
          shapeH: 60,
          rot: 0,
        },
      ],
    }).expect(409);
    expect(dup.body.error.code).toBe('STALL_CODE_TAKEN');

    const after = await getLayout();
    expect(after.version).toBe(layout.version);
    expect(after.stalls[0]!.posX).toBe(layout.stalls[0]!.posX);
    expect(after.features).toHaveLength(2);
  });

  it('รูปแปลนพื้นหลัง: อัปโหลด → บันทึก → ผู้ค้าเห็นพร้อมสัญลักษณ์ (ผังตลาด + ผังวันขาย); เปลี่ยนรูปแล้วรูปเก่าถูกลบ', async () => {
    const upload = async () => {
      const res = await http()
        .post('/api/v1/admin/stalls/layout/background-upload')
        .set(as(admin))
        .send({ contentType: 'image/png', size: PNG.length })
        .expect(201);
      const ticket = res.body.data as UploadTicket;
      expect(ticket.key).toMatch(new RegExp(`^markets/${marketId}/layout/.+\\.png$`));
      const put = await fetch(ticket.url, { method: 'PUT', headers: ticket.headers, body: PNG });
      expect(put.ok).toBe(true);
      return ticket.key;
    };

    const first = await upload();
    let layout = await getLayout();
    await save({
      ...unchanged(layout),
      background: { key: first, width: 800, height: 600 },
    }).expect(200);

    const market = (await http().get('/api/v1/market/layout').set(vendorHeaders).expect(200)).body
      .data as MarketLayout;
    expect(market.background).toEqual({
      url: expect.stringContaining(first),
      width: 800,
      height: 600,
    });
    expect(market.features.map((f) => f.kind)).toEqual(['WALKWAY', 'TOILET']);
    const day = (
      await http().get(`/api/v1/market-days/${marketDayId}/stalls`).set(vendorHeaders).expect(200)
    ).body.data as MarketDayStalls;
    expect(day.background?.width).toBe(800);
    expect(day.features).toHaveLength(2);

    const second = await upload();
    layout = await getLayout();
    await save({
      ...unchanged(layout),
      background: { key: second, width: 1000, height: 750 },
    }).expect(200);
    const storage = app.get(StorageService);
    expect(await storage.stat(first)).toBeNull();
    expect(await storage.stat(second)).not.toBeNull();
  });

  it('key พื้นหลังที่ไม่ใช่ของตลาดนี้ / ยังไม่อัปโหลด → 400', async () => {
    const layout = await getLayout();
    const base = unchanged(layout);

    await save({
      ...base,
      background: { key: 'vendors/x/slip.png', width: 100, height: 100 },
    }).expect(400);
    await save({
      ...base,
      background: { key: `markets/${marketId}/layout/nothing.png`, width: 100, height: 100 },
    }).expect(400);
  });

  it('body ผิด (ล็อคซ้ำในรายการ, ชนิดสัญลักษณ์ไม่รู้จัก) → 400; STAFF แก้ผังไม่ได้ → 403', async () => {
    const layout = await getLayout();
    const base = unchanged(layout);

    await save({ ...base, stalls: [...base.stalls, base.stalls[0]!] }).expect(400);
    await save({
      ...base,
      features: [{ kind: 'FOUNTAIN', posX: 0, posY: 0, width: 10, height: 10, rot: 0 }],
    }).expect(400);
    await save(base, staff).expect(403);
  });
});
