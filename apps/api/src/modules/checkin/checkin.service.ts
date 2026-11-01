import { Injectable } from '@nestjs/common';
import {
  BookingStatus,
  type CheckinDay,
  type CheckinEntry,
  CheckinPhase,
  type CheckinQr,
  type CheckinResult,
  type CheckinScanInput,
  ErrorCode,
  checkinPhase,
  checkinWindow,
} from '@market-booking/shared';
import { Prisma } from '../../generated/prisma/client';
import { AppException } from '../../common/exceptions/app.exception';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { AdminPrincipal, VendorPrincipal } from '../auth/principal';
import { BookingEvents } from '../booking/booking-events';
import { MarketService } from '../market/market.service';
import { compareStalls } from '../market-setup/stall-mapper';
import { fromIsoDate, toIsoDate } from '../round/round-rules';

const ENTRY_FIELDS = {
  id: true,
  marketId: true,
  marketDayId: true,
  stallId: true,
  vendorId: true,
  status: true,
  checkedInAt: true,
  noshowAt: true,
  stall: { select: { code: true, zone: { select: { name: true } } } },
  vendor: { select: { firstName: true, lastName: true, shopName: true, phone: true } },
  marketDay: {
    select: { marketDate: true, checkinOpenAt: true, checkinCloseAt: true, isCancelled: true },
  },
} satisfies Prisma.BookingSelect;

type EntryRow = Prisma.BookingGetPayload<{ select: typeof ENTRY_FIELDS }>;

function toEntry(row: EntryRow): CheckinEntry {
  return {
    bookingId: row.id,
    stall: { id: row.stallId, code: row.stall.code, zoneName: row.stall.zone.name },
    vendor: {
      id: row.vendorId,
      name: `${row.vendor.firstName} ${row.vendor.lastName}`,
      shopName: row.vendor.shopName,
      phone: row.vendor.phone,
    },
    checkedInAt: row.checkedInAt?.toISOString() ?? null,
    noshow: row.noshowAt !== null,
  };
}

function windowOf(day: {
  marketDate: Date;
  checkinOpenAt: Date | null;
  checkinCloseAt: Date | null;
}) {
  return checkinWindow({ ...day, marketDate: toIsoDate(day.marketDate) });
}

/**
 * Check-in หน้างาน (Overview §9.8): ผู้ค้าแสดง QR (`checkin_token`) → เจ้าหน้าที่สแกน/ค้นหา → `checked_in_at`
 * สแกนซ้ำไม่นับซ้ำ (UPDATE เฉพาะที่ยังไม่ check-in); QR ของวันอื่น/นอกเวลา/ยกเลิกแล้ว → ปฏิเสธ
 */
