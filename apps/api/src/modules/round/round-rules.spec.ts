import {
  ErrorCode,
  RoundPhase,
  addMarketDaysSchema,
  createRoundSchema,
  estimateClockOffset,
  roundPhase,
  updateRoundSchema,
  weekendDatesOfMonth,
} from '@market-booking/shared';
import { AppException } from '../../common/exceptions/app.exception';
import { zonedDate, zonedDayStart } from '../../common/zoned-date';
import type { PrismaService } from '../../prisma/prisma.service';
import { assertCloseBeforeFirstDay, marketDateIssues } from './round-rules';
import { RoundService } from './round.service';

const openAt = new Date('2026-12-01T10:00:00.000Z');
const closeAt = new Date('2026-12-05T10:00:00.000Z');
const published = { status: 'PUBLISHED' as const, openAt, closeAt };
const at = (base: Date, ms: number) => new Date(base.getTime() + ms);

describe('roundPhase (Overview §8.3)', () => {
  it('ขอบเวลา: ก่อน open_at 1 ms = UPCOMING, open_at พอดี = OPEN, close_at พอดี = CLOSED', () => {
    expect(roundPhase(published, at(openAt, -1000))).toBe(RoundPhase.UPCOMING);
    expect(roundPhase(published, at(openAt, -1))).toBe(RoundPhase.UPCOMING);
    expect(roundPhase(published, openAt)).toBe(RoundPhase.OPEN);
    expect(roundPhase(published, at(closeAt, -1))).toBe(RoundPhase.OPEN);
    expect(roundPhase(published, closeAt)).toBe(RoundPhase.CLOSED);
  });

  it('DRAFT/CANCELLED ไม่มี phase แม้อยู่ในช่วงเวลา', () => {
    expect(roundPhase({ ...published, status: 'DRAFT' }, openAt)).toBeNull();
    expect(roundPhase({ ...published, status: 'CANCELLED' }, openAt)).toBeNull();
  });

  it('รับเวลาเป็น ISO string ได้ (ใช้ฝั่งหน้าเว็บ)', () => {
    const iso = { ...published, openAt: openAt.toISOString(), closeAt: closeAt.toISOString() };
    expect(roundPhase(iso, openAt)).toBe(RoundPhase.OPEN);
  });
});

describe('RoundService.assertRoundOpen', () => {
  function serviceWith(day: unknown) {
    const prisma = { marketDay: { findFirst: jest.fn().mockResolvedValue(day) } };
    return new RoundService(prisma as unknown as PrismaService, null!, null!, null!);
  }
  const day = (overrides: Record<string, unknown> = {}) => ({
    id: 'day-1',
    marketId: 'm-1',
    marketDate: new Date('2026-12-06T00:00:00Z'),
    isCancelled: false,
    round: { id: 'r-1', maxStallsPerVendor: 1, ...published },
    ...overrides,
  });
  const codeOf = async (promise: Promise<unknown>) => {
    try {
      await promise;
      return 'OK';
    } catch (e) {
      return (e as AppException).code;
    }
  };

  it('ก่อน open_at 1 วินาที → ROUND_NOT_OPEN; open_at พอดี → ผ่าน', async () => {
    const service = serviceWith(day());
    expect(await codeOf(service.assertRoundOpen('day-1', { now: at(openAt, -1000) }))).toBe(
      ErrorCode.ROUND_NOT_OPEN,
    );
    expect(await codeOf(service.assertRoundOpen('day-1', { now: openAt }))).toBe('OK');
    expect(await codeOf(service.assertRoundOpen('day-1', { now: closeAt }))).toBe(
      ErrorCode.ROUND_NOT_OPEN,
    );
  });

  it('รอบ DRAFT / วันขายถูกยกเลิก → ROUND_NOT_OPEN, ไม่พบวัน → NOT_FOUND', async () => {
    const draft = serviceWith(day({ round: { ...day().round, status: 'DRAFT' } }));
    expect(await codeOf(draft.assertRoundOpen('day-1', { now: openAt }))).toBe(
      ErrorCode.ROUND_NOT_OPEN,
    );
    const cancelled = serviceWith(day({ isCancelled: true }));
    expect(await codeOf(cancelled.assertRoundOpen('day-1', { now: openAt }))).toBe(
      ErrorCode.ROUND_NOT_OPEN,
    );
    expect(await codeOf(serviceWith(null).assertRoundOpen('x', { now: openAt }))).toBe(
      ErrorCode.NOT_FOUND,
    );
  });
});

