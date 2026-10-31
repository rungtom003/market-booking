import { Injectable } from '@nestjs/common';
import {
  ErrorCode,
  MapZone,
  MarketDayStalls,
  MarketLayout,
  StallDayStatus,
} from '@market-booking/shared';
import { AppException } from '../../common/exceptions/app.exception';
import { PrismaService } from '../../prisma/prisma.service';
import { compareStalls, toMapStall } from './stall-mapper';

const GEOMETRY = {
  id: true,
  zoneId: true,
  code: true,
  widthM: true,
  lengthM: true,
  price: true,
  posX: true,
  posY: true,
  rot: true,
  shapeW: true,
  shapeH: true,
  isReserved: true,
} as const;

/** ข้อมูลวาดผังตลาดฝั่งผู้ค้า — เฉพาะล็อคที่เปิดใช้งาน */
@Injectable()
export class MarketLayoutService {
  constructor(private readonly prisma: PrismaService) {}

  async layout(marketId: string): Promise<MarketLayout> {
    const [zones, stalls] = await Promise.all([
      this.zones(marketId),
      this.prisma.stall.findMany({ where: { marketId, isActive: true }, select: GEOMETRY }),
    ]);
    return {
      zones,
      stalls: stalls
        .sort(compareStalls)
        .map((s) => ({ ...toMapStall(s), isReserved: s.isReserved })),
    };
  }

  /**
   * ผังของวันขาย — ราคา/การปิดล็อคตาม `stall_day_overrides` ของวันนั้น
   * Phase 3.1 ยังไม่รวมสถานะการจอง (Phase 4.1 เพิ่ม HELD/BOOKED)
   */
  async marketDayStalls(marketId: string, marketDayId: string): Promise<MarketDayStalls> {
    // ตลาดอื่น = ไม่พบ (ไม่บอกว่ามีอยู่)
    const day = await this.prisma.marketDay.findFirst({
      where: { id: marketDayId, marketId },
      select: { id: true, roundId: true, marketDate: true, isCancelled: true },
    });
    if (!day) throw new AppException(ErrorCode.NOT_FOUND, 'Market day not found');

    const [zones, stalls] = await Promise.all([
      this.zones(marketId),
      this.prisma.stall.findMany({
        where: { marketId, isActive: true },
        select: {
          ...GEOMETRY,
          overrides: {
            where: { marketDayId },
            select: { priceOverride: true, isClosed: true },
          },
        },
      }),
    ]);

    return {
      marketDay: {
        id: day.id,
        roundId: day.roundId,
        // คอลัมน์ date — แสดงเป็น YYYY-MM-DD ไม่ผูก timezone
        marketDate: day.marketDate.toISOString().slice(0, 10),
        isCancelled: day.isCancelled,
      },
      zones,
      stalls: stalls.sort(compareStalls).map(({ overrides, isReserved, ...s }) => {
        const override = overrides[0];
        const closed = isReserved || override?.isClosed === true || day.isCancelled;
        return {
          ...toMapStall(s),
          ...(override?.priceOverride != null && { price: Number(override.priceOverride) }),
          status: closed ? StallDayStatus.UNAVAILABLE : StallDayStatus.AVAILABLE,
        };
      }),
    };
  }

  private zones(marketId: string): Promise<MapZone[]> {
    return this.prisma.zone.findMany({
      where: { marketId },
      select: { id: true, name: true, color: true, sortOrder: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }
}
