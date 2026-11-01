import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type {
  AuditLogEntry,
  Dashboard,
  OccupancyReport,
  RevenueReport,
  VendorReport,
} from '@market-booking/shared';
import ExcelJS from 'exceljs';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import type { PrismaClient } from '../../src/generated/prisma/client';
import type { AdminPrincipal } from '../../src/modules/auth/principal';
import { TokenService } from '../../src/modules/auth/token.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { setupApp } from '../../src/setup-app';
import { truncateAll } from './test-db';

const DAY = 86_400_000;

/**
 * ข้อมูลตายตัว (คำนวณคำตอบได้ด้วยมือ):
 * โซน A: A1 A2 A3 (+ A4 ปิดใช้งาน) · โซน B: B1 B2
 * รอบ R1: 2026-03-07 (A3 ปิดเฉพาะวัน), 2026-03-08 · รอบ R2: 2026-04-04 (+ 2026-04-05 ถูกยกเลิก)
 * ล็อคที่ใช้ได้: 03-07 = 4, 03-08 = 5, 04-04 = 5 → รวม 14
 */
describe('Reports + audit log (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let marketId: string;
  let admin: AdminPrincipal;
  let finance: AdminPrincipal;
  let staff: AdminPrincipal;
  const ids: Record<string, string> = {};
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    await truncateAll(prisma as unknown as PrismaClient);
    await seedFixture();
  });

  afterAll(async () => {
    await app.close();
  });

  const tokenOf = (p: AdminPrincipal) => app.get(TokenService).signAccessToken(p);
  const as = (p: AdminPrincipal) => ({ Authorization: `Bearer ${tokenOf(p)}` });
  const get = <T>(path: string, p: AdminPrincipal = admin) =>
    http()
      .get(`/api/v1${path}`)
      .set(as(p))
      .expect(200)
      .then((r) => r.body.data as T);

  async function seedFixture() {
    marketId = (await prisma.market.create({ data: { name: 'ตลาดรายงาน', address: '-' } })).id;
    const makeAdmin = async (username: string, role: AdminPrincipal['role']) => {
      const row = await prisma.adminUser.create({
        data: { username, passwordHash: 'x', displayName: `คุณ${username}`, role, marketId },
      });
      return { actorType: 'ADMIN', id: row.id, role, marketId } as AdminPrincipal;
    };
    admin = await makeAdmin('boss', 'ADMIN');
    finance = await makeAdmin('money', 'FINANCE');
    staff = await makeAdmin('helper', 'STAFF');

    for (const [i, name] of ['โซนเอ', 'โซนบี'].entries()) {
      ids[name] = (
        await prisma.zone.create({ data: { marketId, name, color: '#000000', sortOrder: i } })
      ).id;
    }
    const stall = async (code: string, zone: string, isActive = true) => {
      ids[code] = (
        await prisma.stall.create({
          data: {
            marketId,
            zoneId: ids[zone]!,
            code,
            widthM: 2,
            lengthM: 2,
            price: 100,
            shapeW: 60,
            shapeH: 60,
            isActive,
          },
        })
      ).id;
    };
    await stall('A1', 'โซนเอ');
    await stall('A2', 'โซนเอ');
    await stall('A3', 'โซนเอ');
    await stall('A4', 'โซนเอ', false);
    await stall('B1', 'โซนบี');
    await stall('B2', 'โซนบี');

    const round = async (name: string, openAt: Date, closeAt: Date) =>
      (
        await prisma.bookingRound.create({
          data: {
            marketId,
            name,
            openAt,
            closeAt,
            maxStallsPerVendor: 5,
            status: 'PUBLISHED',
            createdById: admin.id,
          },
        })
      ).id;
    // R2 ยังไม่ปิด (dashboard เลือกตัวนี้)
    ids.R1 = await round(
      'รอบมีนา',
      new Date('2026-02-20T03:00:00Z'),
      new Date('2026-03-05T03:00:00Z'),
    );
    ids.R2 = await round('รอบเมษา', new Date(Date.now() - DAY), new Date(Date.now() + 30 * DAY));
    const day = async (key: string, roundId: string, date: string, isCancelled = false) => {
      ids[key] = (
        await prisma.marketDay.create({
          data: { marketId, roundId, marketDate: new Date(`${date}T00:00:00Z`), isCancelled },
        })
      ).id;
    };
    await day('d1', ids.R1, '2026-03-07');
    await day('d2', ids.R1, '2026-03-08');
    await day('d3', ids.R2!, '2026-04-04');
    await day('d4', ids.R2!, '2026-04-05', true);
    await prisma.stallDayOverride.create({
      data: { stallId: ids.A3!, marketDayId: ids.d1!, isClosed: true },
    });

    const vendor = async (key: string, phone: string, noshowCount = 0) => {
      ids[key] = (
        await prisma.vendor.create({
          data: {
            marketId,
            firstName: 'ผู้ค้า',
            lastName: key,
            phone,
            address: '-',
            pdpaConsentAt: new Date(),
            status: 'APPROVED',
            noshowCount,
          },
        })
      ).id;
    };
    await vendor('ก', '0811111111');
    await vendor('ข', '0822222222');
    await vendor('ค', '0833333333', 2);
    await prisma.vendor.create({
      data: {
        marketId,
        firstName: 'รอ',
        lastName: 'ตรวจ',
        phone: '0844444444',
        address: '-',
        pdpaConsentAt: new Date(),
        status: 'PENDING',
      },
    });

    type Pay = { method: 'PROMPTPAY_SLIP' | 'CASH'; amount: number; status?: string };
    const booking = async (
      vendorKey: string,
      stallCode: string,
      dayKey: string,
      status: string,
      payments: Pay[] = [],
      extra: object = {},
    ) => {
      const b = await prisma.booking.create({
        data: {
          marketId,
          vendorId: ids[vendorKey]!,
          stallId: ids[stallCode]!,
          marketDayId: ids[dayKey]!,
          status: status as never,
          amount: 100,
          ...extra,
        },
      });
      for (const p of payments) {
        await prisma.payment.create({
          data: {
            bookingId: b.id,
            method: p.method,
            amount: p.amount,
            status: (p.status ?? 'APPROVED') as never,
          },
        });
      }
      return b.id;
    };
    // d1: A1 ก จ่ายพร้อมเพย์ 100 (มีสลิปไม่ผ่านก่อนหน้า 100 ไม่นับ), B1 ข เงินสด 80
    await booking('ก', 'A1', 'd1', 'CONFIRMED', [
      { method: 'PROMPTPAY_SLIP', amount: 100, status: 'REJECTED' },
      { method: 'PROMPTPAY_SLIP', amount: 100 },
    ]);
    await booking('ข', 'B1', 'd1', 'CONFIRMED', [{ method: 'CASH', amount: 80 }]);
    // d2: A1 ก ยืนยันแบบไม่ต้องชำระ, A2 ข รอตรวจ (สลิป PENDING), B2 ค หมดเวลาหลังรอชำระ, B1 ค ยกเลิก
    await booking('ก', 'A1', 'd2', 'CONFIRMED');
    await booking('ข', 'A2', 'd2', 'PENDING_VERIFY', [
      { method: 'PROMPTPAY_SLIP', amount: 100, status: 'PENDING' },
    ]);
    await booking('ค', 'B2', 'd2', 'EXPIRED', [], {
      paymentDueAt: new Date('2026-03-06T00:00:00Z'),
    });
    await booking('ค', 'B1', 'd2', 'CANCELLED');
    // hold ที่ทิ้งไว้จนหมดเวลา — ไม่นับเป็นยกเลิก
    await booking('ค', 'A3', 'd2', 'EXPIRED');
    // d3 (รอบ R2): B2 ก พร้อมเพย์ 120, A1 ข รอชำระ
    await booking('ก', 'B2', 'd3', 'CONFIRMED', [{ method: 'PROMPTPAY_SLIP', amount: 120 }]);
    await booking('ข', 'A1', 'd3', 'PENDING_PAYMENT');
    // วันที่ถูกยกเลิก — ไม่นับทุกรายงาน
    await booking('ก', 'A2', 'd4', 'CANCELLED', [{ method: 'CASH', amount: 999 }]);
  }

  const range = 'from=2026-03-01&to=2026-04-30';

  // ───────────── รายได้ ─────────────

  it('รายได้ตามวันขาย: เฉพาะยอดอนุมัติ, แยกพร้อมเพย์/เงินสด, วันยกเลิกไม่นับ', async () => {
    const r = await get<RevenueReport>(`/admin/reports/revenue?${range}&groupBy=day`);

    expect(r.rows).toEqual([
      {
        key: '2026-03-07',
        label: expect.stringContaining('7 มี.ค.'),
        bookings: 2,
        revenue: 180,
        promptpay: 100,
        cash: 80,
      },
      {
        key: '2026-04-04',
        label: expect.stringContaining('4 เม.ย.'),
        bookings: 1,
        revenue: 120,
        promptpay: 120,
        cash: 0,
      },
    ]);
    expect(r.total).toEqual({ bookings: 3, revenue: 300, promptpay: 220, cash: 80 });
  });

  it('รายได้ตามรอบ/โซน และกรองด้วยรอบ', async () => {
    const byRound = await get<RevenueReport>(`/admin/reports/revenue?${range}&groupBy=round`);
    expect(byRound.rows.map((r) => [r.label, r.revenue])).toEqual([
      ['รอบมีนา', 180],
      ['รอบเมษา', 120],
    ]);

    const byZone = await get<RevenueReport>(`/admin/reports/revenue?${range}&groupBy=zone`);
    expect(byZone.rows.map((r) => [r.label, r.revenue])).toEqual([
      ['โซนเอ', 100],
      ['โซนบี', 200],
    ]);

    const r2 = await get<RevenueReport>(`/admin/reports/revenue?${range}&roundId=${ids.R2}`);
    expect(r2.total.revenue).toBe(120);
  });

  // ───────────── การใช้ล็อค ─────────────

  it('การใช้ล็อคตามวัน: ไม่นับล็อคปิดใช้งาน/ปิดเฉพาะวัน, แยกจองสำเร็จกับรอชำระ', async () => {
    const r = await get<OccupancyReport>(`/admin/reports/occupancy?${range}&groupBy=day`);

    expect(
      r.rows.map(({ key, capacity, confirmed, pending, rate }) => ({
        key,
        capacity,
        confirmed,
        pending,
        rate,
      })),
    ).toEqual([
      { key: '2026-03-07', capacity: 4, confirmed: 2, pending: 0, rate: 0.5 },
      { key: '2026-03-08', capacity: 5, confirmed: 1, pending: 1, rate: 0.2 },
      { key: '2026-04-04', capacity: 5, confirmed: 1, pending: 1, rate: 0.2 },
    ]);
    expect(r.total).toEqual({ capacity: 14, confirmed: 4, pending: 2, rate: 0.2857 });
  });

  it('การใช้ล็อคตามโซน', async () => {
    const r = await get<OccupancyReport>(`/admin/reports/occupancy?${range}&groupBy=zone`);

    expect(r.rows.map((x) => [x.label, x.capacity, x.confirmed, x.pending])).toEqual([
      ['โซนเอ', 8, 2, 2],
      ['โซนบี', 6, 2, 0],
    ]);
  });

  // ───────────── ผู้ค้า ─────────────

  it('ผู้ค้า Top: จอง/ยกเลิก/รายได้/ไม่มาขาย และเรียงตามที่เลือก', async () => {
    const r = await get<VendorReport>(`/admin/reports/vendors?${range}&sort=bookings`);

    expect(r.phoneMasked).toBe(false);
    expect(
      r.rows.map((v) => [v.name, v.bookings, v.cancelled, v.revenue, v.noshowCount, v.phone]),
    ).toEqual([
      ['ผู้ค้า ก', 3, 0, 220, 0, '0811111111'],
      ['ผู้ค้า ข', 1, 0, 80, 0, '0822222222'],
      ['ผู้ค้า ค', 0, 2, 0, 2, '0833333333'],
    ]);

    const noshow = await get<VendorReport>(`/admin/reports/vendors?${range}&sort=noshow&limit=1`);
    expect(noshow.rows.map((v) => v.name)).toEqual(['ผู้ค้า ค']);
  });

  it('FINANCE เห็นเบอร์แบบปิดบางส่วน (ทั้งบนหน้าและไฟล์ export)', async () => {
    const r = await get<VendorReport>(`/admin/reports/vendors?${range}`, finance);
    expect(r.phoneMasked).toBe(true);
    expect(r.rows[0]!.phone).toBe('081-xxx-1111');

    const csv = await http()
      .get(`/api/v1/admin/reports/vendors?${range}&format=csv`)
      .set(as(finance))
      .expect(200);
    expect(csv.text).toContain('081-xxx-1111');
    expect(csv.text).not.toContain('0811111111');
  });

  // ───────────── export ─────────────

  it('export xlsx/csv พร้อมแถวรวม และลง audit log', async () => {
    const xlsx = await http()
      .get(`/api/v1/admin/reports/revenue?${range}&groupBy=zone&format=xlsx`)
      .set(as(admin))
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(xlsx.headers['content-disposition']).toBe(
      'attachment; filename="revenue-zone-2026-03-01_2026-04-30.xlsx"',
    );
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(xlsx.body as ArrayBuffer);
    const sheet = workbook.worksheets[0]!;
    expect(sheet.getRow(1).values).toEqual([
      undefined,
      'โซน',
      'การจองที่ชำระแล้ว',
      'พร้อมเพย์ (บาท)',
      'เงินสด (บาท)',
      'รายได้รวม (บาท)',
    ]);
    expect(sheet.getRow(4).values).toEqual([undefined, 'รวม', 3, 220, 80, 300]);

    const csv = await http()
      .get(`/api/v1/admin/reports/occupancy?${range}&format=csv`)
      .set(as(admin))
      .expect(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.text.charCodeAt(0)).toBe(0xfeff);
    expect(csv.text.split('\r\n')[0]).toBe(
      '﻿วันขาย,ล็อคที่ใช้ได้,จองสำเร็จ,รอชำระ/ตรวจ,อัตราการจอง',
    );

    const log = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'report.export', actorId: admin.id },
      orderBy: { createdAt: 'desc' },
    });
    expect(log.after).toMatchObject({ report: 'occupancy', format: 'csv', rows: 3 });
  });

  it('ช่วงวันที่ผิด → 400', async () => {
    await http()
      .get('/api/v1/admin/reports/revenue?from=2026-05-01&to=2026-04-01')
      .set(as(admin))
      .expect(400);
    await http()
      .get('/api/v1/admin/reports/revenue?from=2024-01-01&to=2026-01-01')
      .set(as(admin))
      .expect(400);
  });

  // ───────────── dashboard ─────────────

  it('dashboard: ผู้ค้ารออนุมัติ, สลิปรอตรวจ, รอบปัจจุบัน (อัตราการจอง + รายได้)', async () => {
    const d = await get<Dashboard>('/admin/reports/dashboard', staff);

    expect(d).toEqual({
      pendingVendors: 1,
      pendingPayments: 1,
      round: expect.objectContaining({
        id: ids.R2,
        name: 'รอบเมษา',
        phase: 'OPEN',
        marketDays: 1,
        capacity: 5,
        confirmed: 1,
        pending: 1,
        occupancyRate: 0.2,
        revenue: 120,
        revenuePending: 100,
      }),
    });
  });

  // ───────────── audit log ─────────────

  describe('GET /admin/audit-logs', () => {
    beforeAll(async () => {
      await prisma.auditLog.createMany({
        data: [
          {
            actorType: 'ADMIN',
            actorId: admin.id,
            action: 'vendor.approve',
            entityType: 'vendor',
            entityId: ids['ก'],
            createdAt: new Date('2026-03-01T03:00:00Z'),
          },
          {
            actorType: 'ADMIN',
            actorId: admin.id,
            action: 'vendor.reject',
            entityType: 'vendor',
            entityId: ids['ข'],
            createdAt: new Date('2026-03-02T17:30:00Z'),
          },
          {
            actorType: 'VENDOR',
            actorId: ids['ก'],
            action: 'payment.submit',
            entityType: 'payment',
            createdAt: new Date('2026-03-03T03:00:00Z'),
          },
          {
            actorType: 'SYSTEM',
            action: 'booking.expire',
            entityType: 'booking',
            createdAt: new Date('2026-03-04T03:00:00Z'),
          },
        ],
      });
    });

    const list = (query: string, p: AdminPrincipal = admin) =>
      http()
        .get(`/api/v1/admin/audit-logs?${query}`)
        .set(as(p))
        .expect(200)
        .then((r) => r.body as { data: AuditLogEntry[]; meta: { total: number } });

    it('ใหม่สุดก่อน พร้อมชื่อผู้กระทำ; กรอง action ทั้งกลุ่มด้วย "."', async () => {
      const res = await list('action=vendor.');
      expect(res.data.map((e) => [e.action, e.actorName])).toEqual([
        ['vendor.reject', 'คุณboss (boss)'],
        ['vendor.approve', 'คุณboss (boss)'],
      ]);

      const vendorActs = await list('actorType=VENDOR');
      expect(vendorActs.data).toEqual([
        expect.objectContaining({ action: 'payment.submit', actorName: 'ผู้ค้า ก' }),
      ]);
      const system = await list('actorType=SYSTEM&action=booking.expire');
      expect(system.data[0]).toMatchObject({ actorId: null, actorName: null });
    });

    it('กรองวันที่ตามเวลาไทย และแบ่งหน้า', async () => {
      // 2026-03-02T17:30Z = 3 มี.ค. 00:30 เวลาไทย (วันที่ UTC ยังเป็น 2 มี.ค.)
      const res = await list('from=2026-03-03&to=2026-03-03&actorType=ADMIN');
      expect(res.data.map((e) => e.action)).toEqual(['vendor.reject']);

      const page = await list('actorType=ADMIN&action=vendor.&pageSize=1&page=2');
      expect(page.meta.total).toBe(2);
      expect(page.data.map((e) => e.action)).toEqual(['vendor.approve']);
    });

    it('รายการ action สำหรับ filter; STAFF/FINANCE เปิดไม่ได้', async () => {
      const actions = await get<string[]>('/admin/audit-logs/actions');
      expect(actions).toEqual(
        expect.arrayContaining(['booking.expire', 'vendor.approve', 'report.export']),
      );
      expect([...actions]).toEqual([...actions].sort());

      await http().get('/api/v1/admin/audit-logs').set(as(staff)).expect(403);
      await http().get('/api/v1/admin/audit-logs').set(as(finance)).expect(403);
    });
  });
});
