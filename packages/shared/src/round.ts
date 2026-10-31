import { z } from 'zod';
import { RoundPhase, RoundStatus } from './enums.js';
import { priceSchema } from './market.js';

// ───────────── วันที่ ─────────────

/** วันที่แบบ `YYYY-MM-DD` (คอลัมน์ date — ไม่ผูก timezone) */
export const isoDateSchema = z.iso.date({ error: 'วันที่ไม่ถูกต้อง' });

/** `2026-11-07` → "7 พ.ย. 2569" */
export function formatIsoDateTh(date: string, weekday = false): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('th-TH', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    ...(weekday && { weekday: 'short' }),
  });
}

/** ทุกวันเสาร์-อาทิตย์ของเดือน (`month` 1–12) เรียงตามวันที่ — ตัวช่วยเลือกวันขาย */
export function weekendDatesOfMonth(year: number, month: number): string[] {
  const dates: string[] = [];
  for (let d = new Date(Date.UTC(year, month - 1, 1)); d.getUTCMonth() === month - 1;) {
    const dow = d.getUTCDay();
    if (dow === 0 || dow === 6) dates.push(d.toISOString().slice(0, 10));
    d = new Date(d.getTime() + 86_400_000);
  }
  return dates;
}

// ───────────── รอบการจอง ─────────────

const dateTimeSchema = z.iso.datetime({ offset: true, error: 'วันเวลาไม่ถูกต้อง' });

const roundFields = {
  name: z.string().trim().min(1, 'กรุณากรอกชื่อรอบ').max(200),
  /** ISO datetime — เวลาเปิด/ปิดจองตามเวลา server */
  openAt: dateTimeSchema,
  closeAt: dateTimeSchema,
  /** จำนวนล็อคสูงสุดต่อผู้ค้า ต่อ 1 วันขาย */
  maxStallsPerVendor: z
    .number({ error: 'กรุณากรอกตัวเลข' })
    .int('ต้องเป็นจำนวนเต็ม')
    .min(1, 'อย่างน้อย 1 ล็อค')
    .max(50, 'ไม่เกิน 50 ล็อค'),
};

const closeAfterOpen = (v: { openAt?: string; closeAt?: string }) =>
  !v.openAt || !v.closeAt || Date.parse(v.closeAt) > Date.parse(v.openAt);
const CLOSE_AFTER_OPEN = { path: ['closeAt'], message: 'เวลาปิดจองต้องหลังเวลาเปิดจอง' };

/** ไม่ระบุ `maxStallsPerVendor` = ใช้ setting `max_stalls_per_vendor_default` */
export const createRoundSchema = z
  .object({ ...roundFields, maxStallsPerVendor: roundFields.maxStallsPerVendor.optional() })
  .refine(closeAfterOpen, CLOSE_AFTER_OPEN);
export type CreateRoundInput = z.infer<typeof createRoundSchema>;

export const updateRoundSchema = z
  .object(roundFields)
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'ไม่มีข้อมูลที่เปลี่ยนแปลง')
  .refine(closeAfterOpen, CLOSE_AFTER_OPEN);
export type UpdateRoundInput = z.infer<typeof updateRoundSchema>;

/** เพิ่มได้ครั้งละไม่เกินนี้ */
export const MAX_MARKET_DAYS_PER_REQUEST = 62;

export const addMarketDaysSchema = z.object({
  dates: z
    .array(isoDateSchema)
    .min(1, 'กรุณาเลือกวันขายอย่างน้อย 1 วัน')
    .max(MAX_MARKET_DAYS_PER_REQUEST, `เลือกได้ครั้งละไม่เกิน ${MAX_MARKET_DAYS_PER_REQUEST} วัน`)
    .transform((dates) => [...new Set(dates)].sort()),
});
export type AddMarketDaysInput = z.infer<typeof addMarketDaysSchema>;

