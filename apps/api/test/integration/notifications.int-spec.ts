import { createHmac } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Booking } from '@market-booking/shared';
import type { Job } from 'bullmq';
import type Redis from 'ioredis';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { zonedDate } from '../../src/common/zoned-date';
import type { PrismaClient } from '../../src/generated/prisma/client';
import type { AdminPrincipal } from '../../src/modules/auth/principal';
import { TokenService } from '../../src/modules/auth/token.service';
import { BookingEvents } from '../../src/modules/booking/booking-events';
import { DeliveryError } from '../../src/modules/notify/delivery-error';
import { LineMessagingProvider } from '../../src/modules/notify/line/line-messaging.provider';
import { NotificationReminders } from '../../src/modules/notify/notification-reminders';
import {
  NotificationQueue,
  SEND_ATTEMPTS,
  type SendJobData,
} from '../../src/modules/notify/notification.queue';
import { NotificationService, STALE_AFTER_MS } from '../../src/modules/notify/notification.service';
import { NotifyService } from '../../src/modules/notify/notify.service';
import { MockSmsProvider } from '../../src/modules/notify/sms/mock-sms.provider';
import { PrismaService } from '../../src/prisma/prisma.service';
import { REDIS } from '../../src/redis/redis.module';
import { setupApp } from '../../src/setup-app';
import { truncateAll } from './test-db';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const GROUP_ID = `C${'0a'.repeat(16)}`;
const LINE_SECRET = 'test-line-channel-secret';

