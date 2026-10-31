import { Injectable } from '@nestjs/common';
import {
  ACTIVE_BOOKING_STATUSES,
  CreateRoundInput,
  CurrentRoundResponse,
  ErrorCode,
  Round,
  RoundDetail,
  RoundPhase,
  RoundStatus,
  UpdateRoundInput,
  roundPhase,
} from '@market-booking/shared';
import { Prisma } from '../../generated/prisma/client';
import { AppException } from '../../common/exceptions/app.exception';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { AdminPrincipal } from '../auth/principal';
import { MarketService } from '../market/market.service';
import { SettingsService } from '../settings/settings.service';
import { BookingEvents } from '../booking/booking-events';
import { type BookingEventRow, toEvent } from '../booking/booking-mapper';
import { BookingStateService } from '../booking/booking-state.service';
import { RoundEvents } from './round-events';
import { assertCloseBeforeFirstDay, toIsoDate, validationError } from './round-rules';

const DAY_FIELDS = {
  id: true,
  marketDate: true,
  isCancelled: true,
  _count: {
    select: {
      overrides: true,
      bookings: { where: { status: { in: [...ACTIVE_BOOKING_STATUSES] } } },
    },
  },
} satisfies Prisma.MarketDaySelect;

export const ROUND_FIELDS = {
  id: true,
  marketId: true,
  name: true,
  openAt: true,
  closeAt: true,
  maxStallsPerVendor: true,
  status: true,
  createdAt: true,
  marketDays: { select: DAY_FIELDS, orderBy: { marketDate: 'asc' } },
} satisfies Prisma.BookingRoundSelect;

export type RoundRow = Prisma.BookingRoundGetPayload<{ select: typeof ROUND_FIELDS }>;

type MarketDayDb = Pick<Prisma.TransactionClient, 'marketDay'>;

export function toRoundDetail(row: RoundRow, now: Date): RoundDetail {
  const active = row.marketDays.filter((d) => !d.isCancelled);
  const last = active.at(-1);
  return {
    id: row.id,
    name: row.name,
    openAt: row.openAt.toISOString(),
    closeAt: row.closeAt.toISOString(),
    maxStallsPerVendor: row.maxStallsPerVendor,
    status: row.status,
    phase: roundPhase(row, now),
    marketDayCount: active.length,
    firstMarketDate: active[0] ? toIsoDate(active[0].marketDate) : null,
    lastMarketDate: last ? toIsoDate(last.marketDate) : null,
    createdAt: row.createdAt.toISOString(),
    marketDays: row.marketDays.map((d) => ({
      id: d.id,
      marketDate: toIsoDate(d.marketDate),
      isCancelled: d.isCancelled,
      overrideCount: d._count.overrides,
      bookingCount: d._count.bookings,
    })),
  };
}

/** ค่าที่เก็บใน audit (ไม่รวมวันขาย) */
function snapshot(row: RoundRow) {
  return {
    name: row.name,
    openAt: row.openAt.toISOString(),
    closeAt: row.closeAt.toISOString(),
    maxStallsPerVendor: row.maxStallsPerVendor,
    status: row.status,
  };
}

function invalidState(status: RoundStatus, action: string): AppException {
  return new AppException(
    ErrorCode.INVALID_STATE_TRANSITION,
    `Cannot ${action} a ${status} round`,
    { status },
  );
}

/**
 * รอบการจอง (Overview §8.3, §9.3): DRAFT → PUBLISHED → CANCELLED
 * สถานะเปิด/ปิดจอง (UPCOMING/OPEN/CLOSED) ไม่เก็บใน DB — คำนวณจากเวลา server ด้วย `getPhase`
 */
