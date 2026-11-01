import { Injectable } from '@nestjs/common';
import {
  ACTIVE_BOOKING_STATUSES,
  BookingStatus,
  ErrorCode,
  MapZone,
  MarketDayStalls,
  MarketLayout,
  StallDayStatus,
  roundPhase,
} from '@market-booking/shared';
import { AppException } from '../../common/exceptions/app.exception';
import { PrismaService } from '../../prisma/prisma.service';
import { isLapsed } from '../booking/booking-mapper';
import { MapLayoutService } from './map-layout.service';
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly map: MapLayoutService,
  ) {}

  async layout(marketId: string): Promise<MarketLayout> {
    const [zones, stalls, decorations] = await Promise.all([
      this.zones(marketId),
      this.prisma.stall.findMany({ where: { marketId, isActive: true }, select: GEOMETRY }),
      this.map.decorations(marketId),
    ]);
    return {
      ...decorations,
      zones,
      stalls: stalls
        .sort(compareStalls)
        .map((s) => ({ ...toMapStall(s), isReserved: s.isReserved })),
    };
  }

  /**
   * ผังของวันขาย — ราคา/การปิดล็อคตาม `stall_day_overrides` ของวันนั้น + สถานะการจอง
   * `mine`/`bookingId` เฉพาะการจองของ `vendorId` (ไม่ส่งข้อมูลผู้ค้าคนอื่น)
   */
  async marketDayStalls(
    marketId: string,
    marketDayId: string,
    vendorId: string,
    now: Date = new Date(),
  ): Promise<MarketDayStalls> {
    // ตลาดอื่น = ไม่พบ (ไม่บอกว่ามีอยู่)
    const day = await this.prisma.marketDay.findFirst({
      where: { id: marketDayId, marketId },
      select: {
        id: true,
        roundId: true,
        marketDate: true,
        isCancelled: true,
        round: {
          select: {
            name: true,
            status: true,
            openAt: true,
            closeAt: true,
            maxStallsPerVendor: true,
          },
        },
      },
    });
    if (!day) throw new AppException(ErrorCode.NOT_FOUND, 'Market day not found');

    const [zones, stalls, bookings, decorations] = await Promise.all([
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
      this.prisma.booking.findMany({
        where: { marketDayId, status: { in: [...ACTIVE_BOOKING_STATUSES] } },
        select: {
          id: true,
          stallId: true,
          vendorId: true,
          status: true,
          holdExpiresAt: true,
          paymentDueAt: true,
        },
      }),
      this.map.decorations(marketId),
    ]);
    // หมดเวลาแล้วแต่ worker ยังไม่เปลี่ยนสถานะ = ว่าง (จองทับได้ — BookingService expire ให้ตอนจอง)
    const bookingOf = new Map(bookings.filter((b) => !isLapsed(b, now)).map((b) => [b.stallId, b]));

    return {
      marketDay: {
        id: day.id,
        roundId: day.roundId,
        // คอลัมน์ date — แสดงเป็น YYYY-MM-DD ไม่ผูก timezone
        marketDate: day.marketDate.toISOString().slice(0, 10),
        isCancelled: day.isCancelled,
      },
      round: {
        id: day.roundId,
        name: day.round.name,
        status: day.round.status,
        phase: roundPhase(day.round, now),
        openAt: day.round.openAt.toISOString(),
        closeAt: day.round.closeAt.toISOString(),
        maxStallsPerVendor: day.round.maxStallsPerVendor,
      },
      ...decorations,
      // ให้หน้าเว็บหา offset นาฬิกา (Countdown เปิดจอง/hold) จาก request นี้ได้เลย
      serverTime: new Date().toISOString(),
      zones,
      stalls: stalls.sort(compareStalls).map(({ overrides, isReserved, ...s }) => {
        const override = overrides[0];
        const booking = bookingOf.get(s.id);
        const closed = isReserved || override?.isClosed === true || day.isCancelled;
        const mine = booking?.vendorId === vendorId;
        return {
          ...toMapStall(s),
          ...(override?.priceOverride != null && { price: Number(override.priceOverride) }),
          // มีการจองอยู่ แสดงสถานะการจองแม้ล็อคถูกปิดภายหลัง
          status: booking
            ? booking.status === BookingStatus.HOLD
              ? StallDayStatus.HOLD
              : StallDayStatus.BOOKED
            : closed
              ? StallDayStatus.CLOSED
              : StallDayStatus.AVAILABLE,
          mine,
          bookingId: mine ? booking.id : null,
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
