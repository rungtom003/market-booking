import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ACTIVE_BOOKING_STATUSES, BookingStatus } from '@market-booking/shared';
import { zonedDayStart } from '../../common/zoned-date';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { type BookingChangedEvent, BookingEvents } from '../booking/booking-events';
import { type BookingEventRow, EVENT_FIELDS, toEvent } from '../booking/booking-mapper';
import { BookingStateService } from '../booking/booking-state.service';
import { NotifyService } from '../notify/notify.service';
import { SettingsService } from '../settings/settings.service';

const ACTIVE = [...ACTIVE_BOOKING_STATUSES];
const DAY_MS = 86_400_000;

interface Offer {
  waitlistId: string;
  vendorId: string;
  booking: BookingEventRow;
  stallCode: string;
  marketDate: string;
}

/**
 * ส่งสิทธิ์ล็อคให้คิวรอ (Overview §9.7, Phase 9.2) — ฟัง `booking.changed`:
 * - การจองหมดเวลา/ถูกยกเลิก → ล็อคว่าง → คิวลำดับแรกที่มีสิทธิ์ได้ HOLD ในชื่อตัวเอง (`waitlist_claim_minutes`)
 * - HOLD จากคิวหมดเวลา/ถูกสละ → คิวนั้น EXPIRED/CANCELLED แล้วส่งต่อคิวถัดไป (ผ่านทางเดียวกัน)
 * - HOLD จากคิวถูกยืนยัน → FULFILLED
 * HOLD หมดเวลาใช้ worker เดิม (booking-expiry) — ไม่มี timer ของคิวแยก
 */
