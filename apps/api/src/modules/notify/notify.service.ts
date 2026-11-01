import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { BookingStatus, VendorStatus } from '@market-booking/shared';
import { EventChannel } from '../../common/event-channel';
import { PrismaService } from '../../prisma/prisma.service';
import { type BookingChangedEvent, BookingEvents } from '../booking/booking-events';
import { NotificationService } from './notification.service';

export interface VendorStatusChangedEvent {
  vendorId: string;
  marketId: string;
  /** null = เพิ่งสมัคร */
  from: VendorStatus | null;
  to: VendorStatus;
  reason?: string | null;
  suspendedUntil?: Date | null;
}

/** ผู้ค้าส่งสลิป รอเจ้าหน้าที่การเงินตรวจ (§9.5 ข้อ 2) */
export interface PaymentSubmittedEvent {
  paymentId: string;
  bookingId: string;
  marketId: string;
}

/** ได้สิทธิ์ล็อคจากคิวรอ — ระบบสร้าง HOLD ให้แล้ว (Phase 9.2) */
export interface WaitlistOfferedEvent {
  waitlistId: string;
  bookingId: string;
  vendorId: string;
  marketId: string;
  marketDayId: string;
  stallCode: string;
  /** YYYY-MM-DD */
  marketDate: string;
  expiresAt: Date;
}

const BOOKING_INFO = {
  vendorId: true,
  cancelReason: true,
  cancelledByAdminId: true,
  stall: { select: { code: true } },
  marketDay: { select: { marketDate: true } },
} as const;

const isoDate = (d: Date) => d.toISOString().slice(0, 10);

/**
 * จุดเดียวที่ business logic เรียกเมื่อต้องแจ้งเตือน — ส่งต่อ 2 ทาง:
 * - ในระบบ (realtime 4.3) ผ่าน `onVendorStatusChanged` / `onPaymentSubmitted`
 * - LINE/SMS (Phase 7) ผ่าน queue ของ NotificationService
 * ห้าม throw: การแจ้งเตือนล้มต้องไม่ทำให้ flow หลักล้ม (NotificationService ไม่ throw อยู่แล้ว)
 */
