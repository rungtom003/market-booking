import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  ACTIVE_BOOKING_STATUSES,
  AdminCancelBookingInput,
  Booking,
  BookingStatus,
  CancelBookingInput,
  ErrorCode,
  HOLD_RATE_LIMIT,
  HoldBookingInput,
} from '@market-booking/shared';
import type Redis from 'ioredis';
import { Prisma } from '../../generated/prisma/client';
import { AppException } from '../../common/exceptions/app.exception';
import { zonedDayStart } from '../../common/zoned-date';
import { PrismaService } from '../../prisma/prisma.service';
import { REDIS } from '../../redis/redis.module';
import { AuditService } from '../audit/audit.service';
import type { AdminPrincipal, VendorPrincipal } from '../auth/principal';
import { MarketService } from '../market/market.service';
import { RoundService } from '../round/round.service';
import { SettingsService } from '../settings/settings.service';
import { BookingEvents } from './booking-events';
import {
  BOOKING_FIELDS,
  BookingEventRow,
  BookingRow,
  SCALAR_FIELDS,
  toBooking,
  toEvent,
} from './booking-mapper';
import { BookingStateService } from './booking-state.service';

const ACTIVE: BookingStatus[] = [...ACTIVE_BOOKING_STATUSES];
/** ผู้ค้าเห็นประวัติการจองล่าสุดไม่เกินนี้ */
const MY_BOOKINGS_LIMIT = 100;
/** จองพร้อมกันมาก (เช่นเปิดรอบ) connection pool อาจต้องรอ — ให้รอได้นานกว่าค่าเริ่มต้น 2 วินาที */
const TX_OPTIONS = { maxWait: 10_000, timeout: 10_000 };

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

/**
 * จอง/ยืนยัน/ยกเลิกล็อค (Overview §9.4–9.6)
 * DB เป็นผู้ตัดสินว่าใครได้ล็อค (`uq_active_booking`); โควตาต่อวันกันด้วย advisory lock ต่อ (ผู้ค้า, วันขาย)
 */
