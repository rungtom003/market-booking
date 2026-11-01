import { Injectable } from '@nestjs/common';
import {
  ACTIVE_BOOKING_STATUSES,
  AddMarketDaysInput,
  CheckinWindowInput,
  ErrorCode,
  RoundDetail,
  RoundStatus,
  SetStallDayOverrideInput,
  StallDayOverride,
  UpdateMarketDayInput,
  checkinWindow,
} from '@market-booking/shared';
import { Prisma } from '../../generated/prisma/client';
import { AppException } from '../../common/exceptions/app.exception';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { AdminPrincipal } from '../auth/principal';
import { MarketService } from '../market/market.service';
import { BookingEvents } from '../booking/booking-events';
import { type BookingEventRow, isLapsed, toEvent } from '../booking/booking-mapper';
import { BookingStateService } from '../booking/booking-state.service';
import { compareStalls } from '../market-setup/stall-mapper';
import { fromIsoDate, marketDateIssues, toIsoDate } from './round-rules';
import { ROUND_FIELDS, RoundRow, RoundService, toRoundDetail } from './round.service';

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

function dateTaken(dates: string[]): AppException {
  return new AppException(ErrorCode.MARKET_DATE_TAKEN, 'Market date already in use', { dates });
}

function roundCancelled(): AppException {
  return new AppException(ErrorCode.INVALID_STATE_TRANSITION, 'Round is cancelled', {
    status: RoundStatus.CANCELLED,
  });
}

