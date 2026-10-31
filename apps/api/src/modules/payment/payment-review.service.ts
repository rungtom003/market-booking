import { Injectable } from '@nestjs/common';
import {
  AdminPayment,
  AdminPaymentListQuery,
  BookingStatus,
  ErrorCode,
  PaymentMethod,
  PaymentStatus,
  RecordCashPaymentInput,
} from '@market-booking/shared';
import { Prisma } from '../../generated/prisma/client';
import { AppException } from '../../common/exceptions/app.exception';
import { PaginatedResult, toSkipTake } from '../../common/pagination/paginated-result';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { AdminPrincipal } from '../auth/principal';
import { BookingEvents } from '../booking/booking-events';
import { newCheckinToken, toEvent } from '../booking/booking-mapper';
import { BookingStateService } from '../booking/booking-state.service';
import { MarketService } from '../market/market.service';
import { SettingsService } from '../settings/settings.service';
import { StorageService } from '../storage/storage.service';

/** ผู้ตรวจ: เจ้าหน้าที่ หรือระบบตรวจสลิปอัตโนมัติ (SlipVerifier) */
export type Reviewer = { type: 'ADMIN'; admin: AdminPrincipal } | { type: 'SYSTEM' };

const PAYMENT_FIELDS = {
  id: true,
  method: true,
  amount: true,
  status: true,
  slipImageKey: true,
  rejectReason: true,
  createdAt: true,
  verifiedAt: true,
  verifiedBy: { select: { displayName: true } },
  booking: {
    select: {
      id: true,
      marketId: true,
      status: true,
      amount: true,
      paymentDueAt: true,
      stall: { select: { code: true } },
      marketDay: { select: { marketDate: true } },
      vendor: { select: { id: true, firstName: true, lastName: true, phone: true } },
    },
  },
} satisfies Prisma.PaymentSelect;

type PaymentRow = Prisma.PaymentGetPayload<{ select: typeof PAYMENT_FIELDS }>;

/** ข้อความเหตุผลเมื่อสลิปที่รอตรวจถูกแทนด้วยการรับเงินสด */
const REPLACED_BY_CASH = 'รับชำระเป็นเงินสดแล้ว';

/**
 * ตรวจการชำระเงิน (Overview §9.5): อนุมัติ → การจอง CONFIRMED + checkin token,
 * ไม่ผ่าน → กลับเป็น PENDING_PAYMENT พร้อมกำหนดชำระใหม่, รับเงินสดหน้างาน
 * payment ทุกรายการเก็บไว้ (ไม่ลบ/ไม่แก้ทับ) — ประวัติครบทุกครั้งที่ส่ง
 */