@Injectable()
export class BookingService {
  private readonly logger = new Logger(BookingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly markets: MarketService,
    private readonly rounds: RoundService,
    private readonly settings: SettingsService,
    private readonly state: BookingStateService,
    private readonly events: BookingEvents,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  /**
   * HOLD ล็อค — ใน transaction เดียว (§9.4): ล็อค (ผู้ค้า, วันขาย) → รอบเปิดอยู่ → ล็อคเปิดให้จอง
   * → ประเภทสินค้าตรงโซน → โควตาต่อวัน → INSERT (ชน unique = `STALL_TAKEN`)
   * ผู้ค้า APPROVED/ไม่ถูกระงับ ตรวจแล้วที่ `VendorApprovedGuard`
   */
  async hold(
    vendor: VendorPrincipal,
    input: HoldBookingInput,
    now: Date = new Date(),
  ): Promise<Booking> {
    await this.assertHoldRate(vendor.id);
    const holdMinutes = await this.settings.get(vendor.marketId, 'hold_minutes');
    const { stallId, marketDayId } = input;
    const changed: BookingEventRow[] = [];

    try {
      const row = await this.prisma.$transaction(async (tx) => {
        // กันผู้ค้าคนเดียวกดหลายล็อคพร้อมกันจนเกินโควตา (§9.4 ข้อ 5) — ปลดเองตอนจบ transaction
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${vendor.id}), hashtext(${marketDayId}))`;

        const day = await this.rounds.assertRoundOpen(marketDayId, {
          marketId: vendor.marketId,
          now,
          db: tx,
        });
        const stall = await tx.stall.findFirst({
          where: { id: stallId, marketId: vendor.marketId },
          select: {
            code: true,
            isActive: true,
            isReserved: true,
            price: true,
            zone: { select: { name: true, allowedCategoryIds: true } },
            overrides: { where: { marketDayId }, select: { priceOverride: true, isClosed: true } },
          },
        });
        if (!stall) throw new AppException(ErrorCode.NOT_FOUND, 'Stall not found');
        const override = stall.overrides[0];
        if (!stall.isActive || stall.isReserved || override?.isClosed) {
          throw new AppException(ErrorCode.STALL_UNAVAILABLE, 'Stall is not open for booking');
        }

        const allowed = stall.zone.allowedCategoryIds;
        if (allowed.length > 0) {
          const { productCategoryId } = await tx.vendor.findUniqueOrThrow({
            where: { id: vendor.id },
            select: { productCategoryId: true },
          });
          if (!productCategoryId || !allowed.includes(productCategoryId)) {
            throw new AppException(
              ErrorCode.CATEGORY_NOT_ALLOWED,
              'Product category is not allowed in this zone',
            );
          }
        }

        // หมดเวลาแล้วแต่ worker ยังไม่ทันเปลี่ยน → EXPIRED ก่อน ไม่ให้กันล็อค/กินโควตา
        changed.push(
          ...(await this.state.expireLapsed(
            tx,
            { marketDayId, OR: [{ stallId }, { vendorId: vendor.id }] },
            now,
          )),
        );

        const active = await tx.booking.count({
          where: { vendorId: vendor.id, marketDayId, status: { in: ACTIVE } },
        });
        const limit = day.round.maxStallsPerVendor;
        if (active >= limit) {
          throw new AppException(ErrorCode.QUOTA_EXCEEDED, 'Booking quota reached for this day', {
            limit,
          });
        }

        const booking = await tx.booking.create({
          data: {
            marketId: vendor.marketId,
            vendorId: vendor.id,
            stallId,
            marketDayId,
            status: BookingStatus.HOLD,
            amount: override?.priceOverride ?? stall.price,
            holdExpiresAt: new Date(now.getTime() + holdMinutes * 60_000),
          },
          // ไม่ให้ Prisma อ่าน relation ซ้ำ — ล็อค/วันขาย/รอบอ่านมาแล้วใน transaction นี้ (load test 4.6)
          select: SCALAR_FIELDS,
        });
        changed.push(booking);
        return {
          ...booking,
          stall: { code: stall.code, zone: { name: stall.zone.name } },
          marketDay: { marketDate: day.marketDate, round: { name: day.round.name } },
        } satisfies BookingRow;
      }, TX_OPTIONS);

      this.events.emitChanged(changed.map(toEvent));
      return toBooking(row, now);
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      // transaction rollback แล้ว (รวมที่ expire ไว้) — บอกด้วยว่าล็อคนี้เป็นของตัวเองอยู่แล้วหรือไม่
      const mine = await this.prisma.booking.count({
        where: { stallId, marketDayId, vendorId: vendor.id, status: { in: ACTIVE } },
      });
      throw new AppException(ErrorCode.STALL_TAKEN, 'Stall is already taken', {
        mine: mine > 0,
      });
    }
  }

  /**
   * HOLD → CONFIRMED (ไม่ต้องชำระ หรือราคา 0) หรือ PENDING_PAYMENT (ตั้ง `payment_due_at`)
   * หมดเวลา hold แล้ว → EXPIRED + `HOLD_EXPIRED`
   */
  async confirm(vendor: VendorPrincipal, id: string, now: Date = new Date()): Promise<Booking> {
    const booking = await this.findMine(vendor, id);
    if (booking.status !== BookingStatus.HOLD) throw this.notInState(booking.status);
    if (booking.holdExpiresAt && booking.holdExpiresAt <= now) {
      const expired = await this.state.expireLapsed(this.prisma, { id }, now);
      this.events.emitChanged(expired.map(toEvent));
      throw new AppException(ErrorCode.HOLD_EXPIRED, 'Hold has expired', {
        holdExpiresAt: booking.holdExpiresAt.toISOString(),
      });
    }

    const settings = await this.settings.getAll(vendor.marketId);
    const needsPayment = settings.payment_required && Number(booking.amount) > 0;
    const row = await this.state.transition(
      this.prisma,
      id,
      [BookingStatus.HOLD],
      needsPayment ? BookingStatus.PENDING_PAYMENT : BookingStatus.CONFIRMED,
      needsPayment
        ? { paymentDueAt: new Date(now.getTime() + settings.payment_deadline_minutes * 60_000) }
        : { confirmedAt: now },
      // hold หมดเวลาระหว่างนี้ → ไม่ยืนยัน
      { holdExpiresAt: { gt: now } },
    );
    this.events.emitChanged([toEvent(row)]);
    return toBooking(row, now);
  }

  /** ผู้ค้ายกเลิกเอง: HOLD ได้ทุกเมื่อ; สถานะอื่นต้องเหลือเวลาก่อนวันขาย ≥ `cancel_before_hours` */
  async cancelByVendor(
    vendor: VendorPrincipal,
    id: string,
    input: CancelBookingInput,
    now: Date = new Date(),
  ): Promise<Booking> {
    const booking = await this.findMine(vendor, id);
    if (!ACTIVE.includes(booking.status)) throw this.notInState(booking.status);

    if (booking.status !== BookingStatus.HOLD) {
      const hours = await this.settings.get(vendor.marketId, 'cancel_before_hours');
      const dayStart = zonedDayStart(
        booking.marketDay.marketDate.toISOString().slice(0, 10),
        await this.rounds.timeZone(vendor.marketId),
      );
      const deadline = new Date(dayStart.getTime() - hours * 3_600_000);
      if (now > deadline) {
        throw new AppException(ErrorCode.CANCEL_WINDOW_PASSED, 'Cancellation window has passed', {
          deadline: deadline.toISOString(),
          cancelBeforeHours: hours,
        });
      }
    }

    const row = await this.state.transition(
      this.prisma,
      id,
      [booking.status],
      BookingStatus.CANCELLED,
      { cancelledAt: now, cancelReason: input.reason || null },
    );
    this.events.emitChanged([toEvent(row)]);
    return toBooking(row, now);
  }

  /** Admin ยกเลิกแทนได้ทุกเวลา ต้องระบุเหตุผล — ลง audit log */
  async cancelByAdmin(
    admin: AdminPrincipal,
    id: string,
    input: AdminCancelBookingInput,
  ): Promise<Booking> {
    const marketId = await this.markets.resolveForAdmin(admin);
    const booking = await this.prisma.booking.findFirst({
      where: { id, marketId },
      select: BOOKING_FIELDS,
    });
    if (!booking) throw new AppException(ErrorCode.NOT_FOUND, 'Booking not found');
    if (!ACTIVE.includes(booking.status)) throw this.notInState(booking.status);

    const now = new Date();
    const row = await this.prisma.$transaction(async (tx) => {
      const updated = await this.state.transition(
        tx,
        id,
        [booking.status],
        BookingStatus.CANCELLED,
        { cancelledAt: now, cancelReason: input.reason, cancelledByAdminId: admin.id },
      );
      await this.audit.log(
        {
          actorType: 'ADMIN',
          actorId: admin.id,
          action: 'booking.cancel',
          entity: { type: 'booking', id },
          before: { status: booking.status },
          after: { status: updated.status, reason: input.reason },
        },
        tx,
      );
      return updated;
    });
    this.events.emitChanged([toEvent(row)]);
    return toBooking(row, now);
  }

  /** การจองของผู้ค้า วันขายล่าสุดก่อน */
  async listMine(vendor: VendorPrincipal): Promise<Booking[]> {
    const rows = await this.prisma.booking.findMany({
      where: { vendorId: vendor.id },
      select: BOOKING_FIELDS,
      orderBy: [{ marketDay: { marketDate: 'desc' } }, { createdAt: 'desc' }],
      take: MY_BOOKINGS_LIMIT,
    });
    const now = new Date();
    return rows.map((r) => toBooking(r, now));
  }

  private async findMine(vendor: VendorPrincipal, id: string): Promise<BookingRow> {
    const booking = await this.prisma.booking.findFirst({
      where: { id, vendorId: vendor.id },
      select: BOOKING_FIELDS,
    });
    // ของคนอื่น = ไม่พบ (ไม่บอกว่ามีอยู่)
    if (!booking) throw new AppException(ErrorCode.NOT_FOUND, 'Booking not found');
    return booking;
  }

  private notInState(status: BookingStatus): AppException {
    return new AppException(ErrorCode.INVALID_STATE_TRANSITION, `Booking is ${status}`, { status });
  }

  /** 5 ครั้ง / 10 วินาที ต่อผู้ค้า (§10.4) — Redis ล่ม = ไม่จำกัด (ไม่ให้การจองพังทั้งระบบ) */
  private async assertHoldRate(vendorId: string): Promise<void> {
    const key = `rl:hold:${vendorId}`;
    let count: number;
    try {
      count = await this.redis.incr(key);
      if (count === 1) await this.redis.expire(key, HOLD_RATE_LIMIT.windowSeconds);
    } catch (error) {
      this.logger.warn(`Hold rate limit unavailable: ${String(error)}`);
      return;
    }
    if (count > HOLD_RATE_LIMIT.limit) {
      const ttl = await this.redis.ttl(key).catch(() => HOLD_RATE_LIMIT.windowSeconds);
      throw new AppException(ErrorCode.RATE_LIMITED, 'Too many booking attempts', {
        retryAfterSeconds: Math.max(ttl, 1),
      });
    }
  }
}