/** วันขายของรอบ และการตั้งค่าล็อคเฉพาะวัน (`stall_day_overrides`) */
@Injectable()
export class MarketDayService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly markets: MarketService,
    private readonly rounds: RoundService,
    private readonly bookingState: BookingStateService,
    private readonly bookingEvents: BookingEvents,
  ) {}

  /**
   * เพิ่มวันขาย — ต้องไม่ใช่วันที่ผ่านมาแล้ว, อยู่หลังเวลาปิดจอง และไม่ซ้ำกับวันที่ยังไม่ยกเลิกของรอบใดๆ
   * (`MARKET_DATE_TAKEN`) วันที่เคยยกเลิกในรอบนี้จะถูกคืนสถานะแทนการสร้างใหม่
   */
  async add(
    admin: AdminPrincipal,
    roundId: string,
    input: AddMarketDaysInput,
    now: Date = new Date(),
  ): Promise<RoundDetail> {
    const round = await this.rounds.findInScope(admin, roundId);
    if (round.status === RoundStatus.CANCELLED) throw roundCancelled();
    await this.assertDatesAllowed(round, input.dates, now);

    const taken = await this.prisma.marketDay.findMany({
      where: {
        marketId: round.marketId,
        isCancelled: false,
        marketDate: { in: input.dates.map(fromIsoDate) },
      },
      select: { marketDate: true },
    });
    if (taken.length > 0) throw dateTaken(taken.map((d) => toIsoDate(d.marketDate)));

    // วันที่ยกเลิกไว้ในรอบนี้ → คืนสถานะ (แถวละวัน)
    const restore = new Map<string, string>();
    for (const day of round.marketDays) {
      const date = toIsoDate(day.marketDate);
      if (day.isCancelled && input.dates.includes(date)) restore.set(date, day.id);
    }
    const create = input.dates.filter((d) => !restore.has(d));

    try {
      const detail = await this.prisma.$transaction(async (tx) => {
        if (restore.size > 0) {
          await tx.marketDay.updateMany({
            where: { id: { in: [...restore.values()] } },
            data: { isCancelled: false },
          });
        }
        await tx.marketDay.createMany({
          data: create.map((d) => ({
            marketId: round.marketId,
            roundId,
            marketDate: fromIsoDate(d),
          })),
        });
        await this.audit.log(
          {
            actorType: 'ADMIN',
            actorId: admin.id,
            action: 'market_day.add',
            entity: { type: 'booking_round', id: roundId },
            after: { created: create, restored: [...restore.keys()] },
          },
          tx,
        );
        return this.detail(tx, roundId, now);
      });
      this.rounds.notifyChanged(round.marketId, detail);
      return detail;
    } catch (error) {
      // อีกรอบเพิ่มวันเดียวกันพร้อมกัน — partial unique `uq_market_day_date` ตัดสิน
      if (isUniqueViolation(error)) throw dateTaken(input.dates);
      throw error;
    }
  }

  /** ยกเลิก/คืนสถานะวันขาย — ยกเลิกวัน = ยกเลิกการจองที่ยังมีผลของวันนั้นด้วย (transaction เดียวกัน) */
  async update(
    admin: AdminPrincipal,
    roundId: string,
    dayId: string,
    input: UpdateMarketDayInput,
    now: Date = new Date(),
  ): Promise<RoundDetail> {
    const round = await this.rounds.findInScope(admin, roundId);
    if (round.status === RoundStatus.CANCELLED) throw roundCancelled();
    const day = this.dayOf(round, dayId);
    if (day.isCancelled === input.isCancelled) return toRoundDetail(round, now);

    const date = toIsoDate(day.marketDate);
    if (!input.isCancelled) await this.assertDatesAllowed(round, [date], now);

    let cancelled: BookingEventRow[] = [];
    try {
      const detail = await this.prisma.$transaction(async (tx) => {
        await tx.marketDay.update({ where: { id: dayId }, data: input });
        if (input.isCancelled) {
          cancelled = await this.bookingState.cancelActive(
            tx,
            { marketDayId: dayId },
            { cancelledAt: now, cancelReason: 'วันขายถูกยกเลิก', cancelledByAdminId: admin.id },
          );
        }
        await this.audit.log(
          {
            actorType: 'ADMIN',
            actorId: admin.id,
            action: input.isCancelled ? 'market_day.cancel' : 'market_day.restore',
            entity: { type: 'market_day', id: dayId },
            before: { marketDate: date, isCancelled: day.isCancelled },
            after: {
              marketDate: date,
              isCancelled: input.isCancelled,
              ...(cancelled.length > 0 && { cancelledBookings: cancelled.length }),
            },
          },
          tx,
        );
        return this.detail(tx, roundId, now);
      });
      this.bookingEvents.emitChanged(cancelled.map(toEvent));
      this.rounds.notifyChanged(round.marketId, detail);
      return detail;
    } catch (error) {
      if (isUniqueViolation(error)) throw dateTaken([date]);
      throw error;
    }
  }

  /**
   * ตั้งช่วงเวลา check-in (null = ค่าเริ่มต้น 00:00–24:00 ของวันขาย) — ช่วงที่ได้ต้องปิดหลังเปิด
   * แก้ไม่ได้หลังระบบนับ No-show ของวันนั้นแล้ว
   */
  async setCheckinWindow(
    admin: AdminPrincipal,
    roundId: string,
    dayId: string,
    input: CheckinWindowInput,
    now: Date = new Date(),
  ): Promise<RoundDetail> {
    const round = await this.rounds.findInScope(admin, roundId);
    if (round.status === RoundStatus.CANCELLED) throw roundCancelled();
    const day = this.dayOf(round, dayId);
    if (day.isCancelled || day.noshowProcessedAt) {
      throw new AppException(ErrorCode.INVALID_STATE_TRANSITION, 'Check-in window is final', {
        reason: day.isCancelled ? 'cancelled' : 'noshow_processed',
      });
    }
    const date = toIsoDate(day.marketDate);
    const window = checkinWindow({ marketDate: date, ...input });
    if (window.closeAt <= window.openAt) {
      throw new AppException(ErrorCode.VALIDATION_ERROR, 'Request validation failed', [
        { path: 'checkinCloseAt', message: 'เวลาปิด check-in ต้องหลังเวลาเปิด', code: 'custom' },
      ]);
    }
    const data = {
      checkinOpenAt: input.checkinOpenAt ? new Date(input.checkinOpenAt) : null,
      checkinCloseAt: input.checkinCloseAt ? new Date(input.checkinCloseAt) : null,
    };
    return this.prisma.$transaction(async (tx) => {
      await tx.marketDay.update({ where: { id: dayId }, data });
      await this.audit.log(
        {
          actorType: 'ADMIN',
          actorId: admin.id,
          action: 'market_day.checkin_window',
          entity: { type: 'market_day', id: dayId },
          before: {
            marketDate: date,
            checkinOpenAt: day.checkinOpenAt?.toISOString() ?? null,
            checkinCloseAt: day.checkinCloseAt?.toISOString() ?? null,
          },
          after: { marketDate: date, ...input },
        },
        tx,
      );
      return this.detail(tx, roundId, now);
    });
  }

  /** ลบวันขายที่ไม่มีการจอง/คิวเลย (override ถูกลบตาม) — มีแล้วให้ยกเลิกวันแทน */
  async remove(admin: AdminPrincipal, roundId: string, dayId: string): Promise<void> {
    const round = await this.rounds.findInScope(admin, roundId);
    if (round.status === RoundStatus.CANCELLED) throw roundCancelled();
    const day = this.dayOf(round, dayId);

    const [bookings, waitlists] = await Promise.all([
      this.prisma.booking.count({ where: { marketDayId: dayId } }),
      this.prisma.waitlist.count({ where: { marketDayId: dayId } }),
    ]);
    if (bookings + waitlists > 0) {
      throw new AppException(ErrorCode.RESOURCE_IN_USE, 'Market day is in use', {
        bookings,
        waitlists,
      });
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.marketDay.delete({ where: { id: dayId } });
      await this.audit.log(
        {
          actorType: 'ADMIN',
          actorId: admin.id,
          action: 'market_day.delete',
          entity: { type: 'market_day', id: dayId },
          before: { roundId, marketDate: toIsoDate(day.marketDate), isCancelled: day.isCancelled },
        },
        tx,
      );
    });
    this.rounds.notifyChanged(round.marketId, round);
  }

  // ───────────── override รายวัน ─────────────

  async overrides(admin: AdminPrincipal, marketDayId: string): Promise<StallDayOverride[]> {
    await this.findDayInScope(admin, marketDayId);
    const rows = await this.prisma.stallDayOverride.findMany({
      where: { marketDayId },
      select: {
        stallId: true,
        priceOverride: true,
        isClosed: true,
        stall: { select: { code: true } },
      },
    });
    return rows
      .map((r) => ({
        stallId: r.stallId,
        stallCode: r.stall.code,
        priceOverride: r.priceOverride === null ? null : Number(r.priceOverride),
        isClosed: r.isClosed,
      }))
      .sort((a, b) => compareStalls({ code: a.stallCode }, { code: b.stallCode }));
  }

  /**
   * ปิดล็อค/เปลี่ยนราคาเฉพาะวัน — ค่าว่างทั้งคู่ (`priceOverride: null`, `isClosed: false`) = ลบ override
   * ปิดล็อคที่มีการจองอยู่ไม่ได้ (`RESOURCE_IN_USE`) — ให้ยกเลิกการจองนั้นก่อน (หน้าจัดการการจอง)
   */
  async setOverride(
    admin: AdminPrincipal,
    marketDayId: string,
    stallId: string,
    input: SetStallDayOverrideInput,
  ): Promise<StallDayOverride | null> {
    const day = await this.findDayInScope(admin, marketDayId);
    if (day.isCancelled || day.round.status === RoundStatus.CANCELLED) {
      throw new AppException(ErrorCode.INVALID_STATE_TRANSITION, 'Market day is cancelled', {
        isCancelled: true,
      });
    }
    const stall = await this.prisma.stall.findFirst({
      where: { id: stallId, marketId: day.marketId },
      select: { id: true, code: true },
    });
    if (!stall) throw new AppException(ErrorCode.NOT_FOUND, 'Stall not found');

    const key = { stallId_marketDayId: { stallId, marketDayId } };
    const existing = await this.prisma.stallDayOverride.findUnique({
      where: key,
      select: { id: true, priceOverride: true, isClosed: true },
    });
    const before = existing && {
      priceOverride: existing.priceOverride === null ? null : Number(existing.priceOverride),
      isClosed: existing.isClosed,
    };
    const clear = input.priceOverride === null && !input.isClosed;
    if (clear && !existing) return null;
    if (input.isClosed) {
      const now = new Date();
      const active = (
        await this.prisma.booking.findMany({
          where: { stallId, marketDayId, status: { in: [...ACTIVE_BOOKING_STATUSES] } },
          select: { status: true, holdExpiresAt: true, paymentDueAt: true },
        })
      ).filter((b) => !isLapsed(b, now));
      if (active.length > 0) {
        throw new AppException(ErrorCode.RESOURCE_IN_USE, 'Stall has an active booking', {
          bookings: active.length,
        });
      }
    }

    return this.prisma.$transaction(async (tx) => {
      let id = existing?.id ?? null;
      if (clear) {
        await tx.stallDayOverride.delete({ where: key });
      } else {
        id = (
          await tx.stallDayOverride.upsert({
            where: key,
            create: { stallId, marketDayId, ...input },
            update: input,
            select: { id: true },
          })
        ).id;
      }
      await this.audit.log(
        {
          actorType: 'ADMIN',
          actorId: admin.id,
          action: clear ? 'stall_day_override.delete' : 'stall_day_override.set',
          entity: { type: 'stall_day_override', id },
          before: before && { stallCode: stall.code, marketDayId, ...before },
          after: clear ? undefined : { stallCode: stall.code, marketDayId, ...input },
        },
        tx,
      );
      return clear ? null : { stallId, stallCode: stall.code, ...input };
    });
  }

  private async findDayInScope(admin: AdminPrincipal, marketDayId: string) {
    const marketId = await this.markets.resolveForAdmin(admin);
    const day = await this.prisma.marketDay.findFirst({
      where: { id: marketDayId, marketId },
      select: { id: true, marketId: true, isCancelled: true, round: { select: { status: true } } },
    });
    if (!day) throw new AppException(ErrorCode.NOT_FOUND, 'Market day not found');
    return day;
  }

  private dayOf(round: RoundRow, dayId: string) {
    const day = round.marketDays.find((d) => d.id === dayId);
    if (!day) throw new AppException(ErrorCode.NOT_FOUND, 'Market day not found');
    return day;
  }

  private async assertDatesAllowed(round: RoundRow, dates: string[], now: Date): Promise<void> {
    const issues = marketDateIssues(dates, round, await this.rounds.timeZone(round.marketId), now);
    if (issues.length > 0) {
      throw new AppException(ErrorCode.VALIDATION_ERROR, 'Request validation failed', issues);
    }
  }

  private async detail(
    tx: Prisma.TransactionClient,
    roundId: string,
    now: Date,
  ): Promise<RoundDetail> {
    const row = await tx.bookingRound.findUniqueOrThrow({
      where: { id: roundId },
      select: ROUND_FIELDS,
    });
    return toRoundDetail(row, now);
  }
}
