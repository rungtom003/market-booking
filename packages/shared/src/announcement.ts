import { z } from 'zod';

/** ประกาศของตลาด (Phase 9.3) — ผู้ค้าเห็นที่หน้าแรกระหว่าง publishAt ถึง expireAt */
const fields = {
  title: z.string().trim().min(1, 'กรุณากรอกหัวข้อ').max(200, 'หัวข้อยาวได้ไม่เกิน 200 ตัวอักษร'),
  body: z.string().trim().min(1, 'กรุณากรอกรายละเอียด').max(5000, 'ยาวได้ไม่เกิน 5,000 ตัวอักษร'),
  publishAt: z.iso.datetime({ offset: true, error: 'วันเวลาไม่ถูกต้อง' }),
  /** null = แสดงจนกว่าจะลบ */
  expireAt: z.iso.datetime({ offset: true, error: 'วันเวลาไม่ถูกต้อง' }).nullable(),
  isPinned: z.boolean(),
  /** ส่ง LINE ถึงผู้ค้าทุกคนที่เชื่อม LINE ครั้งเดียวเมื่อถึงเวลาเผยแพร่ (ส่งแล้วแก้ไม่ส่งซ้ำ) */
  broadcastLine: z.boolean(),
};

const expireAfterPublish = (v: { publishAt?: string; expireAt?: string | null }) =>
  !v.publishAt || !v.expireAt || Date.parse(v.expireAt) > Date.parse(v.publishAt);
const expireMessage = { message: 'เวลาสิ้นสุดต้องหลังเวลาเผยแพร่', path: ['expireAt'] };

export const createAnnouncementSchema = z
  .object({
    ...fields,
    expireAt: fields.expireAt.default(null),
    isPinned: fields.isPinned.default(false),
    broadcastLine: fields.broadcastLine.default(false),
  })
  .strict()
  .refine(expireAfterPublish, expireMessage);
export type CreateAnnouncementInput = z.infer<typeof createAnnouncementSchema>;

export const updateAnnouncementSchema = z
  .object(fields)
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'ไม่มีข้อมูลที่เปลี่ยนแปลง')
  .refine(expireAfterPublish, expireMessage);
export type UpdateAnnouncementInput = z.infer<typeof updateAnnouncementSchema>;

/** `GET /announcements` — ที่กำลังแสดงอยู่ ปักหมุดก่อน แล้วใหม่สุดก่อน */
export interface Announcement {
  id: string;
  title: string;
  body: string;
  publishAt: string;
  expireAt: string | null;
  isPinned: boolean;
}

/** สถานะตามเวลา (ไม่เก็บใน DB) */
export const AnnouncementState = {
  SCHEDULED: 'SCHEDULED',
  ACTIVE: 'ACTIVE',
  EXPIRED: 'EXPIRED',
} as const;
export type AnnouncementState = (typeof AnnouncementState)[keyof typeof AnnouncementState];

export const ANNOUNCEMENT_STATE_TH: Record<AnnouncementState, string> = {
  SCHEDULED: 'ตั้งเวลาไว้',
  ACTIVE: 'กำลังแสดง',
  EXPIRED: 'หมดเวลาแล้ว',
};

export function announcementState(
  a: { publishAt: string | Date; expireAt: string | Date | null },
  now: Date,
): AnnouncementState {
  if (new Date(a.publishAt) > now) return AnnouncementState.SCHEDULED;
  if (a.expireAt && new Date(a.expireAt) <= now) return AnnouncementState.EXPIRED;
  return AnnouncementState.ACTIVE;
}

export interface AdminAnnouncement extends Announcement {
  state: AnnouncementState;
  broadcastLine: boolean;
  /** เริ่มส่ง LINE แล้วเมื่อ — null = ยังไม่ส่ง */
  broadcastedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
