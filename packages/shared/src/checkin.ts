import { z } from 'zod';

const BANGKOK_OFFSET_MS = 7 * 3_600_000;
const DAY_MS = 24 * 3_600_000;

/** token ใน QR check-in — ค่าสุ่ม 24 byte (base64url 32 ตัว) ที่สร้างตอนการจองเป็น CONFIRMED */
export const CHECKIN_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32}$/;

/** `POST /admin/checkin/scan` — วันขายที่เจ้าหน้าที่กำลัง check-in อยู่ + ข้อความจาก QR */
export const checkinScanSchema = z
  .object({
    marketDayId: z.uuid(),
    token: z.string().trim().regex(CHECKIN_TOKEN_PATTERN, 'QR นี้ไม่ใช่ QR check-in ของระบบ'),
  })
  .strict();
export type CheckinScanInput = z.infer<typeof checkinScanSchema>;

const CLOSE_AFTER_OPEN = { message: 'เวลาปิด check-in ต้องหลังเวลาเปิด', path: ['checkinCloseAt'] };

/**
 * `PUT /admin/rounds/:id/market-days/:dayId/checkin-window` — null = ค่าเริ่มต้น
 * (เปิด 00:00 / ปิด 24:00 ของวันขาย เวลาไทย)
 */
export const checkinWindowSchema = z
  .object({
    checkinOpenAt: z.iso.datetime({ offset: true }).nullable(),
    checkinCloseAt: z.iso.datetime({ offset: true }).nullable(),
  })
  .strict()
  .refine(
    (v) => !v.checkinOpenAt || !v.checkinCloseAt || v.checkinCloseAt > v.checkinOpenAt,
    CLOSE_AFTER_OPEN,
  );
export type CheckinWindowInput = z.infer<typeof checkinWindowSchema>;

export interface CheckinWindow {
  openAt: Date;
  closeAt: Date;
}

/**
 * ช่วงเวลา check-in ของวันขาย (Overview §9.8) — ไม่ตั้ง = ทั้งวันขาย (00:00–24:00 เวลาไทย)
 * No-show นับหลัง `closeAt`
 */
export function checkinWindow(day: {
  /** YYYY-MM-DD */
  marketDate: string;
  checkinOpenAt: Date | string | null;
  checkinCloseAt: Date | string | null;
}): CheckinWindow {
  const start = Date.parse(`${day.marketDate}T00:00:00Z`) - BANGKOK_OFFSET_MS;
  return {
    openAt: day.checkinOpenAt ? new Date(day.checkinOpenAt) : new Date(start),
    closeAt: day.checkinCloseAt ? new Date(day.checkinCloseAt) : new Date(start + DAY_MS),
  };
}

export const CheckinPhase = {
  NOT_OPEN: 'NOT_OPEN',
  OPEN: 'OPEN',
  CLOSED: 'CLOSED',
} as const;
export type CheckinPhase = (typeof CheckinPhase)[keyof typeof CheckinPhase];

/** `openAt` พอดี = เปิด, `closeAt` พอดี = ปิด */
export function checkinPhase(window: CheckinWindow, now: Date): CheckinPhase {
  if (now < window.openAt) return CheckinPhase.NOT_OPEN;
  if (now < window.closeAt) return CheckinPhase.OPEN;
  return CheckinPhase.CLOSED;
}

/** เวลาไทย "HH:MM" จาก ISO */
export function formatBangkokTime(iso: string | Date): string {
  return new Date(new Date(iso).getTime() + BANGKOK_OFFSET_MS).toISOString().slice(11, 16);
}

/** `GET /bookings/:id/checkin-qr` — QR ของผู้ค้า (เฉพาะการจองที่ยืนยันแล้ว) */
export interface CheckinQr {
  bookingId: string;
  /** ข้อความที่ใส่ใน QR */
  token: string;
  stallCode: string;
  zoneName: string;
  /** YYYY-MM-DD */
  marketDate: string;
  openAt: string;
  closeAt: string;
  checkedInAt: string | null;
  /** ไม่ได้ check-in ภายในเวลา (ระบบนับแล้ว) */
  noshow: boolean;
}

/** การจองที่ยืนยันแล้ว 1 รายการในหน้า check-in */
export interface CheckinEntry {
  bookingId: string;
  stall: { id: string; code: string; zoneName: string };
  vendor: { id: string; name: string; shopName: string | null; phone: string };
  checkedInAt: string | null;
  noshow: boolean;
}

/** `GET /admin/checkin?date=` — วันขายของวันที่นั้น (ไม่มี = null) */
export interface CheckinDay {
  marketDay: {
    id: string;
    marketDate: string;
    openAt: string;
    closeAt: string;
    phase: CheckinPhase;
    /** ระบบนับ No-show ของวันนี้แล้ว */
    noshowProcessed: boolean;
  };
  /** เรียงตามรหัสล็อค */
  entries: CheckinEntry[];
}

/** ผล check-in — สแกนซ้ำได้ `alreadyCheckedIn: true` (ไม่นับซ้ำ) */
export interface CheckinResult {
  alreadyCheckedIn: boolean;
  marketDayId: string;
  entry: CheckinEntry;
}
