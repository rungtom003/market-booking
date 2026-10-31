import { randomBytes } from 'node:crypto';
import { BookingStatus } from '@market-booking/shared';
import type { Booking } from '@market-booking/shared';
import { Prisma } from '../../generated/prisma/client';
import type { BookingChangedEvent } from './booking-events';

/** field ที่ใช้ส่ง event `booking.changed` */
export const EVENT_FIELDS = {
  id: true,
  marketId: true,
  marketDayId: true,
  stallId: true,
  vendorId: true,
  status: true,
  holdExpiresAt: true,
  paymentDueAt: true,
} satisfies Prisma.BookingSelect;

export type BookingEventRow = Prisma.BookingGetPayload<{ select: typeof EVENT_FIELDS }>;

/** คอลัมน์ของตารางอย่างเดียว (ไม่มี relation) */
export const SCALAR_FIELDS = {
  ...EVENT_FIELDS,
  amount: true,
  confirmedAt: true,
  cancelledAt: true,
  cancelReason: true,
  cancelledByAdminId: true,
  createdAt: true,
} satisfies Prisma.BookingSelect;

export const BOOKING_FIELDS = {
  ...SCALAR_FIELDS,
  stall: { select: { code: true, zone: { select: { name: true } } } },
  marketDay: { select: { marketDate: true, round: { select: { name: true } } } },
} satisfies Prisma.BookingSelect;

export type BookingRow = Prisma.BookingGetPayload<{ select: typeof BOOKING_FIELDS }>;

export function toEvent(row: BookingEventRow): BookingChangedEvent {
  return {
    bookingId: row.id,
    marketId: row.marketId,
    marketDayId: row.marketDayId,
    stallId: row.stallId,
    vendorId: row.vendorId,
    status: row.status,
    holdExpiresAt: row.holdExpiresAt,
    paymentDueAt: row.paymentDueAt,
  };
}

/**
 * หมดเวลาแล้วแต่ยังไม่ถูกเปลี่ยนเป็น EXPIRED (worker 4.2 ยังไม่ทำ/ช้า) — ถือว่าหมดอายุแล้ว
 * ใช้ตอนแสดงผลและตอนจอง (จองทับได้หลัง expire ใน transaction เดียวกัน)
 */
export function isLapsed(
  row: { status: BookingStatus; holdExpiresAt: Date | null; paymentDueAt: Date | null },
  now: Date,
): boolean {
  if (row.status === BookingStatus.HOLD) {
    return row.holdExpiresAt !== null && row.holdExpiresAt <= now;
  }
  if (row.status === BookingStatus.PENDING_PAYMENT) {
    return row.paymentDueAt !== null && row.paymentDueAt <= now;
  }
  return false;
}

export function toBooking(row: BookingRow, now: Date): Booking {
  return {
    id: row.id,
    status: isLapsed(row, now) ? BookingStatus.EXPIRED : row.status,
    amount: Number(row.amount),
    stall: { id: row.stallId, code: row.stall.code, zoneName: row.stall.zone.name },
    marketDay: {
      id: row.marketDayId,
      marketDate: row.marketDay.marketDate.toISOString().slice(0, 10),
      roundName: row.marketDay.round.name,
    },
    holdExpiresAt: row.holdExpiresAt?.toISOString() ?? null,
    paymentDueAt: row.paymentDueAt?.toISOString() ?? null,
    confirmedAt: row.confirmedAt?.toISOString() ?? null,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    cancelReason: row.cancelReason,
    cancelledByAdmin: row.cancelledByAdminId !== null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** token ของ QR check-in (Phase 8) — สร้างทุกครั้งที่การจองเป็น CONFIRMED; 32 ตัวอักษร base64url */
export function newCheckinToken(): string {
  return randomBytes(24).toString('base64url');
}
