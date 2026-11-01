import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AdminAnnouncement, Announcement } from '@market-booking/shared';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import type { PrismaClient } from '../../src/generated/prisma/client';
import type { AdminPrincipal } from '../../src/modules/auth/principal';
import { TokenService } from '../../src/modules/auth/token.service';
import { LineMessagingProvider } from '../../src/modules/notify/line/line-messaging.provider';
import { NotificationReminders } from '../../src/modules/notify/notification-reminders';
import { PrismaService } from '../../src/prisma/prisma.service';
import { setupApp } from '../../src/setup-app';
import { truncateAll } from './test-db';

const HOUR = 3_600_000;

describe('Announcements (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let marketId: string;
  let otherMarketId: string;
  let admin: AdminPrincipal;
  let staff: AdminPrincipal;
  let seq = 0;
  const line = { enabled: true, push: jest.fn(), reply: jest.fn() };
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(LineMessagingProvider)
      .useValue(line)
      .compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    await truncateAll(prisma as unknown as PrismaClient);

    marketId = (await prisma.market.create({ data: { name: 'ตลาดประกาศ', address: '-' } })).id;
    otherMarketId = (await prisma.market.create({ data: { name: 'ตลาดอื่น', address: '-' } })).id;
    const makeAdmin = async (username: string, role: AdminPrincipal['role']) => {
      const row = await prisma.adminUser.create({
        data: { username, passwordHash: 'x', displayName: username, role, marketId },
      });
      return { actorType: 'ADMIN', id: row.id, role, marketId } as AdminPrincipal;
    };
    admin = await makeAdmin('news', 'ADMIN');
    staff = await makeAdmin('helper', 'STAFF');
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    line.enabled = true;
    await prisma.announcement.deleteMany();
    await prisma.notificationLog.deleteMany();
  });

  const tokenOf = (p: Parameters<TokenService['signAccessToken']>[0]) =>
    app.get(TokenService).signAccessToken(p);
  const as = (p: AdminPrincipal) => ({ Authorization: `Bearer ${tokenOf(p)}` });

  async function makeVendor(
    opts: { line?: boolean; status?: 'APPROVED' | 'PENDING'; market?: string } = {},
  ) {
    const n = ++seq;
    const mkt = opts.market ?? marketId;
    const row = await prisma.vendor.create({
      data: {
        marketId: mkt,
        firstName: 'ผู้ค้า',
        lastName: `ที่${n}`,
        phone: `08${String(50000000 + n).slice(-8)}`,
        address: '-',
        pdpaConsentAt: new Date(),
        status: opts.status ?? 'APPROVED',
        lineUserId: opts.line ? `U${n.toString(16).padStart(32, '0')}` : null,
      },
    });
    return {
      id: row.id,
      headers: {
        Authorization: `Bearer ${tokenOf({ actorType: 'VENDOR', id: row.id, marketId: mkt })}`,
      },
    };
  }

  const create = (body: object, p = admin) =>
    http().post('/api/v1/admin/announcements').set(as(p)).send(body);
  const at = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

  it('admin สร้าง/แก้/ลบ พร้อมสถานะตามเวลา และลง audit log; STAFF ทำไม่ได้', async () => {
    const res = await create({
      title: ' งดขายวันพระ ',
      body: 'ตลาดปิด 1 วัน',
      publishAt: at(HOUR),
    }).expect(201);
    const created = res.body.data as AdminAnnouncement;
    expect(created).toMatchObject({
      title: 'งดขายวันพระ',
      state: 'SCHEDULED',
      isPinned: false,
      expireAt: null,
      broadcastLine: false,
      broadcastedAt: null,
    });

    const updated = await http()
      .patch(`/api/v1/admin/announcements/${created.id}`)
      .set(as(admin))
      .send({ publishAt: at(-HOUR), isPinned: true })
      .expect(200);
    expect(updated.body.data).toMatchObject({ state: 'ACTIVE', isPinned: true });

    // แก้เฉพาะ expireAt ให้ก่อน publishAt เดิม → 400 ที่ช่อง expireAt
    const bad = await http()
      .patch(`/api/v1/admin/announcements/${created.id}`)
      .set(as(admin))
      .send({ expireAt: at(-2 * HOUR) })
      .expect(400);
    expect(bad.body.error.details).toEqual([expect.objectContaining({ path: 'expireAt' })]);

    const list = await http().get('/api/v1/admin/announcements').set(as(admin)).expect(200);
    expect((list.body.data as AdminAnnouncement[]).map((a) => a.id)).toEqual([created.id]);

    await http().delete(`/api/v1/admin/announcements/${created.id}`).set(as(admin)).expect(204);
    expect(
      (
        await prisma.auditLog.findMany({
          where: { entityId: created.id },
          orderBy: { createdAt: 'asc' },
        })
      ).map((l) => l.action),
    ).toEqual(['announcement.create', 'announcement.update', 'announcement.delete']);

    await create({ title: 'x', body: 'y', publishAt: at(0) }, staff).expect(403);
    await http().get('/api/v1/admin/announcements').set(as(staff)).expect(403);
  });

  it('ค่าผิด → 400 (หัวข้อว่าง, สิ้นสุดก่อนเผยแพร่, เวลาไม่มี timezone)', async () => {
    await create({ title: ' ', body: 'y', publishAt: at(0) }).expect(400);
    await create({ title: 'x', body: 'y', publishAt: at(HOUR), expireAt: at(0) }).expect(400);
    await create({ title: 'x', body: 'y', publishAt: '2026-12-01T10:00:00' }).expect(400);
  });

  it('ผู้ค้า (ทุกสถานะ) เห็นเฉพาะที่กำลังแสดงของตลาดตัวเอง — ปักหมุดก่อน แล้วใหม่สุดก่อน', async () => {
    const add = (title: string, publishAt: string, extra: object = {}) =>
      create({ title, body: '-', publishAt, ...extra }).expect(201);
    await add('เก่า', at(-3 * HOUR));
    await add('ใหม่', at(-HOUR));
    await add('ปักหมุดเก่าสุด', at(-5 * HOUR), { isPinned: true });
    await add('ตั้งเวลาไว้', at(HOUR));
    await add('หมดแล้ว', at(-5 * HOUR), { expireAt: at(-HOUR) });
    await prisma.announcement.create({
      data: {
        marketId: otherMarketId,
        title: 'ตลาดอื่น',
        body: '-',
        publishAt: new Date(Date.now() - HOUR),
      },
    });

    const pending = await makeVendor({ status: 'PENDING' });
    const res = await http().get('/api/v1/announcements').set(pending.headers).expect(200);
    expect((res.body.data as Announcement[]).map((a) => a.title)).toEqual([
      'ปักหมุดเก่าสุด',
      'ใหม่',
      'เก่า',
    ]);
    // admin ใช้ endpoint ของผู้ค้าไม่ได้
    await http().get('/api/v1/announcements').set(as(admin)).expect(403);
  });

  it('ส่ง LINE: ครั้งเดียวเมื่อถึงเวลาเผยแพร่ ถึงผู้ค้าที่อนุมัติแล้วและเชื่อม LINE เท่านั้น', async () => {
    const reminders = app.get(NotificationReminders);
    const withLine = [await makeVendor({ line: true }), await makeVendor({ line: true })];
    await makeVendor(); // ไม่มี LINE → ไม่ส่ง SMS แทน
    await makeVendor({ line: true, status: 'PENDING' });
    await makeVendor({ line: true, market: otherMarketId });

    const now = await create({
      title: 'เปลี่ยนเวลาเปิดตลาด',
      body: 'เปิด 15:00 น.\nปิด 22:00 น.',
      publishAt: at(-60_000),
      broadcastLine: true,
    }).expect(201);
    const later = await create({
      title: 'ล่วงหน้า',
      body: '-',
      publishAt: at(HOUR),
      broadcastLine: true,
    }).expect(201);
    await create({ title: 'ไม่ส่ง', body: '-', publishAt: at(-60_000) }).expect(201);

    // ยังไม่ตั้ง LINE OA → รอไว้ก่อน (ไม่ถือว่าส่งแล้ว)
    line.enabled = false;
    expect(await reminders.broadcastAnnouncements()).toBe(0);
    expect(
      (await prisma.announcement.findUniqueOrThrow({ where: { id: now.body.data.id } }))
        .broadcastedAt,
    ).toBeNull();

    line.enabled = true;
    expect(await reminders.broadcastAnnouncements()).toBe(2);
    const logs = await prisma.notificationLog.findMany({ where: { template: 'announcement' } });
    expect(logs.map((l) => l.vendorId).sort()).toEqual(withLine.map((v) => v.id).sort());
    expect(logs.every((l) => l.channel === 'LINE')).toBe(true);
    expect(logs[0]!.payload).toEqual({
      title: 'เปลี่ยนเวลาเปิดตลาด',
      body: 'เปิด 15:00 น.\nปิด 22:00 น.',
    });

    // tick ถัดไป: ไม่ส่งซ้ำ; ประกาศล่วงหน้าส่งเมื่อถึงเวลา
    expect(await reminders.broadcastAnnouncements()).toBe(0);
    expect(await reminders.broadcastAnnouncements(new Date(Date.now() + 2 * HOUR))).toBe(2);
    const list = await http().get('/api/v1/admin/announcements').set(as(admin)).expect(200);
    const byId = new Map((list.body.data as AdminAnnouncement[]).map((a) => [a.id, a]));
    expect(byId.get(now.body.data.id)!.broadcastedAt).not.toBeNull();
    expect(byId.get(later.body.data.id)!.broadcastedAt).not.toBeNull();
  });
});
