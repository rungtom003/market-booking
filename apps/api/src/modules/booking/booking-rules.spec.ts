import {
  BOOKING_TRANSITIONS,
  BookingStatus,
  ErrorCode,
  adminCancelBookingSchema,
  canTransition,
  holdBookingSchema,
} from '@market-booking/shared';
import { AppException } from '../../common/exceptions/app.exception';
import { BookingEvents, type BookingChangedEvent } from './booking-events';
import { isLapsed } from './booking-mapper';
import { BookingStateService } from './booking-state.service';

const { HOLD, PENDING_PAYMENT, PENDING_VERIFY, CONFIRMED, CANCELLED, EXPIRED } = BookingStatus;

describe('booking transitions (Overview §8.2)', () => {
  it.each([
    [HOLD, CONFIRMED],
    [HOLD, PENDING_PAYMENT],
    [HOLD, EXPIRED],
    [HOLD, CANCELLED],
    [PENDING_PAYMENT, PENDING_VERIFY],
    [PENDING_PAYMENT, EXPIRED],
    [PENDING_PAYMENT, CANCELLED],
    [PENDING_VERIFY, CONFIRMED],
    [PENDING_VERIFY, PENDING_PAYMENT],
    [CONFIRMED, CANCELLED],
  ])('%s → %s ได้', (from, to) => {
    expect(canTransition(from, to)).toBe(true);
  });

  it.each([
    [CONFIRMED, EXPIRED],
    [CONFIRMED, HOLD],
    [PENDING_VERIFY, EXPIRED],
    [HOLD, PENDING_VERIFY],
    [CANCELLED, HOLD],
    [EXPIRED, CONFIRMED],
  ])('%s → %s ไม่ได้', (from, to) => {
    expect(canTransition(from, to)).toBe(false);
  });

  it('สถานะสุดท้ายไปต่อไม่ได้', () => {
    expect(BOOKING_TRANSITIONS.CANCELLED).toEqual([]);
    expect(BOOKING_TRANSITIONS.EXPIRED).toEqual([]);
  });
});

describe('BookingStateService.transition', () => {
  const service = new BookingStateService();
  const dbWith = (count: number) => ({
    booking: {
      updateMany: jest.fn().mockResolvedValue({ count }),
      findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'b1', status: CONFIRMED }),
    },
  });

  it('UPDATE แบบมีเงื่อนไขสถานะเดิม + เพิ่ม version', async () => {
    const db = dbWith(1);
    await service.transition(db as never, 'b1', [HOLD], CONFIRMED, { confirmedAt: new Date(0) });
    expect(db.booking.updateMany).toHaveBeenCalledWith({
      where: { id: 'b1', status: { in: [HOLD] } },
      data: { confirmedAt: new Date(0), status: CONFIRMED, version: { increment: 1 } },
    });
  });

  it('ไม่มีแถวถูกเปลี่ยน (สถานะเปลี่ยนไปก่อนแล้ว) → INVALID_STATE_TRANSITION', async () => {
    await expect(service.transition(dbWith(0) as never, 'b1', [HOLD], CONFIRMED)).rejects.toThrow(
      AppException,
    );
    await expect(
      service.transition(dbWith(0) as never, 'b1', [HOLD], CONFIRMED),
    ).rejects.toMatchObject({ code: ErrorCode.INVALID_STATE_TRANSITION });
  });

  it('การเปลี่ยนที่ไม่อยู่ในตาราง = bug → throw ก่อนแตะ DB', async () => {
    const db = dbWith(1);
    await expect(service.transition(db as never, 'b1', [CONFIRMED], EXPIRED)).rejects.toThrow(
      'not allowed',
    );
    expect(db.booking.updateMany).not.toHaveBeenCalled();
  });
});

describe('isLapsed', () => {
  const now = new Date('2026-12-01T10:00:00Z');
  const row = (status: BookingStatus, at: Date | null) => ({
    status,
    holdExpiresAt: at,
    paymentDueAt: at,
  });

  it('HOLD / PENDING_PAYMENT ที่เลยเวลา (รวมพอดี) = หมดอายุ', () => {
    expect(isLapsed(row(HOLD, now), now)).toBe(true);
    expect(isLapsed(row(HOLD, new Date(now.getTime() + 1)), now)).toBe(false);
    expect(isLapsed(row(PENDING_PAYMENT, new Date(now.getTime() - 1)), now)).toBe(true);
  });

  it('สถานะอื่นไม่หมดอายุตามเวลา', () => {
    expect(isLapsed(row(CONFIRMED, new Date(0)), now)).toBe(false);
    expect(isLapsed(row(PENDING_VERIFY, new Date(0)), now)).toBe(false);
  });
});

describe('BookingEvents', () => {
  const event = { bookingId: 'b1', status: HOLD } as BookingChangedEvent;

  it('listener ที่พังไม่กระทบ listener อื่น และยกเลิก subscribe ได้', async () => {
    const events = new BookingEvents();
    const seen: string[] = [];
    events.onChanged(() => {
      throw new Error('boom');
    });
    events.onChanged(async () => {
      throw new Error('async boom');
    });
    const off = events.onChanged((e) => {
      seen.push(e.bookingId);
    });
    jest.spyOn(events['logger'], 'error').mockImplementation(() => undefined);

    events.emitChanged([event, { ...event, bookingId: 'b2' }]);
    off();
    events.emitChanged([event]);
    await new Promise((r) => setImmediate(r));
    expect(seen).toEqual(['b1', 'b2']);
  });
});

describe('booking schemas', () => {
  it('hold ต้องเป็น uuid และไม่รับ field อื่น', () => {
    const id = '0195f0a0-0000-7000-8000-000000000000';
    expect(holdBookingSchema.safeParse({ stallId: id, marketDayId: id }).success).toBe(true);
    expect(holdBookingSchema.safeParse({ stallId: 'x', marketDayId: id }).success).toBe(false);
    expect(holdBookingSchema.safeParse({ stallId: id, marketDayId: id, amount: 1 }).success).toBe(
      false,
    );
  });

  it('admin ยกเลิกต้องมีเหตุผล', () => {
    expect(adminCancelBookingSchema.safeParse({ reason: '  ' }).success).toBe(false);
    expect(adminCancelBookingSchema.parse({ reason: ' ฝนตก ' })).toEqual({ reason: 'ฝนตก' });
  });
});