@Injectable()
export class CheckinService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly markets: MarketService,
    private readonly events: BookingEvents,
  ) {}

  /** QR ของผู้ค้า — เฉพาะการจองของตัวเองที่ยืนยันแล้ว */
  async qr(vendor: VendorPrincipal, bookingId: string): Promise<CheckinQr> {
    const row = await this.prisma.booking.findFirst({
      where: { id: bookingId, vendorId: vendor.id },
      select: { ...ENTRY_FIELDS, checkinToken: true },
    });
    if (!row) throw new AppException(ErrorCode.NOT_FOUND, 'Booking not found');
    if (row.status !== BookingStatus.CONFIRMED || !row.checkinToken) {
      throw new AppException(ErrorCode.INVALID_STATE_TRANSITION, 'Booking is not confirmed', {
        status: row.status,
      });
    }
    const window = windowOf(row.marketDay);
    return {
      bookingId: row.id,
      token: row.checkinToken,
      stallCode: row.stall.code,
      zoneName: row.stall.zone.name,
      marketDate: toIsoDate(row.marketDay.marketDate),
      openAt: window.openAt.toISOString(),
      closeAt: window.closeAt.toISOString(),
      checkedInAt: row.checkedInAt?.toISOString() ?? null,
      noshow: row.noshowAt !== null,
    };
  }

  /** วันขาย (ไม่ยกเลิก) ของวันที่นั้น + การจองที่ยืนยันแล้วทั้งหมด — ไม่มีวันขาย = null */
  async day(admin: AdminPrincipal, date: string, now = new Date()): Promise<CheckinDay | null> {
    const marketId = await this.markets.resolveForAdmin(admin);
    const day = await this.prisma.marketDay.findFirst({
      where: { marketId, marketDate: fromIsoDate(date), isCancelled: false },
      select: {
        id: true,
        marketDate: true,
        checkinOpenAt: true,
        checkinCloseAt: true,
        noshowProcessedAt: true,
      },
    });
    if (!day) return null;
    const rows = await this.prisma.booking.findMany({
      where: { marketDayId: day.id, status: BookingStatus.CONFIRMED },
      select: ENTRY_FIELDS,
    });
    const window = windowOf(day);
    return {
      marketDay: {
        id: day.id,
        marketDate: toIsoDate(day.marketDate),
        openAt: window.openAt.toISOString(),
        closeAt: window.closeAt.toISOString(),
        phase: checkinPhase(window, now),
        noshowProcessed: day.noshowProcessedAt !== null,
      },
      entries: rows.map(toEntry).sort((a, b) => compareStalls(a.stall, b.stall)),
    };
  }

  /** สแกน QR — token ต้องเป็นของตลาดนี้และของวันขายที่เจ้าหน้าที่เลือกอยู่ */
  async scan(admin: AdminPrincipal, input: CheckinScanInput, now = new Date()) {
    const marketId = await this.markets.resolveForAdmin(admin);
    const row = await this.prisma.booking.findUnique({
      where: { checkinToken: input.token },
      select: ENTRY_FIELDS,
    });
    if (!row || row.marketId !== marketId) {
      throw new AppException(ErrorCode.CHECKIN_INVALID, 'Unknown check-in token');
    }
    if (row.marketDayId !== input.marketDayId) {
      throw new AppException(ErrorCode.CHECKIN_WRONG_DAY, 'Token is for another market day', {
        marketDate: toIsoDate(row.marketDay.marketDate),
      });
    }
    return this.checkIn(admin, row, 'scan', now);
  }

  /** ค้นหาแล้วกด check-in (สำรองเมื่อสแกนไม่ได้) */
  async manual(admin: AdminPrincipal, bookingId: string, now = new Date()) {
    const marketId = await this.markets.resolveForAdmin(admin);
    const row = await this.prisma.booking.findFirst({
      where: { id: bookingId, marketId },
      select: ENTRY_FIELDS,
    });
    if (!row) throw new AppException(ErrorCode.NOT_FOUND, 'Booking not found');
    return this.checkIn(admin, row, 'manual', now);
  }

  private async checkIn(
    admin: AdminPrincipal,
    row: EntryRow,
    method: 'scan' | 'manual',
    now: Date,
  ): Promise<CheckinResult> {
    if (row.status !== BookingStatus.CONFIRMED || row.marketDay.isCancelled) {
      throw new AppException(ErrorCode.CHECKIN_INVALID, 'Booking is not confirmed', {
        status: row.marketDay.isCancelled ? BookingStatus.CANCELLED : row.status,
      });
    }
    const result = (entry: CheckinEntry, alreadyCheckedIn: boolean): CheckinResult => ({
      alreadyCheckedIn,
      marketDayId: row.marketDayId,
      entry,
    });
    // check-in แล้วตอบเหมือนเดิมแม้นอกเวลา — เจ้าหน้าที่ต้องรู้ว่า "เข้าแล้ว" ไม่ใช่ "ปิดแล้ว"
    if (row.checkedInAt) return result(toEntry(row), true);

    const window = windowOf(row.marketDay);
    const phase = checkinPhase(window, now);
    if (phase === CheckinPhase.NOT_OPEN) {
      throw new AppException(ErrorCode.CHECKIN_NOT_OPEN, 'Check-in is not open yet', {
        openAt: window.openAt.toISOString(),
      });
    }
    if (phase === CheckinPhase.CLOSED) {
      throw new AppException(ErrorCode.CHECKIN_CLOSED, 'Check-in is closed', {
        closeAt: window.closeAt.toISOString(),
      });
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      // สแกนพร้อมกัน 2 เครื่อง → นับครั้งเดียว อีกเครื่องได้ "check-in แล้ว"
      const { count } = await tx.booking.updateMany({
        where: { id: row.id, status: BookingStatus.CONFIRMED, checkedInAt: null },
        data: { checkedInAt: now },
      });
      if (count === 1) {
        await this.audit.log(
          {
            actorType: 'ADMIN',
            actorId: admin.id,
            action: 'booking.checkin',
            entity: { type: 'booking', id: row.id },
            after: { stallCode: row.stall.code, checkedInAt: now.toISOString(), method },
          },
          tx,
        );
      }
      return {
        first: count === 1,
        row: await tx.booking.findUniqueOrThrow({ where: { id: row.id }, select: ENTRY_FIELDS }),
      };
    });
    if (!updated.first) return result(toEntry(updated.row), true);

    this.events.emitCheckedIn({
      bookingId: row.id,
      marketId: row.marketId,
      marketDayId: row.marketDayId,
      stallId: row.stallId,
      vendorId: row.vendorId,
      checkedInAt: now,
    });
    return result(toEntry(updated.row), false);
  }
}
