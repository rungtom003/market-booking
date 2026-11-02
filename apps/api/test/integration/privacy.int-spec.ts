import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ERASED_VENDOR_NAME, type VendorDataExport } from '@market-booking/shared';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { zonedDate } from '../../src/common/zoned-date';
import type { PrismaClient } from '../../src/generated/prisma/client';
import type { AdminPrincipal } from '../../src/modules/auth/principal';
import { RefreshTokenService } from '../../src/modules/auth/refresh-token.service';
import { TokenService } from '../../src/modules/auth/token.service';
import { RetentionService } from '../../src/modules/privacy/retention.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { setupApp } from '../../src/setup-app';
import { truncateAll } from './test-db';

const DAY = 24 * 3_600_000;
const bangkokDate = (offsetDays: number) =>
  zonedDate(new Date(Date.now() + offsetDays * DAY), 'Asia/Bangkok');

describe('PDPA: export / erase / retention (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let marketId: string;
  let admin: AdminPrincipal;
  let staff: AdminPrincipal;
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

    marketId = (await prisma.market.create({ data: { name: 'ตลาด PDPA', address: '-' } })).id;
    const makeAdmin = async (username: string, role: AdminPrincipal['role']) => {
      const row = await prisma.adminUser.create({
        data: { username, passwordHash: 'x', displayName: username, role, marketId },
      });
      return { actorType: 'ADMIN', id: row.id, role, marketId } as AdminPrincipal;
    };
    admin = await makeAdmin('pdpa-admin', 'ADMIN');
    staff = await makeAdmin('pdpa-staff', 'STAFF');
    roundId = (
      await prisma.bookingRound.create({
        data: {
          marketId,
          name: 'รอบ PDPA',
          openAt: new Date(Date.now() - 900 * DAY),
          closeAt: new Date(Date.now() - 899 * DAY),
          maxStallsPerVendor: 5,
          status: 'PUBLISHED',
          createdById: admin.id,
        },
      })
    ).id;
    zoneId = (await prisma.zone.create({ data: { marketId, name: 'โซน P', color: '#3B82F6' } })).id;
  });

  afterAll(async () => {
    await app.close();
  });

  const tokenOf = (p: Parameters<TokenService['signAccessToken']>[0]) =>
    app.get(TokenService).signAccessToken(p);
  const as = (p: AdminPrincipal) => ({ Authorization: `Bearer ${tokenOf(p)}` });

  async function makeVendor(data: { status?: 'APPROVED' | 'REJECTED' } = {}) {
    const n = ++seq;
    const phone = `08${String(90000000 + n).slice(-8)}`;
    const row = await prisma.vendor.create({
      data: {
        marketId,
        firstName: 'สมศรี',
        lastName: `ทดสอบ${n}`,
        phone,
        address: `${n} ถนนส่วนตัว`,
        shopName: 'ร้านส่วนตัว',
        lineUserId: `U${n.toString(16).padStart(32, '0')}`,
        idCardImageKey: `vendors/x/id-card-${n}.jpg`,
        pdpaConsentAt: new Date(),
        status: data.status ?? 'APPROVED',
      },
    });
    return {
      id: row.id,
      phone,
      headers: {
        Authorization: `Bearer ${tokenOf({ actorType: 'VENDOR', id: row.id, marketId })}`,
      },
    };
  }

  async function makeDay(offsetDays: number) {
    const date = bangkokDate(offsetDays);
    const existing = await prisma.marketDay.findFirst({
      where: { marketId, marketDate: new Date(`${date}T00:00:00Z`) },
    });
    if (existing) return existing.id;
    return (
      await prisma.marketDay.create({
        data: { marketId, roundId, marketDate: new Date(`${date}T00:00:00Z`) },
      })
    ).id;
  }

  async function book(vendorId: string, offsetDays: number, status: 'CONFIRMED' | 'CANCELLED') {
    const stall = await prisma.stall.create({
      data: {
        marketId,
        zoneId,
        code: `P${++seq}`,
        widthM: 2,
        lengthM: 2,
        price: 100,
        shapeW: 60,
        shapeH: 60,
      },
    });
    const booking = await prisma.booking.create({
      data: {
        marketId,
        vendorId,
        stallId: stall.id,
        marketDayId: await makeDay(offsetDays),
        status,
        amount: 120,
      },
    });
    const payment = await prisma.payment.create({
      data: {
        bookingId: booking.id,
        method: 'PROMPTPAY_SLIP',
        amount: 120,
        status: 'APPROVED',
        slipImageKey: `vendors/${vendorId}/slips/${booking.id}/s${seq}.jpg`,
      },
    });
    return { booking, payment, stall };
  }

  it('ผู้ค้าขอสำเนาข้อมูลของตัวเอง: โปรไฟล์ การจอง การชำระ คิว และประวัติแจ้งเตือน (ลง audit)', async () => {
    const v = await makeVendor();
    const { stall } = await book(v.id, -30, 'CONFIRMED');
    await prisma.notificationLog.create({
      data: {
        channel: 'SMS',
        recipient: v.phone,
        template: 'booking.confirmed',
        payload: {},
        status: 'SENT',
        dedupeKey: `pdpa-${v.id}`,
        vendorId: v.id,
      },
    });

    const res = await http().get('/api/v1/vendors/me/export').set(v.headers).expect(200);
    const data = res.body.data as VendorDataExport;
    expect(data.profile).toMatchObject({
      id: v.id,
      firstName: 'สมศรี',
      phone: v.phone,
      lineLinked: true,
      shopName: 'ร้านส่วนตัว',
    });
    expect(data.images.idCard).toMatch(/^https?:\/\//);
    expect(data.bookings).toHaveLength(1);
    expect(data.bookings[0]).toMatchObject({
      stallCode: stall.code,
      status: 'CONFIRMED',
      amount: 120,
      payments: [{ status: 'APPROVED', amount: 120, slipUrl: expect.stringMatching(/^http/) }],
    });
    expect(data.notifications).toEqual([
      expect.objectContaining({ channel: 'SMS', template: 'booking.confirmed' }),
    ]);
    expect(
      await prisma.auditLog.count({ where: { action: 'vendor.data_export', entityId: v.id } }),
    ).toBe(1);
  });

  it('ลบบัญชีตัวเอง: ยืนยันเบอร์ผิด 400; มีการจองที่ยังไม่ถึงวัน 409; ลบแล้วข้อมูลส่วนบุคคลหาย แต่ยอดการชำระยังอยู่', async () => {
    const v = await makeVendor();
    const past = await book(v.id, -10, 'CONFIRMED');
    const future = await book(v.id, 15, 'CONFIRMED');
    await prisma.notificationLog.create({
      data: {
        channel: 'LINE',
        recipient: 'U-secret',
        template: 'booking.confirmed',
        payload: { stallCode: 'X' },
        status: 'SENT',
        dedupeKey: `pdpa-erase-${v.id}`,
        vendorId: v.id,
      },
    });
    const refresh = await app.get(RefreshTokenService).issue({ type: 'VENDOR', id: v.id });

    const wrong = await http()
      .delete('/api/v1/vendors/me')
      .set(v.headers)
      .send({ confirmPhone: '0899999999' })
      .expect(400);
    expect(wrong.body.error.details).toEqual([expect.objectContaining({ path: 'confirmPhone' })]);
    const blocked = await http()
      .delete('/api/v1/vendors/me')
      .set(v.headers)
      .send({ confirmPhone: v.phone })
      .expect(409);
    expect(blocked.body.error).toMatchObject({
      code: 'ACCOUNT_HAS_ACTIVE_BOOKINGS',
      details: { count: 1 },
    });

    await prisma.booking.update({
      where: { id: future.booking.id },
      data: { status: 'CANCELLED' },
    });
    await http()
      .delete('/api/v1/vendors/me')
      .set(v.headers)
      .send({ confirmPhone: v.phone.replace(/^(\d{3})(\d{3})/, '$1-$2-') })
      .expect(204);

    const row = await prisma.vendor.findUniqueOrThrow({ where: { id: v.id } });
    expect(row).toMatchObject({
      firstName: ERASED_VENDOR_NAME,
      lastName: '',
      address: '-',
      shopName: null,
      lineUserId: null,
      idCardImageKey: null,
    });
    expect(row.phone).toMatch(/^del-[0-9a-f]{16}$/);
    expect(row.deletedAt).not.toBeNull();
    // เบอร์เดิมว่าง — สมัครใหม่ได้
    expect(
      await prisma.vendor.findUnique({ where: { marketId_phone: { marketId, phone: v.phone } } }),
    ).toBeNull();
    // ยอด/สถานะการชำระยังอยู่ แต่รูปสลิปถูกลบ
    expect(
      await prisma.payment.findUniqueOrThrow({ where: { id: past.payment.id } }),
    ).toMatchObject({ status: 'APPROVED', slipImageKey: null });
    expect(
      await prisma.notificationLog.findFirstOrThrow({ where: { vendorId: v.id } }),
    ).toMatchObject({ recipient: '-', payload: {} });
    // ออกจากระบบทุกเครื่อง + token เดิมใช้กับ endpoint ของผู้ค้าที่อนุมัติแล้วไม่ได้
    await expect(app.get(RefreshTokenService).rotate(refresh)).rejects.toBeDefined();
    await http().get('/api/v1/bookings/me').set(v.headers).expect(401);
    expect(
      await prisma.auditLog.findFirst({ where: { action: 'vendor.erase', entityId: v.id } }),
    ).toMatchObject({ actorType: 'VENDOR', actorId: v.id });
  });

  it('เจ้าหน้าที่ลบตามคำขอ (ต้องมีเหตุผล, STAFF ทำไม่ได้) → admin เห็นว่าลบแล้ว', async () => {
    const v = await makeVendor();
    const erase = (p: AdminPrincipal, body: object) =>
      http().post(`/api/v1/admin/vendors/${v.id}/erase`).set(as(p)).send(body);
    await erase(staff, { reason: 'โทรมาขอ' }).expect(403);
    await erase(admin, { reason: ' ' }).expect(400);
    await erase(admin, { reason: 'ผู้ค้าโทรมาขอลบข้อมูล 2 พ.ย.' }).expect(204);
    const detail = await http().get(`/api/v1/admin/vendors/${v.id}`).set(as(admin)).expect(200);
    expect(detail.body.data).toMatchObject({ firstName: ERASED_VENDOR_NAME });
    expect(detail.body.data.deletedAt).not.toBeNull();
    expect(
      await prisma.auditLog.findFirst({ where: { action: 'vendor.erase', entityId: v.id } }),
    ).toMatchObject({
      actorType: 'ADMIN',
      after: expect.objectContaining({ reason: expect.any(String) }),
    });
  });

  it('นโยบายเก็บข้อมูล: ลบประวัติแจ้งเตือนเก่า, รูปสลิปวันขายเกิน 1 ปี, ผู้ค้าที่ถูกปฏิเสธเกิน 180 วัน', async () => {
    const v = await makeVendor();
    const old = await book(v.id, -400, 'CONFIRMED');
    const recent = await book(v.id, -20, 'CONFIRMED');
    const log = (key: string, ageDays: number) =>
      prisma.notificationLog.create({
        data: {
          channel: 'SMS',
          recipient: v.phone,
          template: 'booking.confirmed',
          payload: {},
          status: 'SENT',
          dedupeKey: key,
          vendorId: v.id,
          createdAt: new Date(Date.now() - ageDays * DAY),
        },
      });
    const oldLog = await log(`ret-old-${v.id}`, 200);
    const newLog = await log(`ret-new-${v.id}`, 10);
    const rejected = await makeVendor({ status: 'REJECTED' });
    const fresh = await makeVendor({ status: 'REJECTED' });
    await prisma.$executeRaw`UPDATE vendors SET updated_at = now() - interval '200 days' WHERE id = ${rejected.id}::uuid`;

    const result = await app.get(RetentionService).sweep();
    expect(result.vendors).toBe(1);
    expect(result.slips).toBeGreaterThanOrEqual(1);
    expect(await prisma.notificationLog.findUnique({ where: { id: oldLog.id } })).toBeNull();
    expect(await prisma.notificationLog.findUnique({ where: { id: newLog.id } })).not.toBeNull();
    expect(
      (await prisma.payment.findUniqueOrThrow({ where: { id: old.payment.id } })).slipImageKey,
    ).toBeNull();
    expect(
      (await prisma.payment.findUniqueOrThrow({ where: { id: recent.payment.id } })).slipImageKey,
    ).not.toBeNull();
    expect(
      (await prisma.vendor.findUniqueOrThrow({ where: { id: rejected.id } })).deletedAt,
    ).not.toBeNull();
    expect(
      (await prisma.vendor.findUniqueOrThrow({ where: { id: fresh.id } })).deletedAt,
    ).toBeNull();
    expect(
      await prisma.auditLog.findFirst({ where: { action: 'vendor.erase', entityId: rejected.id } }),
    ).toMatchObject({ actorType: 'SYSTEM' });
  });
});