@Injectable()
export class PaymentReviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly markets: MarketService,
    private readonly settings: SettingsService,
    private readonly storage: StorageService,
    private readonly state: BookingStateService,
    private readonly events: BookingEvents,
  ) {}

  /** รายการชำระเงินของตลาด — รอตรวจ: เก่าสุดก่อน (คิว), สถานะอื่น: ใหม่สุดก่อน */
  async list(
    admin: AdminPrincipal,
    query: AdminPaymentListQuery,
  ): Promise<PaginatedResult<AdminPayment>> {
    const marketId = await this.markets.resolveForAdmin(admin);
    const where: Prisma.PaymentWhereInput = { booking: { marketId }, status: query.status };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.payment.findMany({
        where,
        select: PAYMENT_FIELDS,
        orderBy: { createdAt: query.status === PaymentStatus.PENDING ? 'asc' : 'desc' },
        ...toSkipTake(query),
      }),
      this.prisma.payment.count({ where }),
    ]);
    return PaginatedResult.of(await Promise.all(rows.map((r) => this.toDto(r))), total, query);
  }

  async approve(reviewer: Reviewer, paymentId: string): Promise<AdminPayment> {
    const payment = await this.findForReview(reviewer, paymentId);
    const now = new Date();
    const updated = await this.prisma.$transaction(async (tx) => {
      await this.markReviewed(tx, reviewer, paymentId, PaymentStatus.APPROVED, now);
      const booking = await this.state.transition(
        tx,
        payment.booking.id,
        [BookingStatus.PENDING_VERIFY],
        BookingStatus.CONFIRMED,
        { confirmedAt: now, checkinToken: newCheckinToken() },
      );
      await this.audit.log(
        {
          ...this.actor(reviewer),
          action: 'payment.approve',
          entity: { type: 'payment', id: paymentId },
          before: { status: payment.status },
          after: { status: PaymentStatus.APPROVED, bookingId: booking.id },
        },
        tx,
      );
      return booking;
    });
    this.events.emitChanged([toEvent(updated)]);
    return this.get(paymentId);
  }

  /**
   * ไม่ผ่าน: การจองกลับเป็น PENDING_PAYMENT และขยายกำหนดชำระ `payment_deadline_minutes` จากตอนนี้
   * (§8.2) — ถ้าการจองไม่ได้รอตรวจแล้ว (เช่น ถูกยกเลิก) เปลี่ยนแค่ payment
   */
  async reject(reviewer: Reviewer, paymentId: string, reason: string): Promise<AdminPayment> {
    const payment = await this.findForReview(reviewer, paymentId);
    const now = new Date();
    const deadline = await this.settings.get(payment.booking.marketId, 'payment_deadline_minutes');
    const updated = await this.prisma.$transaction(async (tx) => {
      await this.markReviewed(tx, reviewer, paymentId, PaymentStatus.REJECTED, now, reason);
      const booking =
        payment.booking.status === BookingStatus.PENDING_VERIFY
          ? await this.state.transition(
              tx,
              payment.booking.id,
              [BookingStatus.PENDING_VERIFY],
              BookingStatus.PENDING_PAYMENT,
              { paymentDueAt: new Date(now.getTime() + deadline * 60_000) },
            )
          : null;
      await this.audit.log(
        {
          ...this.actor(reviewer),
          action: 'payment.reject',
          entity: { type: 'payment', id: paymentId },
          before: { status: payment.status },
          after: { status: PaymentStatus.REJECTED, reason, bookingId: payment.booking.id },
        },
        tx,
      );
      return booking;
    });
    if (updated) this.events.emitChanged([toEvent(updated)]);
    return this.get(paymentId);
  }

  /**
   * รับเงินสดหน้างาน (§9.5 ข้อ 5): การจองที่ยังไม่ยืนยัน (HOLD/รอชำระ/รอตรวจ) → CONFIRMED
   * สลิปที่รอตรวจอยู่ถูกปิดเป็น "ไม่ผ่าน" พร้อมเหตุผลว่ารับเงินสดแล้ว
   */
  async recordCash(admin: AdminPrincipal, input: RecordCashPaymentInput): Promise<AdminPayment> {
    const marketId = await this.markets.resolveForAdmin(admin);
    const booking = await this.prisma.booking.findFirst({
      where: { id: input.bookingId, marketId },
      select: { id: true, status: true, amount: true },
    });
    if (!booking) throw new AppException(ErrorCode.NOT_FOUND, 'Booking not found');
    const payable: BookingStatus[] = [
      BookingStatus.HOLD,
      BookingStatus.PENDING_PAYMENT,
      BookingStatus.PENDING_VERIFY,
    ];
    if (!payable.includes(booking.status)) {
      throw new AppException(ErrorCode.INVALID_STATE_TRANSITION, `Booking is ${booking.status}`, {
        status: booking.status,
      });
    }

    const now = new Date();
    const { paymentId, updated } = await this.prisma.$transaction(async (tx) => {
      await tx.payment.updateMany({
        where: { bookingId: booking.id, status: PaymentStatus.PENDING },
        data: {
          status: PaymentStatus.REJECTED,
          rejectReason: REPLACED_BY_CASH,
          verifiedById: admin.id,
          verifiedAt: now,
        },
      });
      const payment = await tx.payment.create({
        data: {
          bookingId: booking.id,
          method: PaymentMethod.CASH,
          amount: input.amount ?? booking.amount,
          status: PaymentStatus.APPROVED,
          verifiedById: admin.id,
          verifiedAt: now,
        },
        select: { id: true, amount: true },
      });
      const confirmed = await this.state.transition(
        tx,
        booking.id,
        [booking.status],
        BookingStatus.CONFIRMED,
        { confirmedAt: now, checkinToken: newCheckinToken() },
      );
      await this.audit.log(
        {
          actorType: 'ADMIN',
          actorId: admin.id,
          action: 'payment.cash',
          entity: { type: 'payment', id: payment.id },
          before: { bookingStatus: booking.status },
          after: { bookingId: booking.id, amount: Number(payment.amount) },
        },
        tx,
      );
      return { paymentId: payment.id, updated: confirmed };
    });
    this.events.emitChanged([toEvent(updated)]);
    return this.get(paymentId);
  }

  private async get(paymentId: string): Promise<AdminPayment> {
    const row = await this.prisma.payment.findUniqueOrThrow({
      where: { id: paymentId },
      select: PAYMENT_FIELDS,
    });
    return this.toDto(row);
  }

  /** payment ที่รอตรวจ ในตลาดของ admin (ระบบตรวจอัตโนมัติไม่จำกัดตลาด) */
  private async findForReview(reviewer: Reviewer, paymentId: string): Promise<PaymentRow> {
    const marketId =
      reviewer.type === 'ADMIN' ? await this.markets.resolveForAdmin(reviewer.admin) : undefined;
    const payment = await this.prisma.payment.findFirst({
      where: { id: paymentId, ...(marketId && { booking: { marketId } }) },
      select: PAYMENT_FIELDS,
    });
    if (!payment) throw new AppException(ErrorCode.NOT_FOUND, 'Payment not found');
    if (payment.status !== PaymentStatus.PENDING) {
      throw new AppException(ErrorCode.INVALID_STATE_TRANSITION, `Payment is ${payment.status}`, {
        status: payment.status,
      });
    }
    return payment;
  }

  /** เปลี่ยนสถานะ payment แบบมีเงื่อนไข — สองคนกดพร้อมกันได้ผลครั้งเดียว */
  private async markReviewed(
    tx: Prisma.TransactionClient,
    reviewer: Reviewer,
    paymentId: string,
    status: PaymentStatus,
    now: Date,
    rejectReason?: string,
  ): Promise<void> {
    const { count } = await tx.payment.updateMany({
      where: { id: paymentId, status: PaymentStatus.PENDING },
      data: {
        status,
        rejectReason: rejectReason ?? null,
        verifiedById: reviewer.type === 'ADMIN' ? reviewer.admin.id : null,
        verifiedAt: now,
      },
    });
    if (count === 0) {
      throw new AppException(ErrorCode.INVALID_STATE_TRANSITION, 'Payment was already reviewed');
    }
  }

  private actor(reviewer: Reviewer) {
    return reviewer.type === 'ADMIN'
      ? { actorType: 'ADMIN' as const, actorId: reviewer.admin.id }
      : { actorType: 'SYSTEM' as const, actorId: null };
  }

  private async toDto(row: PaymentRow): Promise<AdminPayment> {
    const v = row.booking.vendor;
    return {
      id: row.id,
      method: row.method as PaymentMethod,
      amount: Number(row.amount),
      status: row.status,
      rejectReason: row.rejectReason,
      createdAt: row.createdAt.toISOString(),
      verifiedAt: row.verifiedAt?.toISOString() ?? null,
      slipUrl: row.slipImageKey ? await this.storage.createDownloadUrl(row.slipImageKey) : null,
      verifiedByName: row.verifiedBy?.displayName ?? null,
      booking: {
        id: row.booking.id,
        status: row.booking.status,
        amount: Number(row.booking.amount),
        stallCode: row.booking.stall.code,
        marketDate: row.booking.marketDay.marketDate.toISOString().slice(0, 10),
        paymentDueAt: row.booking.paymentDueAt?.toISOString() ?? null,
      },
      vendor: { id: v.id, name: `${v.firstName} ${v.lastName}`, phone: v.phone },
    };
  }
}
