import { z } from 'zod';
import { BookingStatus } from './enums.js';
import { type MarketDayStall, type MarketDayStalls, priceSchema } from './market.js';
import { paginationQuerySchema } from './pagination.js';

const { PENDING_PAYMENT, PENDING_VERIFY, CONFIRMED, CANCELLED, EXPIRED } = BookingStatus;

/** การเปลี่ยนสถานะที่อนุญาต (Overview §8.2) — สถานะสุดท้าย (CANCELLED/EXPIRED) ไปต่อไม่ได้ */
export const BOOKING_TRANSITIONS: Record<BookingStatus, readonly BookingStatus[]> = {
  HOLD: [PENDING_PAYMENT, CONFIRMED, EXPIRED, CANCELLED],
  // CONFIRMED = เจ้าหน้าที่รับเงินสดก่อนผู้ค้าส่งสลิป (§9.5 ข้อ 5)
  PENDING_PAYMENT: [PENDING_VERIFY, CONFIRMED, EXPIRED, CANCELLED],
  PENDING_VERIFY: [CONFIRMED, PENDING_PAYMENT, CANCELLED],
  CONFIRMED: [CANCELLED],
  CANCELLED: [],
  EXPIRED: [],
};

/** ชื่อสถานะภาษาไทย — ใช้ทั้งเว็บผู้ค้า, admin และไฟล์ export */
export const BOOKING_STATUS_TH: Record<BookingStatus, string> = {
  HOLD: 'รอยืนยัน',
  PENDING_PAYMENT: 'รอชำระเงิน',
  PENDING_VERIFY: 'รอตรวจสลิป',
  CONFIRMED: 'จองสำเร็จ',
  CANCELLED: 'ยกเลิกแล้ว',
  EXPIRED: 'หมดเวลา',
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

// ───────────── admin ─────────────

/** สถานะที่กรองได้ในตารางการจอง — `ACTIVE` = HOLD/รอชำระ/รอตรวจ/ยืนยันแล้ว */
export const adminBookingStatusFilterSchema = z.enum([
  'ACTIVE',
  BookingStatus.HOLD,
  PENDING_PAYMENT,
  PENDING_VERIFY,
  CONFIRMED,
  CANCELLED,
  EXPIRED,
]);
export type AdminBookingStatusFilter = z.infer<typeof adminBookingStatusFilterSchema>;

export const adminBookingListQuerySchema = paginationQuerySchema.extend({
  marketDayId: z.uuid().optional(),
  status: adminBookingStatusFilterSchema.optional(),
  /** ค้นหาชื่อ / ชื่อร้าน / เบอร์ผู้ค้า หรือรหัสล็อค */
  q: z.string().trim().max(100).optional(),
});
export type AdminBookingListQuery = z.infer<typeof adminBookingListQuerySchema>;

/**
 * จองแทนผู้ค้า (Overview §11 `POST /admin/bookings`) — ข้ามรอบ/โควตา/ล็อคสงวน/ปิดเฉพาะวัน/ประเภทสินค้าได้
 * แต่ไม่ข้าม unique index (ล็อคที่มีการจองอยู่ = `STALL_TAKEN`); ไม่ระบุราคา = ราคาของวันนั้น
 */
export const adminCreateBookingSchema = z
  .object({
    vendorId: z.uuid('กรุณาเลือกผู้ค้า'),
    stallId: z.uuid(),
    marketDayId: z.uuid(),
    status: z.enum([CONFIRMED, PENDING_PAYMENT]).default(CONFIRMED),
    amount: priceSchema.optional(),
  })
  .strict();
export type AdminCreateBookingInput = z.infer<typeof adminCreateBookingSchema>;

export interface AdminBooking extends Booking {
  vendor: { id: string; name: string; shopName: string | null; phone: string };
}

/** ตัวเลือกวันขายในหน้าจัดการการจอง — วันขายของรอบที่ไม่ใช่ DRAFT ตั้งแต่ 30 วันก่อน */
export interface AdminMarketDayOption {
  id: string;
  marketDate: string;
  roundId: string;
  roundName: string;
  isCancelled: boolean;
  /** การจองที่ยังมีผล */
  activeBookings: number;
}

/** ผังวันขายฝั่ง admin — เห็นผู้ค้าของแต่ละล็อค (ห้ามส่งให้ผู้ค้า) */
export interface AdminMarketDayStalls extends Omit<MarketDayStalls, 'stalls'> {
  stalls: (MarketDayStall & {
    booking: {
      id: string;
      status: BookingStatus;
      amount: number;
      holdExpiresAt: string | null;
      paymentDueAt: string | null;
      vendor: { id: string; name: string; shopName: string | null; phone: string };
    } | null;
  })[];
}
