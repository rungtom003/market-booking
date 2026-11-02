import { Injectable, Logger } from '@nestjs/common';
import { RETENTION_DAYS } from '@market-booking/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { PrivacyService } from './privacy.service';

const DAY_MS = 24 * 3_600_000;
const BATCH = 200;

export interface RetentionResult {
  notifications: number;
  slips: number;
  vendors: number;
}

/**
 * นโยบายเก็บข้อมูล (PDPA, Phase 11.3 — `RETENTION_DAYS`) ทำทุกวัน:
 * - ประวัติข้อความแจ้งเตือนที่ส่งจบแล้วเกิน 180 วัน → ลบ
 * - รูปสลิปของวันขายที่ผ่านมาเกิน 365 วัน → ลบไฟล์ (ยอด/สถานะการชำระยังอยู่)
 * - ผู้ค้าที่ถูกปฏิเสธและไม่ได้ส่งใหม่เกิน 180 วัน (ไม่มีการจอง) → ลบข้อมูลส่วนบุคคล
 */
@Injectable()
export class RetentionService {
  private readonly logger = new Logger(RetentionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly privacy: PrivacyService,
  ) {}

  async sweep(now = new Date()): Promise<RetentionResult> {
    const before = (days: number) => new Date(now.getTime() - days * DAY_MS);

    const { count: notifications } = await this.prisma.notificationLog.deleteMany({
      where: {
        createdAt: { lt: before(RETENTION_DAYS.notificationLogs) },
        status: { in: ['SENT', 'FAILED'] },
      },
    });

    let slips = 0;
    for (;;) {
      const rows = await this.prisma.payment.findMany({
        where: {
          slipImageKey: { not: null },
          booking: { marketDay: { marketDate: { lt: before(RETENTION_DAYS.slipImages) } } },
        },
        select: { id: true, slipImageKey: true },
        take: BATCH,
      });
      if (rows.length === 0) break;
      for (const row of rows) {
        await this.storage
          .delete(row.slipImageKey!)
          .catch((e: unknown) =>
            this.logger.warn(`Delete ${row.slipImageKey} failed: ${String(e)}`),
          );
      }
      await this.prisma.payment.updateMany({
        where: { id: { in: rows.map((r) => r.id) } },
        data: { slipImageKey: null },
      });
      slips += rows.length;
    }

    const rejected = await this.prisma.vendor.findMany({
      where: {
        status: 'REJECTED',
        deletedAt: null,
        updatedAt: { lt: before(RETENTION_DAYS.rejectedVendors) },
        bookings: { none: {} },
      },
      select: { id: true },
    });
    for (const v of rejected) {
      await this.privacy.erase(v.id, {
        actorType: 'SYSTEM',
        actorId: null,
        reason: `นโยบายเก็บข้อมูล: ไม่ผ่านการอนุมัติและไม่ได้ส่งใหม่เกิน ${RETENTION_DAYS.rejectedVendors} วัน`,
      });
    }

    const result = { notifications, slips, vendors: rejected.length };
    if (notifications + slips + rejected.length > 0) {
      this.logger.log(`Retention: ${JSON.stringify(result)}`);
    }
    return result;
  }
}