/** ยกเลิก/คืนสถานะวันขาย */
export const updateMarketDaySchema = z.object({ isCancelled: z.boolean() }).strict();
export type UpdateMarketDayInput = z.infer<typeof updateMarketDaySchema>;

/** ปิดล็อค/ราคาเฉพาะวัน — `priceOverride: null` + `isClosed: false` = ลบ override */
export const setStallDayOverrideSchema = z
  .object({ priceOverride: priceSchema.nullable(), isClosed: z.boolean() })
  .strict();
export type SetStallDayOverrideInput = z.infer<typeof setStallDayOverrideSchema>;

/**
 * สถานะเปิด/ปิดจองที่คำนวณจากเวลา (Overview §8.3) — `null` ถ้ารอบยังไม่ PUBLISHED หรือยกเลิกแล้ว
 * `open_at` พอดี = OPEN, `close_at` พอดี = CLOSED
 */
export function roundPhase(
  round: { status: RoundStatus; openAt: Date | string; closeAt: Date | string },
  now: Date,
): RoundPhase | null {
  if (round.status !== RoundStatus.PUBLISHED) return null;
  const t = now.getTime();
  if (t < new Date(round.openAt).getTime()) return RoundPhase.UPCOMING;
  if (t < new Date(round.closeAt).getTime()) return RoundPhase.OPEN;
  return RoundPhase.CLOSED;
}

/**
 * ส่วนต่างเวลา server − เวลาเครื่อง (ms) จาก 1 request: ถือว่า server ตอบตรงกลางระหว่างส่งกับรับ
 * คลาดไม่เกินครึ่งหนึ่งของเวลาไป-กลับ — เวลา server โดยประมาณ = `Date.now() + offset`
 */
export function estimateClockOffset(
  sentAt: number,
  serverTime: string,
  receivedAt: number,
): number {
  return Date.parse(serverTime) - (sentAt + receivedAt) / 2;
}

export interface RoundMarketDay {
  id: string;
  /** YYYY-MM-DD */
  marketDate: string;
  isCancelled: boolean;
  /** จำนวนล็อคที่ตั้งค่าเฉพาะวัน (ปิด/ราคา) */
  overrideCount: number;
  /** การจองที่ยังมีผล — มากกว่า 0 ลบวันไม่ได้ */
  bookingCount: number;
}

export interface Round {
  id: string;
  name: string;
  openAt: string;
  closeAt: string;
  maxStallsPerVendor: number;
  status: RoundStatus;
  /** คำนวณจากเวลา server ตอนตอบ — `null` ถ้าไม่ใช่ PUBLISHED */
  phase: RoundPhase | null;
  /** วันขายที่ไม่ถูกยกเลิก */
  marketDayCount: number;
  firstMarketDate: string | null;
  lastMarketDate: string | null;
  createdAt: string;
}

export interface RoundDetail extends Round {
  /** เรียงตามวันที่ รวมวันที่ยกเลิกแล้ว */
  marketDays: RoundMarketDay[];
}

export interface StallDayOverride {
  stallId: string;
  stallCode: string;
  priceOverride: number | null;
  isClosed: boolean;
}

/** รอบที่ผู้ค้าเห็น (`GET /rounds/current`) */
export interface CurrentRound {
  id: string;
  name: string;
  openAt: string;
  closeAt: string;
  maxStallsPerVendor: number;
  phase: typeof RoundPhase.UPCOMING | typeof RoundPhase.OPEN;
  /** วันขายที่ไม่ถูกยกเลิก เรียงตามวันที่ */
  marketDays: { id: string; marketDate: string }[];
}

export interface CurrentRoundResponse {
  /** เวลา server ตอนตอบ — ใช้หา offset ให้ Countdown ตรงแม้นาฬิกาเครื่องผิด */
  serverTime: string;
  /** รอบที่เปิดจองอยู่ (ปิดก่อนขึ้นก่อน) หรือรอบถัดไปที่ใกล้ที่สุด; ไม่มี = `null` */
  round: CurrentRound | null;
}
