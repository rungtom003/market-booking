import { z } from 'zod';
import { BookingStatus } from './enums.js';

const { PENDING_PAYMENT, PENDING_VERIFY, CONFIRMED, CANCELLED, EXPIRED } = BookingStatus;

/** การเปลี่ยนสถานะที่อนุญาต (Overview §8.2) — สถานะสุดท้าย (CANCELLED/EXPIRED) ไปต่อไม่ได้ */
export const BOOKING_TRANSITIONS: Record<BookingStatus, readonly BookingStatus[]> = {
  HOLD: [PENDING_PAYMENT, CONFIRMED, EXPIRED, CANCELLED],
  PENDING_PAYMENT: [PENDING_VERIFY, EXPIRED, CANCELLED],
  PENDING_VERIFY: [CONFIRMED, PENDING_PAYMENT, CANCELLED],
  CONFIRMED: [CANCELLED],
  CANCELLED: [],
  EXPIRED: [],
};

export function canTransition(from: BookingStatus, to: BookingStatus): boolean {
  return BOOKING_TRANSITIONS[from].includes(to);
}

/** จองล็อคได้ไม่เกิน 5 ครั้ง / 10 วินาที ต่อผู้ค้า (Overview §10.4) */
export const HOLD_RATE_LIMIT = { limit: 5, windowSeconds: 10 } as const;

export const holdBookingSchema = z
  .object({ stallId: z.uuid('ไม่พบล็อค'), marketDayId: z.uuid('ไม่พบวันขาย') })
  .strict();
export type HoldBookingInput = z.infer<typeof holdBookingSchema>;

/** ผู้ค้ายกเลิกเอง — เหตุผลไม่บังคับ */
export const cancelBookingSchema = z
  .object({ reason: z.string().trim().max(500).optional() })
  .strict();
export type CancelBookingInput = z.infer<typeof cancelBookingSchema>;

/** Admin ยกเลิกแทน — ต้องระบุเหตุผล (Overview §9.6) */
export const adminCancelBookingSchema = z
  .object({ reason: z.string().trim().min(1, 'กรุณาระบุเหตุผล').max(500) })
  .strict();
export type AdminCancelBookingInput = z.infer<typeof adminCancelBookingSchema>;

export interface Booking {
  id: string;
  status: BookingStatus;
  /** ราคา ณ เวลาจอง (รวมราคาเฉพาะวัน) */
  amount: number;
  stall: { id: string; code: string; zoneName: string };
  marketDay: { id: string; marketDate: string; roundName: string };
  holdExpiresAt: string | null;
  paymentDueAt: string | null;
  confirmedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  /** ยกเลิกโดยเจ้าหน้าที่ (ไม่เปิดเผยว่าใคร) */
  cancelledByAdmin: boolean;
  createdAt: string;
}
