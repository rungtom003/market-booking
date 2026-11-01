import { Injectable } from '@nestjs/common';
import {
  ACTIVE_BOOKING_STATUSES,
  type AdminWaitlistEntry,
  BookingStatus,
  ErrorCode,
  type JoinWaitlistInput,
  MAX_WAITLIST_PER_DAY,
  type WaitlistEntry,
} from '@market-booking/shared';
import { AppException } from '../../common/exceptions/app.exception';
import { zonedDate } from '../../common/zoned-date';
import type { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { AdminPrincipal, VendorPrincipal } from '../auth/principal';
import { BookingEvents } from '../booking/booking-events';
import { isLapsed, toEvent } from '../booking/booking-mapper';
import { BookingStateService } from '../booking/booking-state.service';
import { MarketService } from '../market/market.service';
import {
  ADMIN_ENTRY_FIELDS,
  ENTRY_FIELDS,
  OPEN_STATUSES,
  aheadOf,
  toAdminEntry,
  toEntry,
} from './waitlist-mapper';

const ACTIVE = [...ACTIVE_BOOKING_STATUSES];

/** คิวรอล็อค (Overview §9.7): เข้า/ออกคิว, รายการของผู้ค้า, หน้าจัดการของ admin */
@Injectable()
export class WaitlistService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly markets: MarketService,
    private readonly state: BookingStateService,
    private readonly events: BookingEvents,
  ) {}

  /**
   * เข้าคิวได้เมื่อ "เต็ม" จริงเท่านั้น: ล็อคมีคนจองอยู่ / โซนไม่มีล็อคว่าง (ว่างอยู่ = จองได้เลย)
   * ต้องเป็นวันขายที่ยังไม่ยกเลิก ของรอบที่เผยแพร่ และประเภทสินค้าขายในโซนนั้นได้
   */
  async join(
    vendor: VendorPrincipal,
    input: JoinWaitlistInput,
    now = new Date(),
  ): Promise<WaitlistEntry> {
    const id = await this.prisma.$transaction(async (tx) => {
      // ลำดับคิว + โควตาคิวต่อวัน ไม่ชนกันเมื่อกดพร้อมกัน
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${input.marketDayId}), 0)`;

      const day = await tx.marketDay.findFirst({
        where: { id: input.marketDayId, marketId: vendor.marketId },
        select: { isCancelled: true, round: { select: { status: true } } },
      });
      if (!day) throw new AppException(ErrorCode.NOT_FOUND, 'Market day not found');
      if (day.isCancelled || day.round.status !== 'PUBLISHED') {
        throw new AppException(ErrorCode.ROUND_NOT_OPEN, 'Market day is not open for booking');
      }

      const zoneId = input.stallId
        ? await this.assertStallFull(tx, vendor, input.marketDayId, input.stallId, now)
        : await this.assertZoneFull(tx, vendor.marketId, input.marketDayId, input.zoneId!, now);
      await this.assertCategoryAllowed(tx, vendor.id, zoneId);

      const open = await tx.waitlist.findMany({
        where: {
          vendorId: vendor.id,
          marketDayId: input.marketDayId,
          status: { in: OPEN_STATUSES },
        },
        select: { stallId: true, zoneId: true },
      });
      const duplicate = open.some((w) =>
        input.stallId ? w.stallId === input.stallId : w.stallId === null && w.zoneId === zoneId,
      );
      if (duplicate) {
        throw new AppException(ErrorCode.WAITLIST_ALREADY_JOINED, 'Already in this waitlist');
      }
      if (open.length >= MAX_WAITLIST_PER_DAY) {
        throw new AppException(ErrorCode.WAITLIST_LIMIT_REACHED, 'Waitlist limit reached', {
          limit: MAX_WAITLIST_PER_DAY,
        });
      }

      const last = await tx.waitlist.aggregate({
        where: { marketDayId: input.marketDayId },
        _max: { position: true },
      });
      const row = await tx.waitlist.create({
        data: {
          vendorId: vendor.id,
          marketDayId: input.marketDayId,
          stallId: input.stallId ?? null,
          zoneId,
          position: (last._max.position ?? 0) + 1,
        },
        select: { id: true },
      });
      return row.id;
    });
    return this.mine(vendor, id);
  }

  /** คิวของผู้ค้าในวันขายที่ยังไม่ผ่านไป (รวมที่จบแล้วของวันนั้น ให้เห็นผล) */
  async listMine(vendor: VendorPrincipal): Promise<WaitlistEntry[]> {
    const market = await this.prisma.market.findUniqueOrThrow({
      where: { id: vendor.marketId },
      select: { timezone: true },
    });
    const today = zonedDate(new Date(), market.timezone);
    const rows = await this.prisma.waitlist.findMany({
      where: {
        vendorId: vendor.id,
        marketDay: { marketDate: { gte: new Date(`${today}T00:00:00Z`) } },
      },
      select: ENTRY_FIELDS,
      orderBy: [{ marketDay: { marketDate: 'asc' } }, { position: 'asc' }],
    });
    return this.withAhead(rows, toEntry);
  }

  /** ออกจากคิว — ได้สิทธิ์อยู่ (NOTIFIED) = สละ HOLD นั้นด้วย แล้วสิทธิ์ส่งต่อคิวถัดไปเอง */
  async leave(vendor: VendorPrincipal, id: string): Promise<WaitlistEntry> {
    const row = await this.prisma.waitlist.findFirst({
      where: { id, vendorId: vendor.id },
      select: { id: true, status: true, offerBookingId: true },
    });
    if (!row) throw new AppException(ErrorCode.NOT_FOUND, 'Waitlist entry not found');
    await this.cancelEntry(row, 'สละสิทธิ์จากคิวรอ', null);
    return this.mine(vendor, id);
  }

  async listForDay(admin: AdminPrincipal, marketDayId: string): Promise<AdminWaitlistEntry[]> {
    const marketId = await this.markets.resolveForAdmin(admin);
    const rows = await this.prisma.waitlist.findMany({
      where: { marketDayId, marketDay: { marketId } },
      select: ADMIN_ENTRY_FIELDS,
      orderBy: [{ position: 'asc' }],
    });
    return this.withAhead(rows, toAdminEntry);
  }

  /** เจ้าหน้าที่เอาออกจากคิว (เช่น ผู้ค้าแจ้งยกเลิกทางโทรศัพท์) — ลง audit log */
  async removeByAdmin(admin: AdminPrincipal, id: string): Promise<AdminWaitlistEntry> {
    const marketId = await this.markets.resolveForAdmin(admin);
    const row = await this.prisma.waitlist.findFirst({
      where: { id, marketDay: { marketId } },
      select: { id: true, status: true, offerBookingId: true, vendorId: true, marketDayId: true },
    });
    if (!row) throw new AppException(ErrorCode.NOT_FOUND, 'Waitlist entry not found');
    await this.cancelEntry(row, 'เจ้าหน้าที่นำออกจากคิวรอ', admin.id);
    await this.audit.log({
      actorType: 'ADMIN',
      actorId: admin.id,
      action: 'waitlist.remove',
      entity: { type: 'waitlist', id },
      before: { status: row.status },
      after: { status: 'CANCELLED', vendorId: row.vendorId, marketDayId: row.marketDayId },
    });
    const [entry] = await this.withAhead(
      await this.prisma.waitlist.findMany({ where: { id }, select: ADMIN_ENTRY_FIELDS }),
      toAdminEntry,
    );
    return entry!;
  }

  // ───────────── ภายใน ─────────────

  /** WAITING → CANCELLED; NOTIFIED → ยกเลิก HOLD (event ทำให้คิว CANCELLED + ส่งต่อคิวถัดไป) */
  private async cancelEntry(
    row: { id: string; status: string; offerBookingId: string | null },
    reason: string,
    adminId: string | null,
  ): Promise<void> {
    if (row.status === 'WAITING') {
      await this.prisma.waitlist.updateMany({
        where: { id: row.id, status: 'WAITING' },
        data: { status: 'CANCELLED' },
      });
      return;
    }
    if (row.status === 'NOTIFIED' && row.offerBookingId) {
      const booking = await this.state.transition(
        this.prisma,
        row.offerBookingId,
        [BookingStatus.HOLD],
        BookingStatus.CANCELLED,
        { cancelledAt: new Date(), cancelReason: reason, cancelledByAdminId: adminId },
      );
      this.events.emitChanged([toEvent(booking)]);
      // listener จะเปลี่ยนเป็น CANCELLED ด้วย — ทำไว้ก่อนให้คำตอบของ request นี้ถูกต้องทันที
      await this.prisma.waitlist.updateMany({
        where: { id: row.id, status: 'NOTIFIED' },
        data: { status: 'CANCELLED' },
      });
      return;
    }
    throw new AppException(ErrorCode.INVALID_STATE_TRANSITION, `Waitlist entry is ${row.status}`, {
      status: row.status,
    });
  }

  /** ล็อคต้องมีคนอื่นจองอยู่ (ถ้าว่าง = จองได้เลย, ถ้าเป็นของตัวเอง = ไม่ต้องรอ) — คืน zoneId ของล็อค */
  private async assertStallFull(
    tx: Prisma.TransactionClient,
    vendor: VendorPrincipal,
    marketDayId: string,
    stallId: string,
    now: Date,
  ): Promise<string> {
    const stall = await tx.stall.findFirst({
      where: { id: stallId, marketId: vendor.marketId },
      select: {
        zoneId: true,
        isActive: true,
        isReserved: true,
        overrides: { where: { marketDayId }, select: { isClosed: true } },
      },
    });
    if (!stall) throw new AppException(ErrorCode.NOT_FOUND, 'Stall not found');
    if (!stall.isActive || stall.isReserved || stall.overrides[0]?.isClosed) {
      throw new AppException(ErrorCode.STALL_UNAVAILABLE, 'Stall is not open for booking');
    }
    const bookings = await tx.booking.findMany({
      where: { marketDayId, stallId, status: { in: ACTIVE } },
      select: { vendorId: true, status: true, holdExpiresAt: true, paymentDueAt: true },
    });
    const holder = bookings.find((b) => !isLapsed(b, now));
    if (!holder || holder.vendorId === vendor.id) {
      throw new AppException(ErrorCode.WAITLIST_NOT_NEEDED, 'Stall is available');
    }
    return stall.zoneId;
  }

  private async assertZoneFull(
    tx: Prisma.TransactionClient,
    marketId: string,
    marketDayId: string,
    zoneId: string,
    now: Date,
  ): Promise<string> {
    const zone = await tx.zone.findFirst({ where: { id: zoneId, marketId }, select: { id: true } });
    if (!zone) throw new AppException(ErrorCode.NOT_FOUND, 'Zone not found');
    const stalls = await tx.stall.findMany({
      where: {
        zoneId,
        isActive: true,
        isReserved: false,
        NOT: { overrides: { some: { marketDayId, isClosed: true } } },
      },
      select: {
        bookings: {
          where: { marketDayId, status: { in: ACTIVE } },
          select: { status: true, holdExpiresAt: true, paymentDueAt: true },
        },
      },
    });
    const free = stalls.some((s) => !s.bookings.some((b) => !isLapsed(b, now)));
    if (free) throw new AppException(ErrorCode.WAITLIST_NOT_NEEDED, 'Zone has available stalls');
    return zoneId;
  }

  private async assertCategoryAllowed(
    tx: Prisma.TransactionClient,
    vendorId: string,
    zoneId: string,
  ): Promise<void> {
    const [zone, vendor] = await Promise.all([
      tx.zone.findUniqueOrThrow({ where: { id: zoneId }, select: { allowedCategoryIds: true } }),
      tx.vendor.findUniqueOrThrow({ where: { id: vendorId }, select: { productCategoryId: true } }),
    ]);
    const allowed = zone.allowedCategoryIds;
    if (
      allowed.length > 0 &&
      (!vendor.productCategoryId || !allowed.includes(vendor.productCategoryId))
    ) {
      throw new AppException(
        ErrorCode.CATEGORY_NOT_ALLOWED,
        'Product category is not allowed in this zone',
      );
    }
  }

  private async mine(vendor: VendorPrincipal, id: string): Promise<WaitlistEntry> {
    const rows = await this.prisma.waitlist.findMany({
      where: { id, vendorId: vendor.id },
      select: ENTRY_FIELDS,
    });
    const [entry] = await this.withAhead(rows, toEntry);
    if (!entry) throw new AppException(ErrorCode.NOT_FOUND, 'Waitlist entry not found');
    return entry;
  }

  /** เติมจำนวนคิวก่อนหน้าจากคิว WAITING ของวันขายที่เกี่ยวข้อง */
  private async withAhead<R extends { marketDayId: string } & Parameters<typeof aheadOf>[0], T>(
    rows: R[],
    map: (row: R, ahead: number) => T,
  ): Promise<T[]> {
    const dayIds = [...new Set(rows.map((r) => r.marketDayId))];
    const waiting = dayIds.length
      ? await this.prisma.waitlist.findMany({
          where: { marketDayId: { in: dayIds }, status: 'WAITING' },
          select: { id: true, marketDayId: true, stallId: true, zoneId: true, position: true },
        })
      : [];
    return rows.map((r) =>
      map(
        r,
        aheadOf(
          r,
          waiting.filter((w) => w.marketDayId === r.marketDayId),
        ),
      ),
    );
  }
}
