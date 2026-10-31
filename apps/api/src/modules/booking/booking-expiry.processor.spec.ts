import { DelayedError, type Job } from 'bullmq';
import type { AppConfigService } from '../../config/app-config.service';
import type { PrismaService } from '../../prisma/prisma.service';
import { type BookingChangedEvent, BookingEvents } from './booking-events';
import { BookingExpiryProcessor } from './booking-expiry.processor';
import type { BookingStateService } from './booking-state.service';

const now = new Date('2026-12-01T10:00:00Z');
const later = new Date(now.getTime() + 60_000);

function setup(opts: { expired?: object[]; booking?: object | null } = {}) {
  const state = { expireLapsed: jest.fn().mockResolvedValue(opts.expired ?? []) };
  const prisma = { booking: { findUnique: jest.fn().mockResolvedValue(opts.booking ?? null) } };
  const events = new BookingEvents();
  const emitted: BookingChangedEvent[] = [];
  events.onChanged((e) => {
    emitted.push(e);
  });
  const processor = new BookingExpiryProcessor(
    {} as AppConfigService,
    prisma as unknown as PrismaService,
    state as unknown as BookingStateService,
    events,
  );
  return { processor, state, emitted };
}

const expiredRow = {
  id: 'b1',
  marketId: 'm',
  marketDayId: 'd',
  stallId: 's',
  vendorId: 'v',
  status: 'EXPIRED',
  holdExpiresAt: now,
  paymentDueAt: null,
};

describe('BookingExpiryProcessor', () => {
  it('หมดเวลาจริง → EXPIRED เฉพาะการจองนั้น + ส่ง event', async () => {
    const { processor, state, emitted } = setup({ expired: [expiredRow] });
    expect(await processor.expireBooking('b1', now)).toEqual({ expired: true });
    expect(state.expireLapsed).toHaveBeenCalledWith(expect.anything(), { id: 'b1' }, now);
    expect(emitted).toEqual([expect.objectContaining({ bookingId: 'b1', status: 'EXPIRED' })]);
  });

  it('ยังไม่หมดเวลาของสถานะปัจจุบัน → บอกเวลาที่ต้องลองใหม่', async () => {
    const hold = setup({ booking: { status: 'HOLD', holdExpiresAt: later, paymentDueAt: null } });
    expect(await hold.processor.expireBooking('b1', now)).toEqual({
      expired: false,
      retryAt: later,
    });
    const unpaid = setup({
      booking: { status: 'PENDING_PAYMENT', holdExpiresAt: now, paymentDueAt: later },
    });
    expect(await unpaid.processor.expireBooking('b1', now)).toEqual({
      expired: false,
      retryAt: later,
    });
  });

  it('สถานะที่ไม่มีเวลาหมด / ไม่พบการจอง → ไม่ทำอะไร (idempotent)', async () => {
    for (const booking of [
      { status: 'CONFIRMED', holdExpiresAt: now, paymentDueAt: null },
      { status: 'PENDING_VERIFY', holdExpiresAt: null, paymentDueAt: now },
      null,
    ]) {
      const { processor, emitted } = setup({ booking });
      expect(await processor.expireBooking('b1', now)).toEqual({ expired: false });
      expect(emitted).toEqual([]);
    }
  });

  it('job มาก่อนเวลา → moveToDelayed ไปเวลาหมดจริง แล้ว DelayedError', async () => {
    const { processor } = setup({
      booking: { status: 'HOLD', holdExpiresAt: later, paymentDueAt: null },
    });
    const job = {
      name: 'expire',
      data: { bookingId: 'b1' },
      moveToDelayed: jest.fn().mockResolvedValue(undefined),
    };
    await expect(processor.process(job as unknown as Job, 'token')).rejects.toBeInstanceOf(
      DelayedError,
    );
    expect(job.moveToDelayed).toHaveBeenCalledWith(later.getTime(), 'token');
  });

  it('job sweep กวาดทุกตลาด', async () => {
    const { processor, state } = setup({ expired: [expiredRow, { ...expiredRow, id: 'b2' }] });
    const job = { name: 'sweep', data: {} };
    expect(await processor.process(job as unknown as Job)).toBe('swept 2');
    expect(state.expireLapsed).toHaveBeenCalledWith(expect.anything(), {}, expect.any(Date));
  });
});
