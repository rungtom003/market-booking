import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  BookingPaymentInfo,
  BookingStatus,
  ErrorCode,
  PaymentMethod,
  PaymentStatus,
  SlipUploadRequestInput,
  SubmitSlipInput,
  UploadTicket,
  promptPayPayload,
} from '@market-booking/shared';
import { AppException } from '../../common/exceptions/app.exception';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { VendorPrincipal } from '../auth/principal';
import { BookingEvents } from '../booking/booking-events';
import { toEvent } from '../booking/booking-mapper';
import { BookingStateService } from '../booking/booking-state.service';
import { NotifyService } from '../notify/notify.service';
import { SettingsService } from '../settings/settings.service';
import { IMAGE_EXTENSION, checkUploadedImage } from '../storage/image-file';
import { StorageService } from '../storage/storage.service';
import { PaymentReviewService } from './payment-review.service';
import { SLIP_VERIFIER, type SlipVerifier } from './slip-verifier';

const SLIP_KEY = /^vendors\/[0-9a-f-]{36}\/slips\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|png|webp)$/;

/** ชำระเงินฝั่งผู้ค้า (Overview §9.5): ดู QR พร้อมเพย์ → อัปโหลดสลิป → ส่งให้ตรวจ */
@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    private readonly storage: StorageService,
    private readonly state: BookingStateService,
    private readonly events: BookingEvents,
    private readonly notify: NotifyService,
    private readonly review: PaymentReviewService,
    @Inject(SLIP_VERIFIER) private readonly verifier: SlipVerifier,
  ) {}

  /** ยอด, กำหนดชำระ, QR พร้อมเพย์ (ยอดตรงกับการจอง) และประวัติการชำระทั้งหมด */
  async info(vendor: VendorPrincipal, bookingId: string): Promise<BookingPaymentInfo> {
    const booking = await this.findMine(vendor, bookingId);
    const [promptpayId, payments] = await Promise.all([
      this.settings.get(vendor.marketId, 'promptpay_id'),
      this.prisma.payment.findMany({
        where: { bookingId },
        select: {
          id: true,
          method: true,
          amount: true,
          status: true,
          rejectReason: true,
          createdAt: true,
          verifiedAt: true,
        },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    const amount = Number(booking.amount);
    return {
      bookingId,
      bookingStatus: booking.status,
      amount,
      paymentDueAt: booking.paymentDueAt?.toISOString() ?? null,
      promptpay: promptpayId
        ? { id: promptpayId, payload: promptPayPayload(promptpayId, amount) }
        : null,
      payments: payments.map((p) => ({
        id: p.id,
        method: p.method as PaymentMethod,
        amount: Number(p.amount),
        status: p.status,
        rejectReason: p.rejectReason,
        createdAt: p.createdAt.toISOString(),
        verifiedAt: p.verifiedAt?.toISOString() ?? null,
      })),
    };
  }

  /** presigned PUT สำหรับรูปสลิป — เฉพาะการจองที่รอชำระ */
  async createSlipUpload(
    vendor: VendorPrincipal,
    bookingId: string,
    input: SlipUploadRequestInput,
  ): Promise<UploadTicket> {
    const booking = await this.findMine(vendor, bookingId);
    this.assertAwaitingPayment(booking, new Date());
    const key = `vendors/${vendor.id}/slips/${bookingId}/${randomUUID()}.${IMAGE_EXTENSION[input.contentType]}`;
    return this.storage.createUploadUrl(key, input.contentType, input.size);
  }

  /**
   * ส่งสลิป: PENDING_PAYMENT → PENDING_VERIFY (ต้องยังไม่เลยกำหนดชำระ) + payment PENDING
   * ระหว่างรอตรวจ การจองไม่หมดอายุ (worker ลบ job เพราะสถานะนี้ไม่มีกำหนดเวลา)
   */
  async submitSlip(
    vendor: VendorPrincipal,
    bookingId: string,
    input: SubmitSlipInput,
    now: Date = new Date(),
  ): Promise<BookingPaymentInfo> {
    const booking = await this.findMine(vendor, bookingId);
    if (booking.status === BookingStatus.PENDING_PAYMENT) await this.expireIfDue(bookingId, now);
    this.assertAwaitingPayment(booking, now);
    await this.assertSlip(vendor, bookingId, input.slipImageKey);

    let paymentId: string;
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const updated = await this.state.transition(
          tx,
          bookingId,
          [BookingStatus.PENDING_PAYMENT],
          BookingStatus.PENDING_VERIFY,
          {},
          // เลยกำหนดระหว่างนี้ → ไม่รับสลิป
          { paymentDueAt: { gt: now } },
        );
        const payment = await tx.payment.create({
          data: {
            bookingId,
            method: PaymentMethod.PROMPTPAY_SLIP,
            amount: booking.amount,
            slipImageKey: input.slipImageKey,
            status: PaymentStatus.PENDING,
          },
          select: { id: true },
        });
        await this.audit.log(
          {
            actorType: 'VENDOR',
            actorId: vendor.id,
            action: 'payment.submit',
            entity: { type: 'payment', id: payment.id },
            after: { bookingId, amount: Number(booking.amount) },
          },
          tx,
        );
        return { updated, paymentId: payment.id };
      });
      paymentId = result.paymentId;
      this.events.emitChanged([toEvent(result.updated)]);
    } catch (error) {
      await this.expireIfDue(bookingId, now);
      throw error;
    }

    await this.notify.paymentSubmitted({ paymentId, bookingId, marketId: vendor.marketId });
    await this.autoVerify(vendor, paymentId, input.slipImageKey, Number(booking.amount));
    return this.info(vendor, bookingId);
  }

  /** ตรวจสลิปอัตโนมัติ (ถ้ามี) — พังหรือไม่แน่ใจ = รอเจ้าหน้าที่ตรวจตามปกติ */
  private async autoVerify(
    vendor: VendorPrincipal,
    paymentId: string,
    slipImageKey: string,
    amount: number,
  ): Promise<void> {
    try {
      const result = await this.verifier.verify({
        paymentId,
        slipImageKey,
        amount,
        promptpayId: await this.settings.get(vendor.marketId, 'promptpay_id'),
      });
      if (result.status === 'VALID') await this.review.approve({ type: 'SYSTEM' }, paymentId);
      if (result.status === 'INVALID') {
        await this.review.reject({ type: 'SYSTEM' }, paymentId, result.reason);
      }
    } catch (error) {
      this.logger.warn(`Slip auto-verification failed for ${paymentId}: ${String(error)}`);
    }
  }

  private async findMine(vendor: VendorPrincipal, bookingId: string) {
    const booking = await this.prisma.booking.findFirst({
      where: { id: bookingId, vendorId: vendor.id },
      select: { id: true, status: true, amount: true, paymentDueAt: true },
    });
    // ของคนอื่น = ไม่พบ
    if (!booking) throw new AppException(ErrorCode.NOT_FOUND, 'Booking not found');
    return booking;
  }

  private assertAwaitingPayment(
    booking: { status: BookingStatus; paymentDueAt: Date | null },
    now: Date,
  ): void {
    if (booking.status !== BookingStatus.PENDING_PAYMENT) {
      throw new AppException(ErrorCode.INVALID_STATE_TRANSITION, `Booking is ${booking.status}`, {
        status: booking.status,
      });
    }
    if (booking.paymentDueAt && booking.paymentDueAt <= now) {
      throw new AppException(ErrorCode.PAYMENT_DUE_PASSED, 'Payment due date has passed', {
        paymentDueAt: booking.paymentDueAt.toISOString(),
      });
    }
  }

  /** สลิปต้องอยู่ใต้ prefix ของผู้ค้าและการจองนี้ และเป็นรูปจริง ≤ 5 MB */
  private async assertSlip(vendor: VendorPrincipal, bookingId: string, key: string): Promise<void> {
    const invalid = (message: string) =>
      new AppException(ErrorCode.UPLOAD_INVALID, message, { field: 'slipImageKey' });
    if (!SLIP_KEY.test(key) || !key.startsWith(`vendors/${vendor.id}/slips/${bookingId}/`)) {
      throw invalid('File does not belong to this booking');
    }
    const result = await checkUploadedImage(this.storage, key, (e) =>
      this.logger.warn(`Delete ${key} failed: ${String(e)}`),
    );
    if (result === 'missing') throw invalid('File has not been uploaded');
    if (result === 'invalid')
      throw invalid('File must be a JPEG, PNG or WebP image of 5 MB or less');
  }

  /** ส่งไม่ทันกำหนด → เปลี่ยนเป็น EXPIRED ทันที (ไม่รอ worker) แล้วแจ้งเป็น PAYMENT_DUE_PASSED */
  private async expireIfDue(bookingId: string, now: Date): Promise<void> {
    const expired = await this.state.expireLapsed(this.prisma, { id: bookingId }, now);
    if (expired.length === 0) return;
    this.events.emitChanged(expired.map(toEvent));
    throw new AppException(ErrorCode.PAYMENT_DUE_PASSED, 'Payment due date has passed', {
      paymentDueAt: expired[0]?.paymentDueAt?.toISOString() ?? null,
    });
  }
}