@Injectable()
export class NotifyService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotifyService.name);
  private readonly vendorStatus = new EventChannel<VendorStatusChangedEvent>(
    'vendor.status_changed',
    this.logger,
  );

  private readonly paymentSubmittedChannel = new EventChannel<PaymentSubmittedEvent>(
    'payment.submitted',
    this.logger,
  );

  private readonly waitlistOfferChannel = new EventChannel<WaitlistOfferedEvent>(
    'waitlist.offered',
    this.logger,
  );

  private unsubscribe?: () => void;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
    private readonly bookingEvents: BookingEvents,
  ) {}

  onModuleInit(): void {
    this.unsubscribe = this.bookingEvents.onChanged((e) => this.onBookingChanged(e));
  }

  onModuleDestroy(): void {
    this.unsubscribe?.();
  }

  onVendorStatusChanged(listener: (event: VendorStatusChangedEvent) => void): () => void {
    return this.vendorStatus.on(listener);
  }

  onPaymentSubmitted(listener: (event: PaymentSubmittedEvent) => void): () => void {
    return this.paymentSubmittedChannel.on(listener);
  }

  onWaitlistOffered(listener: (event: WaitlistOfferedEvent) => void): () => void {
    return this.waitlistOfferChannel.on(listener);
  }

  /** ได้สิทธิ์จากคิว → socket `waitlist:offer` + LINE/SMS (ต้องยืนยันภายในเวลา) */
  async waitlistOffered(event: WaitlistOfferedEvent): Promise<void> {
    this.waitlistOfferChannel.emit([event]);
    await this.notifications.toVendor(
      event.vendorId,
      {
        template: 'waitlist.offer',
        params: {
          stallCode: event.stallCode,
          marketDate: event.marketDate,
          expiresAt: event.expiresAt.toISOString(),
        },
      },
      `waitlist.offer:${event.waitlistId}:${event.bookingId}`,
    );
  }

  /** สลิปใหม่ → badge ของ admin + กลุ่ม LINE เจ้าหน้าที่ */
  async paymentSubmitted(event: PaymentSubmittedEvent): Promise<void> {
    this.paymentSubmittedChannel.emit([event]);
    const payment = await this.prisma.payment
      .findUnique({
        where: { id: event.paymentId },
        select: {
          amount: true,
          booking: {
            select: { ...BOOKING_INFO, vendor: { select: { firstName: true, lastName: true } } },
          },
        },
      })
      .catch(() => null);
    if (!payment) return;
    const { booking } = payment;
    await this.notifications.toAdminGroup(
      event.marketId,
      {
        template: 'admin.payment_submitted',
        params: {
          vendorName: `${booking.vendor.firstName} ${booking.vendor.lastName}`,
          stallCode: booking.stall.code,
          marketDate: isoDate(booking.marketDay.marketDate),
          amount: Number(payment.amount),
        },
      },
      `admin.payment_submitted:${event.paymentId}`,
    );
  }

  /** สลิปไม่ผ่าน (เจ้าหน้าที่หรือ SlipVerifier) → แจ้งผู้ค้าพร้อมเหตุผลและกำหนดส่งใหม่ */
  async paymentRejected(paymentId: string): Promise<void> {
    const payment = await this.prisma.payment
      .findUnique({
        where: { id: paymentId },
        select: {
          rejectReason: true,
          booking: { select: { id: true, paymentDueAt: true, ...BOOKING_INFO } },
        },
      })
      .catch(() => null);
    if (!payment) return;
    const { booking } = payment;
    await this.notifications.toVendor(
      booking.vendorId,
      {
        template: 'payment.rejected',
        params: {
          bookingId: booking.id,
          stallCode: booking.stall.code,
          reason: payment.rejectReason,
          dueAt: booking.paymentDueAt?.toISOString() ?? null,
        },
      },
      `payment.rejected:${paymentId}`,
    );
  }

  async vendorStatusChanged(event: VendorStatusChangedEvent): Promise<void> {
    this.vendorStatus.emit([event]);
    const { vendorId, from, to } = event;

    if (
      to === VendorStatus.APPROVED &&
      (from === VendorStatus.PENDING || from === VendorStatus.REJECTED)
    ) {
      await this.notifications.toVendor(vendorId, { template: 'vendor.approved', params: {} });
    } else if (to === VendorStatus.REJECTED) {
      await this.notifications.toVendor(vendorId, {
        template: 'vendor.rejected',
        params: { reason: event.reason ?? null },
      });
    } else if (to === VendorStatus.SUSPENDED) {
      await this.notifications.toVendor(vendorId, {
        template: 'vendor.suspended',
        params: {
          reason: event.reason ?? null,
          until: event.suspendedUntil?.toISOString() ?? null,
        },
      });
    } else if (from === null && to === VendorStatus.PENDING) {
      // สมัครใหม่แบบต้องตรวจ (registration_mode = MANUAL)
      const vendor = await this.prisma.vendor
        .findUnique({ where: { id: vendorId }, select: { firstName: true, lastName: true } })
        .catch(() => null);
      if (!vendor) return;
      await this.notifications.toAdminGroup(event.marketId, {
        template: 'admin.vendor_registered',
        params: { vendorName: `${vendor.firstName} ${vendor.lastName}` },
      });
    }
  }

  /** จองสำเร็จ / เจ้าหน้าที่ยกเลิก — สถานะอื่นผู้ค้าเห็นบนหน้าจอขณะทำเอง */
  private async onBookingChanged(event: BookingChangedEvent): Promise<void> {
    if (event.status !== BookingStatus.CONFIRMED && event.status !== BookingStatus.CANCELLED) {
      return;
    }
    const booking = await this.prisma.booking
      .findUnique({ where: { id: event.bookingId }, select: BOOKING_INFO })
      .catch(() => null);
    if (!booking) return;
    const base = {
      stallCode: booking.stall.code,
      marketDate: isoDate(booking.marketDay.marketDate),
    };

    if (event.status === BookingStatus.CONFIRMED) {
      await this.notifications.toVendor(
        booking.vendorId,
        { template: 'booking.confirmed', params: base },
        `booking.confirmed:${event.bookingId}`,
      );
    } else if (booking.cancelledByAdminId) {
      await this.notifications.toVendor(
        booking.vendorId,
        { template: 'booking.cancelled', params: { ...base, reason: booking.cancelReason } },
        `booking.cancelled:${event.bookingId}`,
      );
    }
  }
}