describe('Notifications: queue + LINE/SMS + reminders (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let sms: MockSmsProvider;
  let notifications: NotificationService;
  let marketId: string;
  let admin: AdminPrincipal;
  let zoneId: string;
  let roundId: string;
  let marketDayId: string;
  let seq = 0;
  /** LINE OA ปลอม — เปิดใช้อยู่ (มี token) แต่ไม่ยิงออก internet */
  const line = { enabled: true, push: jest.fn(), reply: jest.fn() };
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(LineMessagingProvider)
      .useValue(line)
      .compile();
    // rawBody: ตรวจลายเซ็น webhook ของ LINE (main.ts ตั้งเหมือนกัน)
    app = moduleRef.createNestApplication({ rawBody: true });
    setupApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    sms = app.get(MockSmsProvider);
    notifications = app.get(NotificationService);
    await truncateAll(prisma as unknown as PrismaClient);

    marketId = (await prisma.market.create({ data: { name: 'ตลาดหลัก', address: '-' } })).id;
    const adminRow = await prisma.adminUser.create({
      data: {
        username: 'admin',
        passwordHash: 'x',
        displayName: 'แอดมิน',
        role: 'ADMIN',
        marketId,
      },
    });
    admin = { actorType: 'ADMIN', id: adminRow.id, role: 'ADMIN', marketId };
    zoneId = (
      await prisma.zone.create({
        data: { marketId, name: 'ทั่วไป', color: '#3B82F6', sortOrder: 0 },
      })
    ).id;
    roundId = (
      await prisma.bookingRound.create({
        data: {
          marketId,
          name: 'รอบเปิด',
          openAt: new Date(Date.now() - HOUR),
          closeAt: new Date(Date.now() + DAY),
          maxStallsPerVendor: 10,
          status: 'PUBLISHED',
          createdById: admin.id,
        },
      })
    ).id;
    const date = zonedDate(new Date(Date.now() + 5 * DAY), 'Asia/Bangkok');
    marketDayId = (
      await prisma.marketDay.create({
        data: { marketId, roundId, marketDate: new Date(`${date}T00:00:00Z`) },
      })
    ).id;
    await http()
      .put('/api/v1/admin/settings')
      .set(asAdmin())
      .send({ payment_required: true, line_admin_group_id: GROUP_ID })
      .expect(200);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    jest.restoreAllMocks();
    line.push.mockReset().mockResolvedValue(undefined);
    line.reply.mockReset().mockResolvedValue(undefined);
    sms.sent.length = 0;
    await prisma.notificationLog.deleteMany();
  });

  // ───────────── helpers ─────────────

  const tokenOf = (p: Parameters<TokenService['signAccessToken']>[0]) =>
    app.get(TokenService).signAccessToken(p);
  const asAdmin = () => ({ Authorization: `Bearer ${tokenOf(admin)}` });

  async function makeVendor(
    opts: { line?: boolean; status?: 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUSPENDED' } = {},
  ) {
    const n = ++seq;
    const row = await prisma.vendor.create({
      data: {
        marketId,
        firstName: 'ผู้ค้า',
        lastName: `ที่${n}`,
        phone: `08${String(70000000 + n).slice(-8)}`,
        address: '-',
        pdpaConsentAt: new Date(),
        status: opts.status ?? 'APPROVED',
        lineUserId: opts.line ? `U${n.toString(16).padStart(32, '0')}` : null,
      },
    });
    const token = tokenOf({ actorType: 'VENDOR', id: row.id, marketId });
    return { ...row, headers: { Authorization: `Bearer ${token}` } };
  }
  type Vendor = Awaited<ReturnType<typeof makeVendor>>;

  async function makeStall() {
    return (
      await prisma.stall.create({
        data: {
          marketId,
          zoneId,
          code: `N${++seq}`,
          widthM: 2,
          lengthM: 2,
          price: 150,
          posX: 0,
          posY: 0,
          shapeW: 60,
          shapeH: 60,
        },
      })
    ).id;
  }

  async function pendingPayment(vendor: Vendor): Promise<Booking> {
    const hold = await http()
      .post('/api/v1/bookings/hold')
      .set(vendor.headers)
      .send({ stallId: await makeStall(), marketDayId })
      .expect(201);
    const res = await http()
      .post(`/api/v1/bookings/${hold.body.data.id}/confirm`)
      .set(vendor.headers)
      .expect(200);
    return res.body.data;
  }

  const job = (logId: string, attemptsMade = 0) =>
    ({ data: { logId }, attemptsMade, opts: { attempts: SEND_ATTEMPTS } }) as Job<SendJobData>;

  const logsOf = (template: string) =>
    prisma.notificationLog.findMany({ where: { template }, orderBy: { createdAt: 'asc' } });

  /** listener ของ booking event ทำงานแบบ async — รอจนมี log */
  async function waitForLogs(template: string, count = 1) {
    for (let i = 0; i < 50; i++) {
      const rows = await logsOf(template);
      if (rows.length >= count) return rows;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`No ${template} notification`);
  }

  // ───────────── queue + log ─────────────

  it('อนุมัติผู้ค้า (ไม่มี LINE) → log PENDING + job ใน queue → worker ส่ง SMS แล้วเป็น SENT', async () => {
    const vendor = await makeVendor({ status: 'PENDING' });
    await http().post(`/api/v1/admin/vendors/${vendor.id}/approve`).set(asAdmin()).expect(200);

    const [log] = await logsOf('vendor.approved');
    expect(log).toMatchObject({
      channel: 'SMS',
      recipient: vendor.phone,
      status: 'PENDING',
      vendorId: vendor.id,
      attempts: 0,
    });
    const queued = await app.get(NotificationQueue).getQueue().getJob(log!.id);
    expect(await queued?.getState()).toBe('waiting');

    await expect(notifications.deliver(job(log!.id))).resolves.toBe('sent');

    expect(await prisma.notificationLog.findUnique({ where: { id: log!.id } })).toMatchObject({
      status: 'SENT',
      attempts: 1,
      error: null,
      sentAt: expect.any(Date),
    });
    expect(sms.lastTo(vendor.phone)?.text).toMatch(/^บัญชีผู้ค้าได้รับการอนุมัติแล้ว .*http/);
    // ส่งซ้ำ (job ซ้ำ) ไม่ส่งอีก
    await expect(notifications.deliver(job(log!.id))).resolves.toBe('skipped');
    expect(sms.sent).toHaveLength(1);
  });

  it('AC: ผู้ให้บริการล่ม → flow หลักสำเร็จ, ส่งใหม่ภายหลังจนสำเร็จ และมี log ทุกครั้ง', async () => {
    const vendor = await makeVendor({ status: 'PENDING' });
    jest.spyOn(sms, 'send').mockRejectedValueOnce(new DeliveryError('SMS provider down', true));

    // ไม่ผ่านการอนุมัติ — ไม่ได้รอการส่ง SMS
    await http()
      .post(`/api/v1/admin/vendors/${vendor.id}/reject`)
      .set(asAdmin())
      .send({ reason: 'รูปบัตรไม่ชัด' })
      .expect(200);
    const [log] = await logsOf('vendor.rejected');
    expect(log!.payload).toEqual({ reason: 'รูปบัตรไม่ชัด' });

    // ครั้งแรกล่ม → throw ให้ BullMQ ลองใหม่ (backoff) และจด error
    await expect(notifications.deliver(job(log!.id, 0))).rejects.toThrow('SMS provider down');
    expect(await prisma.notificationLog.findUnique({ where: { id: log!.id } })).toMatchObject({
      status: 'RETRYING',
      attempts: 1,
      error: 'SMS provider down',
    });

    await expect(notifications.deliver(job(log!.id, 1))).resolves.toBe('sent');
    expect(await prisma.notificationLog.findUnique({ where: { id: log!.id } })).toMatchObject({
      status: 'SENT',
      attempts: 2,
      error: null,
    });
    expect(sms.lastTo(vendor.phone)?.text).toContain('ใบสมัครผู้ค้ายังไม่ผ่าน');
  });

  it('AC: Redis/queue ใช้ไม่ได้ตอนใส่ job → flow หลักสำเร็จ, log ค้าง PENDING แล้วถูกใส่ queue ใหม่ภายหลัง', async () => {
    const queue = app.get(NotificationQueue);
    jest.spyOn(queue, 'enqueueSend').mockRejectedValueOnce(new Error('Redis down'));
    const vendor = await makeVendor({ status: 'PENDING' });

    await http().post(`/api/v1/admin/vendors/${vendor.id}/approve`).set(asAdmin()).expect(200);
    const [log] = await logsOf('vendor.approved');
    expect(log!.status).toBe('PENDING');
    expect(await queue.getQueue().getJob(log!.id)).toBeUndefined();

    // ยังไม่ถึงเวลา stale → ไม่ยุ่ง; เลยแล้ว → ใส่ job ใหม่
    expect(await notifications.recoverStale(new Date())).toBe(0);
    expect(await notifications.recoverStale(new Date(Date.now() + STALE_AFTER_MS + MINUTE))).toBe(
      1,
    );
    expect(await (await queue.getQueue().getJob(log!.id))?.getState()).toBe('waiting');
  });

  it('ส่งไม่ผ่านแบบถาวร หรือชั่วคราวจนครบรอบ → FAILED (ไม่ throw ให้ลองต่อ)', async () => {
    const a = await makeVendor({ status: 'PENDING' });
    const b = await makeVendor({ status: 'PENDING' });
    await http().post(`/api/v1/admin/vendors/${a.id}/approve`).set(asAdmin()).expect(200);
    await http().post(`/api/v1/admin/vendors/${b.id}/approve`).set(asAdmin()).expect(200);
    const [logA, logB] = await logsOf('vendor.approved');

    jest.spyOn(sms, 'send').mockRejectedValueOnce(new DeliveryError('invalid number', false));
    await expect(notifications.deliver(job(logA!.id))).resolves.toBe('failed: invalid number');

    jest.spyOn(sms, 'send').mockRejectedValueOnce(new DeliveryError('still down', true));
    await expect(notifications.deliver(job(logB!.id, SEND_ATTEMPTS - 1))).resolves.toBe(
      'failed: still down',
    );

    const rows = await prisma.notificationLog.findMany({
      where: { id: { in: [logA!.id, logB!.id] } },
    });
    expect(rows.map((r) => r.status)).toEqual(['FAILED', 'FAILED']);
  });

  // ───────────── LINE ─────────────

  it('ผู้ค้าที่ผูก LINE → push Flex (retry key = id ของ log); LINE ปฏิเสธถาวร → ส่ง SMS แทน', async () => {
    const vendor = await makeVendor({ line: true });
    const until = new Date(Date.now() + 7 * DAY).toISOString();
    await http()
      .post(`/api/v1/admin/vendors/${vendor.id}/suspend`)
      .set(asAdmin())
      .send({ until, reason: 'ไม่มาขาย 3 ครั้ง' })
      .expect(200);

    const [log] = await logsOf('vendor.suspended');
    expect(log).toMatchObject({ channel: 'LINE', recipient: vendor.lineUserId });
    await expect(notifications.deliver(job(log!.id))).resolves.toBe('sent');
    expect(line.push).toHaveBeenCalledWith(
      vendor.lineUserId,
      [
        expect.objectContaining({
          type: 'flex',
          altText: 'บัญชีผู้ค้าถูกระงับสิทธิ์การจอง',
        }),
      ],
      log!.id,
    );
    expect(JSON.stringify(line.push.mock.calls[0]![1])).toContain('เหตุผล: ไม่มาขาย 3 ครั้ง');

    // ผู้ค้ายังไม่เพิ่ม LINE OA เป็นเพื่อน (LINE ตอบ 400) → FAILED แล้วส่ง SMS แทน
    const other = await makeVendor({ line: true, status: 'PENDING' });
    await http().post(`/api/v1/admin/vendors/${other.id}/approve`).set(asAdmin()).expect(200);
    const [lineLog] = await logsOf('vendor.approved');
    line.push.mockRejectedValueOnce(
      new DeliveryError('LINE rejected the message: HTTP 400', false),
    );
    await notifications.deliver(job(lineLog!.id));

    const fallback = await prisma.notificationLog.findUniqueOrThrow({
      where: { dedupeKey: `${lineLog!.id}:sms` },
    });
    expect(fallback).toMatchObject({ channel: 'SMS', recipient: other.phone, status: 'PENDING' });
    await notifications.deliver(job(fallback.id));
    expect(sms.lastTo(other.phone)?.text).toContain('อนุมัติแล้ว');
  });

  // ───────────── การจอง / การชำระ ─────────────

  it('จองสำเร็จแจ้งครั้งเดียวแม้ event ซ้ำ; เจ้าหน้าที่ยกเลิก → แจ้งพร้อมเหตุผล; ผู้ค้ายกเลิกเอง → ไม่แจ้ง', async () => {
    const vendor = await makeVendor();
    const booking = await pendingPayment(vendor);
    await http()
      .post('/api/v1/admin/payments/cash')
      .set(asAdmin())
      .send({ bookingId: booking.id })
      .expect(201);

    const [confirmed] = await waitForLogs('booking.confirmed');
    expect(confirmed).toMatchObject({
      vendorId: vendor.id,
      dedupeKey: `booking.confirmed:${booking.id}`,
      payload: { stallCode: booking.stall.code, marketDate: booking.marketDay.marketDate },
    });
    // event เดิมซ้ำ (เช่น ส่งซ้ำหลัง reconnect) → ไม่มีข้อความที่สอง
    const row = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    app.get(BookingEvents).emitChanged([
      {
        bookingId: row.id,
        marketId,
        marketDayId,
        stallId: row.stallId,
        vendorId: vendor.id,
        status: 'CONFIRMED',
        holdExpiresAt: null,
        paymentDueAt: null,
      },
    ]);
    await new Promise((r) => setTimeout(r, 200));
    expect(await logsOf('booking.confirmed')).toHaveLength(1);

    await http()
      .post(`/api/v1/admin/bookings/${booking.id}/cancel`)
      .set(asAdmin())
      .send({ reason: 'ใช้พื้นที่จัดเวที' })
      .expect(200);
    const [cancelled] = await waitForLogs('booking.cancelled');
    expect(cancelled!.payload).toMatchObject({ reason: 'ใช้พื้นที่จัดเวที' });

    const own = await pendingPayment(vendor);
    await http().post(`/api/v1/bookings/${own.id}/cancel`).set(vendor.headers).expect(200);
    await new Promise((r) => setTimeout(r, 200));
    expect(await logsOf('booking.cancelled')).toHaveLength(1);
  });

  it('สลิปใหม่ → กลุ่ม LINE เจ้าหน้าที่; สลิปไม่ผ่าน → แจ้งผู้ค้าพร้อมเหตุผลและกำหนดส่งใหม่', async () => {
    const vendor = await makeVendor();
    const booking = await pendingPayment(vendor);
    // สถานะ "ส่งสลิปแล้ว" โดยไม่ต้องอัปโหลดรูปจริง (flow อัปโหลดทดสอบใน payments.int-spec)
    await prisma.booking.update({
      where: { id: booking.id },
      data: { status: 'PENDING_VERIFY' },
    });
    const payment = await prisma.payment.create({
      data: { bookingId: booking.id, method: 'PROMPTPAY', amount: 150, slipImageKey: 'k' },
    });

    await app
      .get(NotifyService)
      .paymentSubmitted({ paymentId: payment.id, bookingId: booking.id, marketId });
    const [group] = await logsOf('admin.payment_submitted');
    expect(group).toMatchObject({ channel: 'LINE', recipient: GROUP_ID, vendorId: null });
    expect(group!.payload).toMatchObject({ vendorName: `${vendor.firstName} ${vendor.lastName}` });

    await http()
      .post(`/api/v1/admin/payments/${payment.id}/reject`)
      .set(asAdmin())
      .send({ reason: 'ยอดเงินไม่ตรง' })
      .expect(200);
    const [rejected] = await logsOf('payment.rejected');
    const after = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(rejected).toMatchObject({
      vendorId: vendor.id,
      dedupeKey: `payment.rejected:${payment.id}`,
    });
    expect(rejected!.payload).toEqual({
      bookingId: booking.id,
      stallCode: booking.stall.code,
      reason: 'ยอดเงินไม่ตรง',
      dueAt: after.paymentDueAt!.toISOString(),
    });
  });

  it('สมัครใหม่แบบต้องตรวจ → กลุ่มเจ้าหน้าที่; ไม่ได้ตั้งกลุ่ม → ไม่ส่ง', async () => {
    const vendor = await makeVendor({ status: 'PENDING' });
    const notify = app.get(NotifyService);
    await notify.vendorStatusChanged({ vendorId: vendor.id, marketId, from: null, to: 'PENDING' });
    expect(await logsOf('admin.vendor_registered')).toEqual([
      expect.objectContaining({ recipient: GROUP_ID, payload: { vendorName: 'ผู้ค้า ที่' + seq } }),
    ]);

    await http().put('/api/v1/admin/settings').set(asAdmin()).send({ line_admin_group_id: null });
    try {
      await notify.vendorStatusChanged({
        vendorId: vendor.id,
        marketId,
        from: null,
        to: 'PENDING',
      });
      expect(await logsOf('admin.vendor_registered')).toHaveLength(1);
    } finally {
      await http()
        .put('/api/v1/admin/settings')
        .set(asAdmin())
        .send({ line_admin_group_id: GROUP_ID })
        .expect(200);
    }
  });

  // ───────────── งานตามเวลา ─────────────

  it('แจ้งผู้ค้าที่อนุมัติแล้วก่อนรอบเปิด (ตาม notify_before_round_open_minutes) ครั้งเดียว', async () => {
    const reminders = app.get(NotificationReminders);
    const redis = app.get<Redis>(REDIS);
    await makeVendor({ status: 'PENDING' });
    const now = new Date();
    const soon = await prisma.bookingRound.create({
      data: {
        marketId,
        name: 'รอบธันวา',
        openAt: new Date(now.getTime() + 30 * MINUTE),
        closeAt: new Date(now.getTime() + DAY),
        maxStallsPerVendor: 1,
        status: 'PUBLISHED',
        createdById: admin.id,
      },
    });
    // ยังไม่ถึงเวลาแจ้ง (เปิดอีก 2 ชั่วโมง, แจ้งก่อน 60 นาที) และรอบร่าง → ไม่แจ้ง
    for (const [status, openIn] of [
      ['PUBLISHED', 2 * HOUR],
      ['DRAFT', 30 * MINUTE],
    ] as const) {
      await prisma.bookingRound.create({
        data: {
          marketId,
          name: `ไม่แจ้ง ${status}`,
          openAt: new Date(now.getTime() + openIn),
          closeAt: new Date(now.getTime() + DAY),
          maxStallsPerVendor: 1,
          status,
          createdById: admin.id,
        },
      });
    }
    const approved = await prisma.vendor.count({ where: { marketId, status: 'APPROVED' } });

    expect(await reminders.remindRoundOpening(now)).toBe(approved);
    const logs = await logsOf('round.opening_soon');
    expect(logs).toHaveLength(approved);
    expect(logs[0]!.payload).toEqual({ roundName: 'รอบธันวา', openAt: soon.openAt.toISOString() });

    // นาทีถัดไป: ส่งครบแล้ว; แม้ key ใน Redis หาย dedupeKey ก็กันซ้ำ
    expect(await reminders.remindRoundOpening(new Date(now.getTime() + MINUTE))).toBe(0);
    await redis.del(`notify:round-open:${soon.id}:${soon.openAt.getTime()}`);
    expect(await reminders.remindRoundOpening(new Date(now.getTime() + 2 * MINUTE))).toBe(0);
    await prisma.bookingRound.updateMany({
      where: { marketId, id: { not: roundId } },
      data: { status: 'CANCELLED' },
    });
  });

  it('เตือนก่อนหมดเวลาชำระครั้งเดียวต่อกำหนดชำระ (กำหนดใหม่หลังสลิปไม่ผ่าน = เตือนใหม่)', async () => {
    const reminders = app.get(NotificationReminders);
    const vendor = await makeVendor();
    const booking = await pendingPayment(vendor);
    const now = new Date();
    // กำหนดชำระอีก 2 ชั่วโมง > เตือนก่อน 60 นาที → ยังไม่เตือน
    expect(await reminders.remindPaymentDue(now)).toBe(0);

    const due = new Date(now.getTime() + 30 * MINUTE);
    await prisma.booking.update({ where: { id: booking.id }, data: { paymentDueAt: due } });
    expect(await reminders.remindPaymentDue(now)).toBe(1);
    expect(await reminders.remindPaymentDue(new Date(now.getTime() + MINUTE))).toBe(0);
    const [log] = await logsOf('payment.due_soon');
    expect(log!.payload).toEqual({
      bookingId: booking.id,
      stallCode: booking.stall.code,
      marketDate: booking.marketDay.marketDate,
      amount: 150,
      dueAt: due.toISOString(),
    });

    await prisma.booking.update({
      where: { id: booking.id },
      data: { paymentDueAt: new Date(now.getTime() + 40 * MINUTE) },
    });
    expect(await reminders.remindPaymentDue(now)).toBe(1);
  });

  it('tick: งานหนึ่งพังไม่ทำให้งานอื่นไม่ทำ', async () => {
    const reminders = app.get(NotificationReminders);
    jest.spyOn(reminders, 'remindRoundOpening').mockRejectedValueOnce(new Error('db hiccup'));

    await expect(reminders.tick()).resolves.toMatch(/^rounds -1, payments \d+, recovered \d+$/);
  });

  // ───────────── webhook ของ LINE OA ─────────────

  describe('POST /line/webhook', () => {
    const send = (body: unknown, secret = LINE_SECRET) => {
      const raw = JSON.stringify(body);
      return http()
        .post('/api/v1/line/webhook')
        .set('Content-Type', 'application/json')
        .set('x-line-signature', createHmac('sha256', secret).update(raw).digest('base64'))
        .send(raw);
    };
    const groupEvent = (extra: object) => ({
      replyToken: 'reply-token',
      source: { type: 'group', groupId: GROUP_ID },
      ...extra,
    });

    it('บอทถูกเชิญเข้ากลุ่ม หรือมีคนพิมพ์ "group id" → ตอบ group ID', async () => {
      await send({ events: [groupEvent({ type: 'join' })] }).expect(200);
      await send({
        events: [groupEvent({ type: 'message', message: { type: 'text', text: ' Group ID ' } })],
      }).expect(200);
      await send({
        events: [groupEvent({ type: 'message', message: { type: 'text', text: 'สวัสดี' } })],
      }).expect(200);

      expect(line.reply).toHaveBeenCalledTimes(2);
      expect(line.reply).toHaveBeenCalledWith('reply-token', [
        { type: 'text', text: expect.stringContaining(GROUP_ID) },
      ]);
    });

    it('ลายเซ็นไม่ถูกต้อง → 401 ไม่ทำอะไร; การทดสอบ webhook ของ Console (events ว่าง) → 200', async () => {
      await send({ events: [groupEvent({ type: 'join' })] }, 'wrong-secret').expect(401);
      await http()
        .post('/api/v1/line/webhook')
        .send({ events: [groupEvent({ type: 'join' })] })
        .expect(401);
      await send({ destination: 'U0', events: [] }).expect(200);
      expect(line.reply).not.toHaveBeenCalled();
    });
  });

  // ท้ายไฟล์: worker เปิด job ประจำ (tick) ด้วย — ไม่ให้ไปรบกวน test อื่น
  it('worker จริง (BullMQ): อนุมัติผู้ค้า → ข้อความถูกส่งจาก queue เป็น SENT เอง', async () => {
    await app.get(NotificationQueue).start();
    const vendor = await makeVendor({ status: 'PENDING', line: true });
    await http().post(`/api/v1/admin/vendors/${vendor.id}/approve`).set(asAdmin()).expect(200);

    let status = '';
    for (let i = 0; i < 100 && status !== 'SENT'; i++) {
      await new Promise((r) => setTimeout(r, 50));
      status = (await logsOf('vendor.approved'))[0]?.status ?? '';
    }
    expect(status).toBe('SENT');
    expect(line.push).toHaveBeenCalledWith(
      vendor.lineUserId,
      expect.any(Array),
      expect.any(String),
    );
  });
});
