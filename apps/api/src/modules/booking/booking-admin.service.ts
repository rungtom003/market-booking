import { Injectable } from '@nestjs/common';
import {
  ACTIVE_BOOKING_STATUSES,
  BOOKING_STATUS_TH,
  AdminBooking,
  AdminBookingListQuery,
  AdminCreateBookingInput,
  AdminMarketDayOption,
  AdminMarketDayStalls,
  BookingStatus,
  ErrorCode,
  RoundStatus,
} from '@market-booking/shared';
import ExcelJS from 'exceljs';
import { Prisma } from '../../generated/prisma/client';
import { AppException } from '../../common/exceptions/app.exception';
import { PaginatedResult, toSkipTake } from '../../common/pagination/paginated-result';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { AdminPrincipal } from '../auth/principal';
import { MarketService } from '../market/market.service';
import { MarketLayoutService } from '../market-setup/market-layout.service';
import { compareStalls } from '../market-setup/stall-mapper';
import { SettingsService } from '../settings/settings.service';
import { BookingEvents } from './booking-events';
import {
  BOOKING_FIELDS,
  type BookingEventRow,
  type BookingRow,
  isLapsed,
  newCheckinToken,
  toBooking,
  toEvent,
} from './booking-mapper';
import { BookingStateService } from './booking-state.service';

const ACTIVE: BookingStatus[] = [...ACTIVE_BOOKING_STATUSES];
/** วันขายย้อนหลังที่ยังแสดงในตัวเลือก */
const PAST_DAYS_SHOWN = 30;

const VENDOR_FIELDS = {
  id: true,
  firstName: true,
  lastName: true,
  shopName: true,
  phone: true,
} satisfies Prisma.VendorSelect;

const ADMIN_BOOKING_FIELDS = {
  ...BOOKING_FIELDS,
  vendor: { select: VENDOR_FIELDS },
} satisfies Prisma.BookingSelect;

type AdminBookingRow = Prisma.BookingGetPayload<{ select: typeof ADMIN_BOOKING_FIELDS }>;

const toVendor = (v: AdminBookingRow['vendor']) => ({
  id: v.id,
  name: `${v.firstName} ${v.lastName}`,
  shopName: v.shopName,
  phone: v.phone,
});