@Injectable()
export class RoundService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly markets: MarketService,
    private readonly settings: SettingsService,
    private readonly roundEvents: RoundEvents,
    private readonly bookingState: BookingStateService,
    private readonly bookingEvents: BookingEvents,
  ) {}

  getPhase(
    round: { status: RoundStatus; openAt: Date; closeAt: Date },
    now: Date = new Date(),
  ): RoundPhase | null {
    return roundPhase(round, now);
  }

  /**
   * ใช้ก่อนจอง (Phase 4.1): วันขายต้องอยู่ในรอบที่ PUBLISHED, เวลา server อยู่ในช่วง open_at–close_at
   * และวันนั้นไม่ถูกยกเลิก — ไม่งั้น `ROUND_NOT_OPEN`; ส่ง `db` เมื่อเรียกใน transaction
   */
  async assertRoundOpen(
    marketDayId: string,
    opts: { marketId?: string; now?: Date; db?: MarketDayDb } = {},
  ) {
    const now = opts.now ?? new Date();
    const day = await (opts.db ?? this.prisma).marketDay.findFirst({
      where: { id: marketDayId, ...(opts.marketId && { marketId: opts.marketId }) },
      select: {
        id: true,
        marketId: true,
        marketDate: true,
        isCancelled: true,
        round: {
          select: { id: true, status: true, openAt: true, closeAt: true, maxStallsPerVendor: true },
        },
      },
    });
    if (!day) throw new AppException(ErrorCode.NOT_FOUND, 'Market day not found');

    const phase = this.getPhase(day.round, now);
    if (phase !== RoundPhase.OPEN || day.isCancelled) {
      throw new AppException(ErrorCode.ROUND_NOT_OPEN, 'Booking is not open for this market day', {
        phase,
        openAt: day.round.openAt.toISOString(),
        closeAt: day.round.closeAt.toISOString(),
        marketDayCancelled: day.isCancelled,
      });
    }
    return day;
  }

  /** ผู้ค้า: รอบที่เปิดจองอยู่ (ปิดก่อนขึ้นก่อน) ถ้าไม่มี = รอบถัดไปที่เปิดเร็วที่สุด */
  async current(marketId: string, now: Date = new Date()): Promise<CurrentRoundResponse> {
    const rounds = await this.prisma.bookingRound.findMany({
      where: {
        marketId,
        status: RoundStatus.PUBLISHED,
        closeAt: { gt: now },
        marketDays: { some: { isCancelled: false } },
      },
      select: {
        id: true,
        name: true,
        openAt: true,
        closeAt: true,
        maxStallsPerVendor: true,
        marketDays: {
          where: { isCancelled: false },
          select: { id: true, marketDate: true },
          orderBy: { marketDate: 'asc' },
        },
      },
      orderBy: { openAt: 'asc' },
    });
    const open = rounds
      .filter((r) => r.openAt <= now)
      .sort((a, b) => a.closeAt.getTime() - b.closeAt.getTime())[0];
    const round = open ?? rounds[0];

    return {
      serverTime: new Date().toISOString(),
      round: round
        ? {
            id: round.id,
            name: round.name,
            openAt: round.openAt.toISOString(),
            closeAt: round.closeAt.toISOString(),
            maxStallsPerVendor: round.maxStallsPerVendor,
            phase: open ? RoundPhase.OPEN : RoundPhase.UPCOMING,
            marketDays: round.marketDays.map((d) => ({
              id: d.id,
              marketDate: toIsoDate(d.marketDate),
            })),
          }
        : null,
    };
  }

  // ───────────── admin ─────────────

  /** ทุกรอบของตลาด ใหม่สุดก่อน (ไม่แบ่งหน้า — ปีหนึ่งมีไม่กี่สิบรอบ) */
  async list(admin: AdminPrincipal): Promise<Round[]> {
    const marketId = await this.markets.resolveForAdmin(admin);
    const rows = await this.prisma.bookingRound.findMany({
      where: { marketId },
      select: ROUND_FIELDS,
      orderBy: [{ openAt: 'desc' }, { createdAt: 'desc' }],
    });
    const now = new Date();
    return rows.map((row) => {
      const { marketDays: _days, ...round } = toRoundDetail(row, now);
      return round;
    });
  }

  async get(admin: AdminPrincipal, id: string): Promise<RoundDetail> {
    return toRoundDetail(await this.findInScope(admin, id), new Date());
  }

  async create(admin: AdminPrincipal, input: CreateRoundInput): Promise<RoundDetail> {
    const marketId = await this.markets.resolveForAdmin(admin);
    const maxStallsPerVendor =
      input.maxStallsPerVendor ??
      (await this.settings.get(marketId, 'max_stalls_per_vendor_default'));

    return this.prisma.$transaction(async (tx) => {
      const row = await tx.bookingRound.create({
        data: {
          marketId,
          name: input.name,
          openAt: new Date(input.openAt),
          closeAt: new Date(input.closeAt),
          maxStallsPerVendor,
          createdById: admin.id,
        },
        select: ROUND_FIELDS,
      });
      await this.audit.log(
        {
          actorType: 'ADMIN',
          actorId: admin.id,
          action: 'round.create',
          entity: { type: 'booking_round', id: row.id },
          after: snapshot(row),
        },
        tx,
      );
      return toRoundDetail(row, new Date());
    });
  }

  /**
   * แก้ `open_at` ได้เฉพาะก่อนเปิดจอง (PUBLISHED ที่เปิดแล้ว → `ROUND_ALREADY_OPENED`); `close_at` แก้ได้ตลอด
   * แต่ต้องไม่เกินวันขายวันแรก — ทุกการแก้ลง audit log (§8.3)
   */
  async update(
    admin: AdminPrincipal,
    id: string,
    input: UpdateRoundInput,
    now: Date = new Date(),
  ): Promise<RoundDetail> {
    const before = await this.findInScope(admin, id);
    if (before.status === RoundStatus.CANCELLED) throw invalidState(before.status, 'edit');

    const openAt = input.openAt ? new Date(input.openAt) : before.openAt;
    const closeAt = input.closeAt ? new Date(input.closeAt) : before.closeAt;
    if (openAt.getTime() !== before.openAt.getTime() && before.status === RoundStatus.PUBLISHED) {
      if (before.openAt <= now) {
        throw new AppException(ErrorCode.ROUND_ALREADY_OPENED, 'Round has already opened', {
          openAt: before.openAt.toISOString(),
        });
      }
      if (openAt <= now) throw validationError('openAt', 'เวลาเปิดจองต้องเป็นเวลาในอนาคต');
    }
    if (closeAt <= openAt) throw validationError('closeAt', 'เวลาปิดจองต้องหลังเวลาเปิดจอง');
    const first = before.marketDays.find((d) => !d.isCancelled);
    assertCloseBeforeFirstDay(
      closeAt,
      first ? toIsoDate(first.marketDate) : null,
      await this.timeZone(before.marketId),
    );

    const detail = await this.prisma.$transaction(async (tx) => {
      const row = await tx.bookingRound.update({
        where: { id },
        data: {
          name: input.name,
          openAt,
          closeAt,
          maxStallsPerVendor: input.maxStallsPerVendor,
        },
        select: ROUND_FIELDS,
      });
      await this.audit.log(
        {
          actorType: 'ADMIN',
          actorId: admin.id,
          action: 'round.update',
          entity: { type: 'booking_round', id },
          before: snapshot(before),
          after: snapshot(row),
        },
        tx,
      );
      return toRoundDetail(row, now);
    });
    this.notifyChanged(before.marketId, detail);
    return detail;
  }

  /** DRAFT → PUBLISHED: ต้องมีวันขายอย่างน้อย 1 วัน และยังไม่เลยเวลาปิดจอง */
  async publish(admin: AdminPrincipal, id: string, now: Date = new Date()): Promise<RoundDetail> {
    const round = await this.findInScope(admin, id);
    if (round.status !== RoundStatus.DRAFT) throw invalidState(round.status, 'publish');
    if (!round.marketDays.some((d) => !d.isCancelled)) {
      throw validationError('marketDays', 'ต้องมีวันขายอย่างน้อย 1 วันก่อนเผยแพร่');
    }
    if (round.closeAt <= now) {
      throw validationError('closeAt', 'เวลาปิดจองผ่านไปแล้ว กรุณาแก้เวลาก่อนเผยแพร่');
    }
    return this.transition(admin, round, RoundStatus.PUBLISHED, 'round.publish', now);
  }

  /**
   * PUBLISHED → CANCELLED และยกเลิกทุกวันขายของรอบ (วันที่เหล่านั้นใช้ในรอบใหม่ได้)
   * และยกเลิกการจองที่ยังมีผลของรอบนี้ทั้งหมดใน transaction เดียวกัน
   */
  async cancel(admin: AdminPrincipal, id: string): Promise<RoundDetail> {
    const round = await this.findInScope(admin, id);
    if (round.status !== RoundStatus.PUBLISHED) throw invalidState(round.status, 'cancel');
    return this.transition(admin, round, RoundStatus.CANCELLED, 'round.cancel', new Date());
  }

  /** ลบได้เฉพาะ DRAFT ที่ไม่มีการจองเลย (วันขาย/override ถูกลบตาม) — รอบที่เผยแพร่แล้วใช้ยกเลิกแทน */
  async remove(admin: AdminPrincipal, id: string): Promise<void> {
    const round = await this.findInScope(admin, id);
    if (round.status !== RoundStatus.DRAFT) throw invalidState(round.status, 'delete');
    const bookings = await this.prisma.booking.count({ where: { marketDay: { roundId: id } } });
    if (bookings > 0) {
      throw new AppException(ErrorCode.RESOURCE_IN_USE, 'Round has bookings', { bookings });
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.bookingRound.delete({ where: { id } });
      await this.audit.log(
        {
          actorType: 'ADMIN',
          actorId: admin.id,
          action: 'round.delete',
          entity: { type: 'booking_round', id },
          before: {
            ...snapshot(round),
            marketDates: round.marketDays.map((d) => toIsoDate(d.marketDate)),
          },
        },
        tx,
      );
    });
  }

  async findInScope(admin: AdminPrincipal, id: string): Promise<RoundRow> {
    const marketId = await this.markets.resolveForAdmin(admin);
    const row = await this.prisma.bookingRound.findFirst({
      where: { id, marketId },
      select: ROUND_FIELDS,
    });
    if (!row) throw new AppException(ErrorCode.NOT_FOUND, 'Booking round not found');
    return row;
  }

  async timeZone(marketId: string): Promise<string> {
    const market = await this.prisma.market.findUniqueOrThrow({
      where: { id: marketId },
      select: { timezone: true },
    });
    return market.timezone;
  }

  /** เปลี่ยนสถานะแบบมีเงื่อนไข (`WHERE status = เดิม`) — admin 2 คนกดพร้อมกันได้ผลครั้งเดียว */
  private async transition(
    admin: AdminPrincipal,
    round: RoundRow,
    to: RoundStatus,
    action: string,
    now: Date,
  ): Promise<RoundDetail> {
    let cancelled: BookingEventRow[] = [];
    const detail = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.bookingRound.updateMany({
        where: { id: round.id, status: round.status },
        data: { status: to },
      });
      if (count === 0) throw invalidState(round.status, action);
      if (to === RoundStatus.CANCELLED) {
        await tx.marketDay.updateMany({
          where: { roundId: round.id },
          data: { isCancelled: true },
        });
        // ยกเลิกรอบ = ยกเลิกทุกการจองที่ยังมีผลของรอบ (Phase 7 แจ้งผู้ค้า)
        cancelled = await this.bookingState.cancelActive(
          tx,
          { marketDay: { roundId: round.id } },
          { cancelledAt: now, cancelReason: 'รอบการจองถูกยกเลิก', cancelledByAdminId: admin.id },
        );
      }
      await this.audit.log(
        {
          actorType: 'ADMIN',
          actorId: admin.id,
          action,
          entity: { type: 'booking_round', id: round.id },
          before: { status: round.status },
          after: {
            status: to,
            ...(cancelled.length > 0 && { cancelledBookings: cancelled.length }),
          },
        },
        tx,
      );
      const row = await tx.bookingRound.findUniqueOrThrow({
        where: { id: round.id },
        select: ROUND_FIELDS,
      });
      return toRoundDetail(row, now);
    });
    this.bookingEvents.emitChanged(cancelled.map(toEvent));
    this.notifyChanged(round.marketId, detail);
    return detail;
  }

  /** หลัง commit: รอบที่ผู้ค้าเห็นเปลี่ยน (DRAFT ไม่ส่ง) — ใช้ร่วมกับ MarketDayService */
  notifyChanged(
    marketId: string,
    round: { id: string; status: RoundStatus; openAt: Date | string; closeAt: Date | string },
  ): void {
    this.roundEvents.emitChanged({
      roundId: round.id,
      marketId,
      status: round.status,
      openAt: new Date(round.openAt),
      closeAt: new Date(round.closeAt),
    });
  }
}
