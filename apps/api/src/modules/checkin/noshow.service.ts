import { Injectable, Logger } from '@nestjs/common';
import { BookingStatus, ErrorCode, VendorStatus, checkinWindow } from '@market-booking/shared';
import { AppException } from '../../common/exceptions/app.exception';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationService } from '../notify/notification.service';
import { compareStalls } from '../market-setup/stall-mapper';
import { fromIsoDate, toIsoDate } from '../round/round-rules';
import { SettingsService } from '../settings/settings.service';
import { VendorStatusService } from '../vendor/vendor-status.service';

const DAY_MS = 24 * 3_600_000;
/**
 * นับเฉพาะวันขายที่ปิด check-in ไม่เกินกี่วัน — worker หยุดนานก็ยังเก็บตกได้
 * แต่ไม่ย้อนนับวันเก่าตอนเปิดใช้ครั้งแรก (ข้อมูลก่อนมีระบบ check-in)
 */
export const NOSHOW_LOOKBACK_DAYS = 3;

interface VendorNoShow {
  vendorId: string;
  stallCodes: string[];
  count: number;
  status: VendorStatus;
}

/**
 * No-show (Overview §9.8 ข้อ 3–4): หลัง `checkin_close_at` การจองที่ CONFIRMED แต่ไม่ check-in
 * → `bookings.noshow_at`, ผู้ค้า `noshow_count + 1` (ครั้งเดียวต่อวันขาย แม้จองหลายล็อค)
 * ครบทุก `noshow_threshold` ครั้ง (3, 6, 9, …) → ระงับ `noshow_suspend_days` วัน; ไม่ถึง → แจ้งเตือน
 */
@Injectable()
export class NoShowService {
  private readonly logger = new Logger(NoShowService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    private readonly notifications: NotificationService,
    private readonly vendorStatus: VendorStatusService,
  ) {}

  /** ตรวจวันขายที่ปิด check-in แล้วและยังไม่นับ — คืนจำนวนผู้ค้าที่ถูกนับ */
  async sweep(now: Date = new Date()): Promise<number> {
    const today = toIsoDate(new Date(now.getTime() + 7 * 3_600_000));
    const days = await this.prisma.marketDay.findMany({
      where: {
        isCancelled: false,
        noshowProcessedAt: null,
        round: { status: 'PUBLISHED' },
        marketDate: {
          gte: new Date(fromIsoDate(today).getTime() - (NOSHOW_LOOKBACK_DAYS + 1) * DAY_MS),
          lte: fromIsoDate(today),
        },
      },
      select: { id: true, marketDate: true, checkinOpenAt: true, checkinCloseAt: true },
    });
    let counted = 0;
    for (const day of days) {
      const { closeAt } = checkinWindow({ ...day, marketDate: toIsoDate(day.marketDate) });
      if (closeAt > now || now.getTime() - closeAt.getTime() > NOSHOW_LOOKBACK_DAYS * DAY_MS) {
        continue;
      }
      counted += await this.processDay(day.id, toIsoDate(day.marketDate), now);
    }
    return counted;
  }

  async processDay(marketDayId: string, marketDate: string, now: Date): Promise<number> {
    const result = await this.prisma.$transaction(async (tx) => {
      // จองวันนี้ไว้ก่อน — หลาย instance/รอบซ้อนกันนับครั้งเดียว
      const claim = await tx.marketDay.updateMany({
        where: { id: marketDayId, noshowProcessedAt: null },
        data: { noshowProcessedAt: now },
      });
      if (claim.count === 0) return null;

      const missed = await tx.booking.findMany({
        where: { marketDayId, status: BookingStatus.CONFIRMED, checkedInAt: null },
        select: { id: true, vendorId: true, marketId: true, stall: { select: { code: true } } },
      });
      if (missed.length === 0) return { marketId: null, vendors: [] as VendorNoShow[] };

      await tx.booking.updateMany({
        where: { id: { in: missed.map((b) => b.id) } },
        data: { noshowAt: now },
      });
      const byVendor = new Map<string, string[]>();
      for (const b of missed) {
        byVendor.set(b.vendorId, [...(byVendor.get(b.vendorId) ?? []), b.stall.code]);
      }
      const vendors: VendorNoShow[] = [];
      for (const [vendorId, codes] of byVendor) {
        const v = await tx.vendor.update({
          where: { id: vendorId },
          data: { noshowCount: { increment: 1 } },
          select: { noshowCount: true, status: true },
        });
        const stallCodes = codes.sort((a, b) => compareStalls({ code: a }, { code: b }));
        vendors.push({ vendorId, stallCodes, count: v.noshowCount, status: v.status });
        await this.audit.log(
          {
            actorType: 'SYSTEM',
            action: 'vendor.noshow',
            entity: { type: 'vendor', id: vendorId },
            before: { noshowCount: v.noshowCount - 1 },
            after: { noshowCount: v.noshowCount, marketDate, stallCodes },
          },
          tx,
        );
      }
      return { marketId: missed[0]!.marketId, vendors };
    });
    if (!result?.marketId) return 0;

    const threshold = await this.settings.get(result.marketId, 'noshow_threshold');
    const suspendDays = await this.settings.get(result.marketId, 'noshow_suspend_days');
    for (const v of result.vendors) {
      const reachedLimit = v.count % threshold === 0;
      if (reachedLimit && v.status === VendorStatus.APPROVED) {
        const suspended = await this.suspend(v, marketDate, threshold, suspendDays, now);
        if (suspended) continue;
      }
      await this.notifications.toVendor(
        v.vendorId,
        {
          template: 'booking.no_show',
          params: { stallCodes: v.stallCodes.join(', '), marketDate, count: v.count, threshold },
        },
        `noshow:${marketDayId}:${v.vendorId}`,
      );
    }
    this.logger.log(`No-show ${marketDate}: ${result.vendors.length} vendor(s)`);
    return result.vendors.length;
  }

  /** ระงับ (แจ้งผู้ค้าผ่าน vendor.suspended) — สถานะเปลี่ยนไปแล้ว (เช่น admin ระงับเอง) = ข้าม */
  private async suspend(
    v: VendorNoShow,
    marketDate: string,
    threshold: number,
    days: number,
    now: Date,
  ): Promise<boolean> {
    try {
      await this.vendorStatus.transition(v.vendorId, 'suspend', {
        actorType: 'SYSTEM',
        actorId: null,
        reason: `ไม่มาขาย (ไม่ได้ check-in) ครบ ${threshold} ครั้ง — ล่าสุดวันขาย ${marketDate}`,
        data: { suspendedUntil: new Date(now.getTime() + days * DAY_MS) },
      });
      return true;
    } catch (error) {
      if (error instanceof AppException && error.code === ErrorCode.INVALID_STATE_TRANSITION) {
        return false;
      }
      throw error;
    }
  }
}