function toAdminBooking(row: AdminBookingRow, now: Date): AdminBooking {
  return { ...toBooking(row as BookingRow, now), vendor: toVendor(row.vendor) };
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

/** จัดการการจองฝั่ง admin (Phase 4.5): รายการ, ผังพร้อมชื่อผู้ค้า, จองแทน, export */
@Injectable()
export class BookingAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly markets: MarketService,
    private readonly settings: SettingsService,
    private readonly layout: MarketLayoutService,
    private readonly state: BookingStateService,
    private readonly events: BookingEvents,
  ) {}

  async list(
    admin: AdminPrincipal,
    query: AdminBookingListQuery,
  ): Promise<PaginatedResult<AdminBooking>> {
    const marketId = await this.markets.resolveForAdmin(admin);
    const q = query.q;
    const where: Prisma.BookingWhereInput = {
      marketId,
      marketDayId: query.marketDayId,
      ...(query.status === 'ACTIVE'
        ? { status: { in: ACTIVE } }
        : query.status && { status: query.status }),
      ...(q && {
        OR: [
          { vendor: { firstName: { contains: q, mode: 'insensitive' } } },
          { vendor: { lastName: { contains: q, mode: 'insensitive' } } },
          { vendor: { shopName: { contains: q, mode: 'insensitive' } } },
          { vendor: { phone: { contains: q.replace(/[\s-]/g, '') } } },
          { stall: { code: { contains: q.toUpperCase() } } },
        ],
      }),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.booking.findMany({
        where,
        select: ADMIN_BOOKING_FIELDS,
        orderBy: [{ marketDay: { marketDate: 'desc' } }, { createdAt: 'desc' }],
        ...toSkipTake(query),
      }),
      this.prisma.booking.count({ where }),
    ]);
    const now = new Date();
    return PaginatedResult.of(
      rows.map((r) => toAdminBooking(r, now)),
      total,
      query,
    );
  }

  /** วันขายของรอบที่เผยแพร่แล้ว/ยกเลิก ตั้งแต่ 30 วันก่อน เรียงตามวันที่ */
  async days(admin: AdminPrincipal): Promise<AdminMarketDayOption[]> {
    const marketId = await this.markets.resolveForAdmin(admin);
    const since = new Date(Date.now() - PAST_DAYS_SHOWN * 86_400_000);
    const rows = await this.prisma.marketDay.findMany({
      where: {
        marketId,
        marketDate: { gte: since },
        round: { status: { not: RoundStatus.DRAFT } },
      },
      select: {
        id: true,
        marketDate: true,
        isCancelled: true,
        round: { select: { id: true, name: true } },
        _count: { select: { bookings: { where: { status: { in: ACTIVE } } } } },
      },
      orderBy: [{ marketDate: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map((d) => ({
      id: d.id,
      marketDate: d.marketDate.toISOString().slice(0, 10),
      roundId: d.round.id,
      roundName: d.round.name,
      isCancelled: d.isCancelled,
      activeBookings: d._count.bookings,
    }));
  }

  /** ผังวันขายพร้อมการจองและชื่อผู้ค้าของแต่ละล็อค — เฉพาะ admin */
  async dayStalls(admin: AdminPrincipal, marketDayId: string): Promise<AdminMarketDayStalls> {
    const marketId = await this.markets.resolveForAdmin(admin);
    const now = new Date();
    // ไม่มีผู้ค้าคนไหน "เป็นเจ้าของ" ในมุมมอง admin → mine เป็น false ทั้งหมด
    const base = await this.layout.marketDayStalls(marketId, marketDayId, '', now);
    const bookings = await this.activeBookings(marketDayId, now);
    const byStall = new Map(bookings.map((b) => [b.stallId, b]));
    return {
      ...base,
      stalls: base.stalls.map((s) => {
        const b = byStall.get(s.id);
        return {
          ...s,
          booking: b
            ? {
                id: b.id,
                status: b.status,
                amount: Number(b.amount),
                holdExpiresAt: b.holdExpiresAt?.toISOString() ?? null,
                paymentDueAt: b.paymentDueAt?.toISOString() ?? null,
                checkedInAt: b.checkedInAt?.toISOString() ?? null,
                vendor: toVendor(b.vendor),
              }
            : null,
        };
      }),
    };
  }

  /**
   * จองแทนผู้ค้า — ข้ามรอบ/โควตา/ล็อคสงวน/ปิดเฉพาะวัน/ประเภทสินค้า (admin ตัดสินใจเอง)
   * แต่ผู้ค้าต้อง APPROVED, ล็อคต้องเปิดใช้งาน, วันขายต้องไม่ถูกยกเลิก และไม่ข้าม unique index
   */
  async create(admin: AdminPrincipal, input: AdminCreateBookingInput): Promise<AdminBooking> {
    const marketId = await this.markets.resolveForAdmin(admin);
    const [vendor, day, stall] = await Promise.all([
      this.prisma.vendor.findFirst({
        where: { id: input.vendorId, marketId },
        select: { status: true },
      }),
      this.prisma.marketDay.findFirst({
        where: { id: input.marketDayId, marketId },
        select: { isCancelled: true, round: { select: { status: true } } },
      }),
      this.prisma.stall.findFirst({
        where: { id: input.stallId, marketId },
        select: {
          isActive: true,
          price: true,
          overrides: { where: { marketDayId: input.marketDayId }, select: { priceOverride: true } },
        },
      }),
    ]);
    if (!vendor) throw new AppException(ErrorCode.NOT_FOUND, 'Vendor not found');
    if (!day) throw new AppException(ErrorCode.NOT_FOUND, 'Market day not found');
    if (!stall) throw new AppException(ErrorCode.NOT_FOUND, 'Stall not found');
    if (vendor.status !== 'APPROVED') {
      throw new AppException(ErrorCode.VENDOR_NOT_APPROVED, 'Vendor is not approved', {
        status: vendor.status,
      });
    }
    if (day.isCancelled || day.round.status === RoundStatus.CANCELLED) {
      throw new AppException(ErrorCode.INVALID_STATE_TRANSITION, 'Market day is cancelled', {
        isCancelled: true,
      });
    }
    if (!stall.isActive) {
      throw new AppException(ErrorCode.STALL_UNAVAILABLE, 'Stall is inactive');
    }

    const now = new Date();
    const paymentDeadline =
      input.status === BookingStatus.PENDING_PAYMENT
        ? await this.settings.get(marketId, 'payment_deadline_minutes')
        : 0;
    const changed: BookingEventRow[] = [];
    try {
      const row = await this.prisma.$transaction(async (tx) => {
        changed.push(
          ...(await this.state.expireLapsed(
            tx,
            { marketDayId: input.marketDayId, stallId: input.stallId },
            now,
          )),
        );
        const booking = await tx.booking.create({
          data: {
            marketId,
            vendorId: input.vendorId,
            stallId: input.stallId,
            marketDayId: input.marketDayId,
            status: input.status,
            amount: input.amount ?? stall.overrides[0]?.priceOverride ?? stall.price,
            ...(input.status === BookingStatus.CONFIRMED
              ? { confirmedAt: now, checkinToken: newCheckinToken() }
              : { paymentDueAt: new Date(now.getTime() + paymentDeadline * 60_000) }),
          },
          select: ADMIN_BOOKING_FIELDS,
        });
        await this.audit.log(
          {
            actorType: 'ADMIN',
            actorId: admin.id,
            action: 'booking.create_by_admin',
            entity: { type: 'booking', id: booking.id },
            after: {
              vendorId: input.vendorId,
              stallCode: booking.stall.code,
              marketDate: booking.marketDay.marketDate.toISOString().slice(0, 10),
              status: booking.status,
              amount: Number(booking.amount),
            },
          },
          tx,
        );
        changed.push(booking);
        return booking;
      });
      this.events.emitChanged(changed.map(toEvent));
      return toAdminBooking(row, now);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new AppException(ErrorCode.STALL_TAKEN, 'Stall is already taken', { mine: false });
      }
      throw error;
    }
  }

  /** รายชื่อผู้ค้าของวันขาย (การจองที่ยังมีผล) เป็นไฟล์ xlsx เรียงตามรหัสล็อค */
  async exportDay(
    admin: AdminPrincipal,
    marketDayId: string,
  ): Promise<{ filename: string; buffer: Buffer }> {
    const marketId = await this.markets.resolveForAdmin(admin);
    const day = await this.prisma.marketDay.findFirst({
      where: { id: marketDayId, marketId },
      select: { marketDate: true, round: { select: { name: true } } },
    });
    if (!day) throw new AppException(ErrorCode.NOT_FOUND, 'Market day not found');
    const date = day.marketDate.toISOString().slice(0, 10);
    const rows = (await this.activeBookings(marketDayId, new Date())).sort((a, b) =>
      compareStalls(a.stall, b.stall),
    );

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('รายชื่อผู้ค้า', {
      views: [{ state: 'frozen', ySplit: 1 }],
    });
    sheet.columns = [
      { header: 'ล็อค', key: 'code', width: 10 },
      { header: 'โซน', key: 'zone', width: 16 },
      { header: 'ชื่อผู้ค้า', key: 'name', width: 28 },
      { header: 'ชื่อร้าน', key: 'shop', width: 24 },
      { header: 'เบอร์โทร', key: 'phone', width: 14 },
      { header: 'สถานะ', key: 'status', width: 14 },
      { header: 'ราคา (บาท)', key: 'amount', width: 12, style: { numFmt: '#,##0.00' } },
    ];
    sheet.getRow(1).font = { bold: true };
    for (const b of rows) {
      sheet.addRow({
        code: b.stall.code,
        zone: b.stall.zone.name,
        name: `${b.vendor.firstName} ${b.vendor.lastName}`,
        shop: b.vendor.shopName ?? '',
        phone: b.vendor.phone,
        status: BOOKING_STATUS_TH[b.status],
        amount: Number(b.amount),
      });
    }
    await this.audit.log({
      actorType: 'ADMIN',
      actorId: admin.id,
      action: 'booking.export',
      entity: { type: 'market_day', id: marketDayId },
      after: { marketDate: date, rows: rows.length },
    });
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    return { filename: `bookings-${date}.xlsx`, buffer };
  }

  /** การจองที่ยังมีผลของวันขาย (ไม่รวมที่หมดเวลาแล้วแต่ worker ยังไม่เปลี่ยน) */
  private async activeBookings(marketDayId: string, now: Date) {
    const rows = await this.prisma.booking.findMany({
      where: { marketDayId, status: { in: ACTIVE } },
      select: {
        id: true,
        stallId: true,
        status: true,
        amount: true,
        holdExpiresAt: true,
        paymentDueAt: true,
        checkedInAt: true,
        vendor: { select: VENDOR_FIELDS },
        stall: { select: { code: true, zone: { select: { name: true } } } },
      },
    });
    return rows.filter((r) => !isLapsed(r, now));
  }
}
