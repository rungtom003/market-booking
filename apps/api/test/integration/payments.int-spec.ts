import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  promptPayPayload,
  type AdminPayment,
  type Booking,
  type BookingPaymentInfo,
  type UploadTicket,
} from '@market-booking/shared';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { zonedDate } from '../../src/common/zoned-date';
import type { PrismaClient } from '../../src/generated/prisma/client';
import type { AdminPrincipal } from '../../src/modules/auth/principal';
import { TokenService } from '../../src/modules/auth/token.service';
import { BookingExpiryProcessor } from '../../src/modules/booking/booking-expiry.processor';
import { NotifyService, type PaymentSubmittedEvent } from '../../src/modules/notify/notify.service';
import { SLIP_VERIFIER, type SlipVerifier } from '../../src/modules/payment/slip-verifier';
import { PrismaService } from '../../src/prisma/prisma.service';
import { setupApp } from '../../src/setup-app';
import { truncateAll } from './test-db';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]);
const PROMPTPAY_ID = '0812345678';

describe('Payments: PromptPay slip + review + cash (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let marketId: string;
  let otherMarketId: string;
  let admin: AdminPrincipal;
  let finance: AdminPrincipal;
  let staff: AdminPrincipal;
  let otherAdmin: AdminPrincipal;
  let zoneId: string;
  let marketDayId: string;
  let seq = 0;
  const submitted: PaymentSubmittedEvent[] = [];
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    app.get(NotifyService).onPaymentSubmitted((e) => {
      submitted.push(e);
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
        data: { username, passwordHash: 'x', displayName: `คุณ${username}`, role, marketId: mkt },
      });
      return { actorType: 'ADMIN', id: row.id, role, marketId: mkt };
    };
    admin = await makeAdmin('admin', 'ADMIN');
    finance = await makeAdmin('finance', 'FINANCE');
    staff = await makeAdmin('staff', 'STAFF');
    otherAdmin = await makeAdmin('other', 'ADMIN', otherMarketId);
    zoneId = (
      await prisma.zone.create({
        data: { marketId, name: 'ทั่วไป', color: '#3B82F6', sortOrder: 0 },
      })
    ).id;
    const round = await prisma.bookingRound.create({
      data: {
        marketId,
        name: 'รอบเปิด',
        openAt: new Date(Date.now() - HOUR),
        closeAt: new Date(Date.now() + DAY),
        maxStallsPerVendor: 5,
        status: 'PUBLISHED',
        createdById: admin.id,
      },
    });
    const date = zonedDate(new Date(Date.now() + 5 * DAY), 'Asia/Bangkok');
    marketDayId = (
      await prisma.marketDay.create({
        data: { marketId, roundId: round.id, marketDate: new Date(`${date}T00:00:00Z`) },
      })
    ).id;
    await http()
      .put('/api/v1/admin/settings')
      .set(asAdmin())
      .send({ promptpay_id: PROMPTPAY_ID, payment_required: true })
      .expect(200);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    submitted.length = 0;
  });

  // ───────────── helpers ─────────────

  const tokenOf = (p: Parameters<TokenService['signAccessToken']>[0]) =>
    app.get(TokenService).signAccessToken(p);
  function asAdmin(p: AdminPrincipal = admin) {
    return { Authorization: `Bearer ${tokenOf(p)}` };
  }

  async function makeVendor() {
    const phone = `08${String(80000000 + ++seq).slice(-8)}`;
    const row = await prisma.vendor.create({
      data: {
        marketId,
        firstName: 'ผู้ค้า',
        lastName: `ที่${seq}`,
        phone,
        address: '-',
        pdpaConsentAt: new Date(),
        status: 'APPROVED',
      },
    });
    const token = tokenOf({ actorType: 'VENDOR', id: row.id, marketId });
    return { id: row.id, phone, headers: { Authorization: `Bearer ${token}` } };
  }
  type Vendor = Awaited<ReturnType<typeof makeVendor>>;

  async function makeStall(price = 150) {
    return (
      await prisma.stall.create({
        data: {
          marketId,
          zoneId,
          code: `P${++seq}`,
          widthM: 2,
          lengthM: 2,
          price,
          posX: 0,
          posY: 0,
          shapeW: 60,
          shapeH: 60,
        },
      })
    ).id;
  }

  /** จอง + ยืนยัน → รอชำระ */
  async function pendingPayment(vendor: Vendor, price = 150): Promise<Booking> {
    const hold = await http()
      .post('/api/v1/bookings/hold')
      .set(vendor.headers)
      .send({ stallId: await makeStall(price), marketDayId })
      .expect(201);
    const res = await http()
      .post(`/api/v1/bookings/${hold.body.data.id}/confirm`)
      .set(vendor.headers)
      .expect(200);
    expect(res.body.data.status).toBe('PENDING_PAYMENT');
    return res.body.data;
  }

  /** ขอ URL แล้วอัปโหลดรูปสลิปจริงไป MinIO */
  async function uploadSlip(vendor: Vendor, bookingId: string, body: Buffer = JPEG) {
    const res = await http()
      .post(`/api/v1/bookings/${bookingId}/payments/slip-upload`)
      .set(vendor.headers)
      .send({ contentType: 'image/jpeg', size: body.length })
      .expect(201);
    const ticket = res.body.data as UploadTicket;
    const put = await fetch(ticket.url, { method: 'PUT', headers: ticket.headers, body });
    expect(put.ok).toBe(true);
    return ticket.key;
  }

  const submit = (vendor: Vendor, bookingId: string, slipImageKey: string) =>
    http()
      .post(`/api/v1/bookings/${bookingId}/payments`)
      .set(vendor.headers)
      .send({ slipImageKey });

  async function submitOk(vendor: Vendor, bookingId: string) {
    const res = await submit(vendor, bookingId, await uploadSlip(vendor, bookingId)).expect(201);
    return res.body.data as BookingPaymentInfo;
  }

  const bookingRow = (id: string) => prisma.booking.findUniqueOrThrow({ where: { id } });

  // ───────────── QR ─────────────

  it('GET /bookings/:id/payment: ยอด, กำหนดชำระ และ PromptPay payload ตามยอดของการจอง', async () => {
    const vendor = await makeVendor();
    const booking = await pendingPayment(vendor, 175.5);
    const res = await http()
      .get(`/api/v1/bookings/${booking.id}/payment`)
      .set(vendor.headers)
      .expect(200);
    expect(res.body.data).toEqual({
      bookingId: booking.id,
      bookingStatus: 'PENDING_PAYMENT',
      amount: 175.5,
      paymentDueAt: booking.paymentDueAt,
      promptpay: { id: PROMPTPAY_ID, payload: promptPayPayload(PROMPTPAY_ID, 175.5) },
      payments: [],
    });
    await http()
      .get(`/api/v1/bookings/${booking.id}/payment`)
      .set((await makeVendor()).headers)
      .expect(404);
  });

  // ───────────── Acceptance Criteria ─────────────

  it('AC: สลิปไม่ผ่าน → ส่งใหม่ได้ → อนุมัติ; ประวัติ payment ครบทุกครั้ง + audit', async () => {
    const vendor = await makeVendor();
    const booking = await pendingPayment(vendor);

    const first = await submitOk(vendor, booking.id);
    expect(first.bookingStatus).toBe('PENDING_VERIFY');
    expect(first.payments).toEqual([
      expect.objectContaining({ method: 'PROMPTPAY_SLIP', status: 'PENDING', amount: 150 }),
    ]);
    expect(submitted).toEqual([
      { paymentId: first.payments[0]!.id, bookingId: booking.id, marketId },
    ]);

    const rejected = await http()
      .post(`/api/v1/admin/payments/${first.payments[0]!.id}/reject`)
      .set(asAdmin(finance))
      .send({ reason: 'ยอดในสลิปไม่ตรง' })
      .expect(200);
    expect(rejected.body.data).toMatchObject({
      status: 'REJECTED',
      rejectReason: 'ยอดในสลิปไม่ตรง',
      verifiedByName: 'คุณfinance',
      booking: { status: 'PENDING_PAYMENT' },
    });
    // กำหนดชำระใหม่ = ตอนนี้ + payment_deadline_minutes (1440)
    const due = Date.parse(rejected.body.data.booking.paymentDueAt);
    expect(due).toBeGreaterThan(Date.now() + 1439 * 60_000);

    const second = await submitOk(vendor, booking.id);
    const approved = await http()
      .post(`/api/v1/admin/payments/${second.payments[0]!.id}/approve`)
      .set(asAdmin(finance))
      .expect(200);
    expect(approved.body.data).toMatchObject({
      status: 'APPROVED',
      booking: { status: 'CONFIRMED' },
    });
    const row = await bookingRow(booking.id);
    expect(row.confirmedAt).not.toBeNull();
    expect(row.checkinToken).toMatch(/^[A-Za-z0-9_-]{32}$/);

    const history = (
      await http().get(`/api/v1/bookings/${booking.id}/payment`).set(vendor.headers).expect(200)
    ).body.data as BookingPaymentInfo;
    expect(history.payments.map((p) => [p.status, p.rejectReason])).toEqual([
      ['APPROVED', null],
      ['REJECTED', 'ยอดในสลิปไม่ตรง'],
    ]);
    const actions = (
      await prisma.auditLog.findMany({
        where: {
          action: { startsWith: 'payment.' },
          after: { path: ['bookingId'], equals: booking.id },
        },
        orderBy: { createdAt: 'asc' },
        select: { action: true },
      })
    ).map((a) => a.action);
    expect(actions).toEqual([
      'payment.submit',
      'payment.reject',
      'payment.submit',
      'payment.approve',
    ]);
  });

  it('AC: การจองที่รอตรวจสลิป (PENDING_VERIFY) ไม่หมดอายุแม้เลยกำหนดชำระ', async () => {
    const vendor = await makeVendor();
    const booking = await pendingPayment(vendor);
    await submitOk(vendor, booking.id);
    // job หมดเวลาถูกลบเมื่อเข้ารอตรวจ
    expect(await app.get(BookingExpiryProcessor).getQueue().getJob(booking.id)).toBeUndefined();

    await prisma.booking.update({
      where: { id: booking.id },
      data: { paymentDueAt: new Date(Date.now() - HOUR) },
    });
    const expiry = app.get(BookingExpiryProcessor);
    expect(await expiry.expireBooking(booking.id)).toEqual({ expired: false });
    await expiry.sweep();
    expect((await bookingRow(booking.id)).status).toBe('PENDING_VERIFY');

    // คนอื่นจองทับไม่ได้
    const other = await makeVendor();
    const res = await http()
      .post('/api/v1/bookings/hold')
      .set(other.headers)
      .send({ stallId: (await bookingRow(booking.id)).stallId, marketDayId })
      .expect(409);
    expect(res.body.error.code).toBe('STALL_TAKEN');
  });

  // ───────────── ส่งสลิป: กรณีผิดพลาด ─────────────

  it('สลิป: key ของการจองอื่น / ยังไม่อัปโหลด / ไม่ใช่รูป → UPLOAD_INVALID; ส่งซ้ำระหว่างรอตรวจ → INVALID_STATE_TRANSITION', async () => {
    const vendor = await makeVendor();
    const a = await pendingPayment(vendor);
    const b = await pendingPayment(vendor);

    const keyOfB = await uploadSlip(vendor, b.id);
    const wrongBooking = await submit(vendor, a.id, keyOfB).expect(400);
    expect(wrongBooking.body.error).toMatchObject({
      code: 'UPLOAD_INVALID',
      details: { field: 'slipImageKey' },
    });
    const missing = keyOfB
      .replace(b.id, a.id)
      .replace(/[0-9a-f-]{36}\.jpg$/, `${crypto.randomUUID()}.jpg`);
    expect((await submit(vendor, a.id, missing).expect(400)).body.error.code).toBe(
      'UPLOAD_INVALID',
    );
    const notImage = await uploadSlip(vendor, a.id, Buffer.from('not an image at all'));
    expect((await submit(vendor, a.id, notImage).expect(400)).body.error.code).toBe(
      'UPLOAD_INVALID',
    );

    await submitOk(vendor, a.id);
    const again = await submit(vendor, a.id, await uploadSlip(vendor, b.id)).expect(409);
    expect(again.body.error).toMatchObject({
      code: 'INVALID_STATE_TRANSITION',
      details: { status: 'PENDING_VERIFY' },
    });
    // รอตรวจอยู่ ขอ URL อัปโหลดใหม่ไม่ได้
    await http()
      .post(`/api/v1/bookings/${a.id}/payments/slip-upload`)
      .set(vendor.headers)
      .send({ contentType: 'image/jpeg', size: 10 })
      .expect(409);
  });

  it('ส่งสลิปหลังเลยกำหนดชำระ → PAYMENT_DUE_PASSED และการจองเป็น EXPIRED', async () => {
    const vendor = await makeVendor();
    const booking = await pendingPayment(vendor);
    const key = await uploadSlip(vendor, booking.id);
    await prisma.booking.update({
      where: { id: booking.id },
      data: { paymentDueAt: new Date(Date.now() - 1000) },
    });
    const res = await submit(vendor, booking.id, key).expect(409);
    expect(res.body.error.code).toBe('PAYMENT_DUE_PASSED');
    expect((await bookingRow(booking.id)).status).toBe('EXPIRED');
    expect(await prisma.payment.count({ where: { bookingId: booking.id } })).toBe(0);
  });

  // ───────────── admin ─────────────

  it('GET /admin/payments?status=PENDING: คิวเก่าสุดก่อน, URL รูปสลิปเปิดได้; STAFF ไม่มีสิทธิ์; ตรวจซ้ำ/ตลาดอื่นไม่ได้', async () => {
    const v1 = await makeVendor();
    const v2 = await makeVendor();
    const b1 = await pendingPayment(v1);
    const b2 = await pendingPayment(v2);
    await submitOk(v1, b1.id);
    await submitOk(v2, b2.id);

    const res = await http()
      .get('/api/v1/admin/payments')
      .query({ status: 'PENDING' })
      .set(asAdmin(finance))
      .expect(200);
    const queue = res.body.data as AdminPayment[];
    const mine = queue.filter((p) => [b1.id, b2.id].includes(p.booking.id));
    expect(mine.map((p) => p.booking.id)).toEqual([b1.id, b2.id]);
    expect(mine[0]).toMatchObject({
      method: 'PROMPTPAY_SLIP',
      amount: 150,
      vendor: { id: v1.id, phone: v1.phone },
      booking: { status: 'PENDING_VERIFY', stallCode: b1.stall.code },
    });
    const image = await fetch(mine[0]!.slipUrl!);
    expect(Buffer.from(await image.arrayBuffer()).equals(JPEG)).toBe(true);

    await http().get('/api/v1/admin/payments').set(asAdmin(staff)).expect(403);
    const paymentId = mine[0]!.id;
    await http()
      .post(`/api/v1/admin/payments/${paymentId}/approve`)
      .set(asAdmin(otherAdmin))
      .expect(404);
    await http().post(`/api/v1/admin/payments/${paymentId}/approve`).set(asAdmin()).expect(200);
    const twice = await http()
      .post(`/api/v1/admin/payments/${paymentId}/reject`)
      .set(asAdmin())
      .send({ reason: 'ซ้ำ' })
      .expect(409);
    expect(twice.body.error.code).toBe('INVALID_STATE_TRANSITION');
    await http()
      .post(`/api/v1/admin/payments/${mine[1]!.id}/reject`)
      .set(asAdmin())
      .send({ reason: 'x' })
      .expect(400);
  });

  it('รับเงินสดก่อนผู้ค้าส่งสลิป (รอชำระ) → CONFIRMED', async () => {
    const vendor = await makeVendor();
    const booking = await pendingPayment(vendor);

    const res = await http()
      .post('/api/v1/admin/payments/cash')
      .set(asAdmin(finance))
      .send({ bookingId: booking.id })
      .expect(201);
    expect(res.body.data).toMatchObject({ method: 'CASH', booking: { status: 'CONFIRMED' } });
    expect((await bookingRow(booking.id)).checkinToken).toEqual(expect.any(String));
  });

  it('รับเงินสด: สลิปที่รอตรวจถูกปิด, การจอง CONFIRMED + checkin token; HOLD ก็รับได้; ยืนยันแล้วรับซ้ำไม่ได้', async () => {
    const vendor = await makeVendor();
    const booking = await pendingPayment(vendor);
    await submitOk(vendor, booking.id);

    const res = await http()
      .post('/api/v1/admin/payments/cash')
      .set(asAdmin(finance))
      .send({ bookingId: booking.id })
      .expect(201);
    expect(res.body.data).toMatchObject({
      method: 'CASH',
      status: 'APPROVED',
      amount: 150,
      slipUrl: null,
      booking: { status: 'CONFIRMED' },
    });
    expect((await bookingRow(booking.id)).checkinToken).not.toBeNull();
    const payments = await prisma.payment.findMany({
      where: { bookingId: booking.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(payments.map((p) => [p.method, p.status, p.rejectReason])).toEqual([
      ['PROMPTPAY_SLIP', 'REJECTED', 'รับชำระเป็นเงินสดแล้ว'],
      ['CASH', 'APPROVED', null],
    ]);

    const hold = await http()
      .post('/api/v1/bookings/hold')
      .set(vendor.headers)
      .send({ stallId: await makeStall(), marketDayId })
      .expect(201);
    await http()
      .post('/api/v1/admin/payments/cash')
      .set(asAdmin())
      .send({ bookingId: hold.body.data.id, amount: 120 })
      .expect(201);
    expect((await bookingRow(hold.body.data.id)).status).toBe('CONFIRMED');

    const again = await http()
      .post('/api/v1/admin/payments/cash')
      .set(asAdmin())
      .send({ bookingId: booking.id })
      .expect(409);
    expect(again.body.error).toMatchObject({
      code: 'INVALID_STATE_TRANSITION',
      details: { status: 'CONFIRMED' },
    });
  });

  // ───────────── SlipVerifier ─────────────

  it('SlipVerifier: VALID → อนุมัติให้เอง (actor SYSTEM); INVALID → ไม่ผ่านพร้อมเหตุผล', async () => {
    const verifier = app.get<SlipVerifier>(SLIP_VERIFIER);
    const spy = jest.spyOn(verifier, 'verify');

    spy.mockResolvedValueOnce({ status: 'VALID' });
    const v1 = await makeVendor();
    const ok = await pendingPayment(v1);
    const valid = await submitOk(v1, ok.id);
    expect(valid.bookingStatus).toBe('CONFIRMED');
    expect(spy).toHaveBeenLastCalledWith(
      expect.objectContaining({ amount: 150, promptpayId: PROMPTPAY_ID }),
    );
    expect(
      await prisma.auditLog.findFirst({
        where: { action: 'payment.approve', entityId: valid.payments[0]!.id },
      }),
    ).toMatchObject({ actorType: 'SYSTEM', actorId: null });

    spy.mockResolvedValueOnce({ status: 'INVALID', reason: 'สลิปซ้ำกับที่เคยใช้' });
    const v2 = await makeVendor();
    const bad = await pendingPayment(v2);
    const invalid = await submitOk(v2, bad.id);
    expect(invalid.bookingStatus).toBe('PENDING_PAYMENT');
    expect(invalid.payments[0]).toMatchObject({
      status: 'REJECTED',
      rejectReason: 'สลิปซ้ำกับที่เคยใช้',
    });

    // ตรวจอัตโนมัติพัง → รอเจ้าหน้าที่ตามปกติ
    spy.mockRejectedValueOnce(new Error('service down'));
    const v3 = await makeVendor();
    const down = await pendingPayment(v3);
    expect((await submitOk(v3, down.id)).bookingStatus).toBe('PENDING_VERIFY');
    spy.mockRestore();
  });

  it('ยืนยันการจองที่ไม่ต้องชำระ / admin จองแทนแบบ CONFIRMED ได้ checkin token ด้วย', async () => {
    const vendor = await makeVendor();
    const free = await http()
      .post('/api/v1/bookings/hold')
      .set(vendor.headers)
      .send({ stallId: await makeStall(0), marketDayId })
      .expect(201);
    await http()
      .post(`/api/v1/bookings/${free.body.data.id}/confirm`)
      .set(vendor.headers)
      .expect(200);
    expect((await bookingRow(free.body.data.id)).checkinToken).not.toBeNull();

    const byAdmin = await http()
      .post('/api/v1/admin/bookings')
      .set(asAdmin())
      .send({ vendorId: vendor.id, stallId: await makeStall(), marketDayId })
      .expect(201);
    expect((await bookingRow(byAdmin.body.data.id)).checkinToken).not.toBeNull();
  });
});
