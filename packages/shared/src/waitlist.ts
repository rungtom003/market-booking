import { z } from 'zod';
import type { WaitlistStatus } from './enums.js';

/** คิวที่ยังรออยู่ (WAITING + ได้สิทธิ์แล้วรอยืนยัน) ต่อผู้ค้าต่อวันขาย */
export const MAX_WAITLIST_PER_DAY = 5;

/**
 * `POST /waitlists` — เข้าคิวล็อคที่ไม่ว่าง (`stallId`) หรือทั้งโซนที่เต็ม (`zoneId`) อย่างใดอย่างหนึ่ง
 * (Overview §9.7)
 */
export const joinWaitlistSchema = z
  .object({
    marketDayId: z.uuid(),
    stallId: z.uuid().optional(),
    zoneId: z.uuid().optional(),
  })
  .strict()
  .refine((v) => Boolean(v.stallId) !== Boolean(v.zoneId), {
    message: 'เลือกเข้าคิวล็อคหรือโซนอย่างใดอย่างหนึ่ง',
    path: ['stallId'],
  });
export type JoinWaitlistInput = z.infer<typeof joinWaitlistSchema>;

export const WAITLIST_STATUS_TH: Record<WaitlistStatus, string> = {
  WAITING: 'รอคิว',
  NOTIFIED: 'ได้สิทธิ์ รอยืนยัน',
  FULFILLED: 'ได้ล็อคแล้ว',
  EXPIRED: 'หมดเวลายืนยัน',
  CANCELLED: 'ออกจากคิว',
};

export interface WaitlistEntry {
  id: string;
  marketDay: { id: string; marketDate: string; roundName: string };
  /** null = เข้าคิวทั้งโซน */
  stall: { id: string; code: string } | null;
  zone: { id: string; name: string };
  status: WaitlistStatus;
  /** จำนวนคิวที่รออยู่ก่อนหน้าสำหรับล็อค/โซนเดียวกัน (WAITING เท่านั้น — 0 = คิวแรก) */
  ahead: number;
  /** ได้สิทธิ์แล้ว: การจอง HOLD ที่ระบบสร้างให้ + เวลาที่ต้องยืนยันก่อน */
  bookingId: string | null;
  expiresAt: string | null;
  createdAt: string;
}

export interface AdminWaitlistEntry extends WaitlistEntry {
  position: number;
  vendor: { id: string; name: string; shopName: string | null; phone: string };
}