describe('zoned date (เวลาตลาด)', () => {
  it('เริ่มวันตามเวลา Asia/Bangkok (UTC+7)', () => {
    expect(zonedDayStart('2026-12-06', 'Asia/Bangkok').toISOString()).toBe(
      '2026-12-05T17:00:00.000Z',
    );
    expect(zonedDate(new Date('2026-12-05T16:59:59Z'), 'Asia/Bangkok')).toBe('2026-12-05');
    expect(zonedDate(new Date('2026-12-05T17:00:00Z'), 'Asia/Bangkok')).toBe('2026-12-06');
  });

  it('timezone ที่มี DST ก็ได้เที่ยงคืนท้องถิ่น', () => {
    // 2026-03-29 ยุโรปเปลี่ยนเป็นเวลาฤดูร้อนตอน 01:00 UTC — เที่ยงคืนยังเป็น UTC+1
    expect(zonedDayStart('2026-03-29', 'Europe/Berlin').toISOString()).toBe(
      '2026-03-28T23:00:00.000Z',
    );
    expect(zonedDayStart('2026-07-01', 'Europe/Berlin').toISOString()).toBe(
      '2026-06-30T22:00:00.000Z',
    );
  });
});

describe('round validation (Overview §9.3)', () => {
  const tz = 'Asia/Bangkok';
  const now = new Date('2026-11-30T03:00:00Z'); // 30 พ.ย. 10:00 เวลาไทย

  it('close_at ต้องไม่เกิน 00:00 ของวันขายวันแรก (เวลาตลาด)', () => {
    const limit = new Date('2026-12-05T17:00:00Z'); // 6 ธ.ค. 00:00 เวลาไทย
    expect(() => assertCloseBeforeFirstDay(limit, '2026-12-06', tz)).not.toThrow();
    expect(() => assertCloseBeforeFirstDay(at(limit, 1), '2026-12-06', tz)).toThrow(AppException);
    expect(() => assertCloseBeforeFirstDay(at(limit, 1), null, tz)).not.toThrow();
  });

  it('วันขาย: วันที่ผ่านมาแล้ว / ก่อนปิดจอง ไม่ได้', () => {
    const round = { closeAt: new Date('2026-12-05T17:00:00Z') };
    expect(marketDateIssues(['2026-12-06', '2026-12-07'], round, tz, now)).toEqual([]);
    expect(marketDateIssues(['2026-12-05'], round, tz, now)[0]?.message).toMatch(
      /^วันขายต้องอยู่หลังเวลาปิดจอง/,
    );
    expect(marketDateIssues(['2026-11-29'], round, tz, now)[0]?.message).toMatch(
      /^เลือกวันที่ผ่านมาแล้วไม่ได้/,
    );
  });

  it('schema: close ต้องหลัง open, วันที่ไม่ซ้ำและเรียง', () => {
    const base = { name: 'รอบ', openAt: openAt.toISOString(), closeAt: closeAt.toISOString() };
    expect(createRoundSchema.safeParse(base).success).toBe(true);
    expect(createRoundSchema.safeParse({ ...base, closeAt: base.openAt }).success).toBe(false);
    expect(createRoundSchema.safeParse({ ...base, openAt: '2026-12-01 10:00' }).success).toBe(
      false,
    );
    expect(updateRoundSchema.safeParse({}).success).toBe(false);
    expect(updateRoundSchema.safeParse({ maxStallsPerVendor: 0 }).success).toBe(false);
    expect(
      addMarketDaysSchema.parse({ dates: ['2026-12-07', '2026-12-06', '2026-12-07'] }).dates,
    ).toEqual(['2026-12-06', '2026-12-07']);
    expect(addMarketDaysSchema.safeParse({ dates: ['2026-02-30'] }).success).toBe(false);
  });
});

describe('ตัวช่วยฝั่งหน้าเว็บ', () => {
  it('weekendDatesOfMonth: ทุกเสาร์-อาทิตย์ของเดือน', () => {
    expect(weekendDatesOfMonth(2026, 12)).toEqual([
      '2026-12-05',
      '2026-12-06',
      '2026-12-12',
      '2026-12-13',
      '2026-12-19',
      '2026-12-20',
      '2026-12-26',
      '2026-12-27',
    ]);
    expect(weekendDatesOfMonth(2026, 2)).toHaveLength(8);
  });

  it('estimateClockOffset: เวลา server เทียบกับกึ่งกลางของ request', () => {
    // เครื่องช้ากว่า server 1 ชม., ไป-กลับ 200 ms
    const sent = Date.parse('2026-12-01T09:00:00.000Z');
    const serverTime = '2026-12-01T10:00:00.100Z';
    expect(estimateClockOffset(sent, serverTime, sent + 200)).toBe(3_600_000);
  });
});