@Injectable()
export class WaitlistOfferService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WaitlistOfferService.name);
  private unsubscribe?: () => void;

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly state: BookingStateService,
    private readonly events: BookingEvents,
    private readonly notify: NotifyService,
  ) {}

  onModuleInit(): void {
    this.unsubscribe = this.events.onChanged((e) => this.onBookingChanged(e));
  }

  onModuleDestroy(): void {
    this.unsubscribe?.();
  }

  async onBookingChanged(event: BookingChangedEvent): Promise<void> {
    try {
      if (event.status === BookingStatus.EXPIRED || event.status === BookingStatus.CANCELLED) {
        await this.prisma.waitlist.updateMany({
          where: { offerBookingId: event.bookingId, status: 'NOTIFIED' },
          data: { status: event.status === BookingStatus.EXPIRED ? 'EXPIRED' : 'CANCELLED' },
        });
        await this.offerStall(event.marketDayId, event.stallId);
      } else if (
        event.status === BookingStatus.PENDING_PAYMENT ||
        event.status === BookingStatus.CONFIRMED
      ) {
        await this.prisma.waitlist.updateMany({
          where: { offerBookingId: event.bookingId, status: 'NOTIFIED' },
          data: { status: 'FULFILLED' },
        });
      }
    } catch (error) {
      // คิวรอพังต้องไม่กระทบการจอง — ล็อคยังว่างให้คนอื่นจองได้ตามปกติ
      this.logger.error(
        `Waitlist handling for booking ${event.bookingId} failed: ${String(error)}`,
      );
    }
  }

  /**
   * ถ้าล็อคว่างจริง → สร้าง HOLD ให้คิวลำดับแรกที่ยังมีสิทธิ์ (ผู้ค้าอนุมัติแล้ว, ประเภทสินค้าตรงโซน, ไม่เกินโควตาของรอบ)
   * คิวที่ไม่มีสิทธิ์ตอนนี้ยังคงรอ (อาจมีสิทธิ์รอบหน้า) — คืน id ของคิวที่ได้สิทธิ์ หรือ null
   */
  async offerStall(
    marketDayId: string,
    stallId: string,
    now: Date = new Date(),
  ): Promise<string | null> {
    const waiting = await this.prisma.waitlist.count({
      where: { marketDayId, status: 'WAITING' },
    });
    if (waiting === 0) return null;

    const day = await this.prisma.marketDay.findUnique({
      where: { id: marketDayId },
      select: {
        marketId: true,
        marketDate: true,
        isCancelled: true,
        market: { select: { timezone: true } },
        round: { select: { status: true, maxStallsPerVendor: true } },
      },
    });
    if (!day || day.isCancelled || day.round.status !== 'PUBLISHED') return null;
    const date = day.marketDate.toISOString().slice(0, 10);
    // วันขายจบแล้ว — ไม่มีประโยชน์ที่จะให้สิทธิ์
    if (now.getTime() >= zonedDayStart(date, day.market.timezone).getTime() + DAY_MS) return null;
    const claimMinutes = await this.settings.get(day.marketId, 'waitlist_claim_minutes');

    const changed: BookingEventRow[] = [];
    let offer: Offer | null;
    try {
      offer = await this.prisma.$transaction(async (tx) => {
        // ทีละคนต่อล็อค-วัน: event ซ้ำ/หลาย instance ไม่ให้สิทธิ์ซ้อน
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${stallId}), hashtext(${marketDayId}))`;

        const stall = await tx.stall.findFirst({
          where: { id: stallId, marketId: day.marketId },
          select: {
            code: true,
            zoneId: true,
            isActive: true,
            isReserved: true,
            price: true,
            zone: { select: { allowedCategoryIds: true } },
            overrides: { where: { marketDayId }, select: { priceOverride: true, isClosed: true } },
          },
        });
        const override = stall?.overrides[0];
        if (!stall || !stall.isActive || stall.isReserved || override?.isClosed) return null;

        changed.push(...(await this.state.expireLapsed(tx, { marketDayId, stallId }, now)));
        const taken = await tx.booking.count({
          where: { marketDayId, stallId, status: { in: ACTIVE } },
        });
        if (taken > 0) return null;

        const candidates = await tx.waitlist.findMany({
          where: {
            marketDayId,
            status: 'WAITING',
            OR: [{ stallId }, { stallId: null, zoneId: stall.zoneId }],
          },
          orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
          select: {
            id: true,
            vendorId: true,
            vendor: { select: { status: true, productCategoryId: true } },
          },
        });
        const allowed = stall.zone.allowedCategoryIds;

        for (const c of candidates) {
          if (c.vendor.status !== 'APPROVED') continue;
          if (
            allowed.length > 0 &&
            (!c.vendor.productCategoryId || !allowed.includes(c.vendor.productCategoryId))
          ) {
            continue;
          }
          // โควตาต่อวันเหมือนการจองเอง (ล็อคเดียวกับ BookingService.hold)
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${c.vendorId}), hashtext(${marketDayId}))`;
          changed.push(
            ...(await this.state.expireLapsed(tx, { marketDayId, vendorId: c.vendorId }, now)),
          );
          const active = await tx.booking.count({
            where: { vendorId: c.vendorId, marketDayId, status: { in: ACTIVE } },
          });
          if (active >= day.round.maxStallsPerVendor) continue;

          const expiresAt = new Date(now.getTime() + claimMinutes * 60_000);
          const booking = await tx.booking.create({
            data: {
              marketId: day.marketId,
              vendorId: c.vendorId,
              stallId,
              marketDayId,
              status: BookingStatus.HOLD,
              amount: override?.priceOverride ?? stall.price,
              holdExpiresAt: expiresAt,
            },
            select: EVENT_FIELDS,
          });
          await tx.waitlist.update({
            where: { id: c.id },
            data: {
              status: 'NOTIFIED',
              notifiedAt: now,
              expiresAt,
              offerBookingId: booking.id,
            },
          });
          return {
            waitlistId: c.id,
            vendorId: c.vendorId,
            booking,
            stallCode: stall.code,
            marketDate: date,
          };
        }
        return null;
      });
    } catch (error) {
      // คนอื่นจองตัดหน้าระหว่างนี้ (unique index) — ล็อคไม่ว่างแล้ว ไม่ต้องให้สิทธิ์
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return null;
      }
      throw error;
    }

    if (offer) changed.push(offer.booking);
    this.events.emitChanged(changed.map(toEvent));
    if (!offer) return null;

    this.logger.log(`Waitlist ${offer.waitlistId} offered stall ${offer.stallCode} (${date})`);
    await this.notify.waitlistOffered({
      waitlistId: offer.waitlistId,
      bookingId: offer.booking.id,
      vendorId: offer.vendorId,
      marketId: day.marketId,
      marketDayId,
      stallCode: offer.stallCode,
      marketDate: offer.marketDate,
      expiresAt: offer.booking.holdExpiresAt!,
    });
    return offer.waitlistId;
  }
}
