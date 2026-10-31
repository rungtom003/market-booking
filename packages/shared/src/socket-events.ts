import { z } from 'zod';
import type { BookingStatus, RoundStatus } from './enums.js';
import type { ErrorCode } from './error-codes.js';
import type { StallDayStatus } from './market.js';

/** Socket.IO namespace สำหรับการจอง (Overview §10.1) */
export const SOCKET_NAMESPACE = '/booking';

/** ชื่อ event ทั้งหมด (Overview §10.2) — ห้ามประกาศ string ซ้ำที่อื่น */
export const SocketEvent = {
  // Client → Server
  MD_JOIN: 'md:join',
  MD_LEAVE: 'md:leave',
  // Server → Client
  STALL_UPDATED: 'stall:updated',
  ROUND_CHANGED: 'round:changed',
  BOOKING_CHANGED: 'booking:changed',
  WAITLIST_OFFER: 'waitlist:offer',
  SERVER_TIME: 'server:time',
  // Server → Admin
  VENDOR_REGISTERED: 'vendor:registered',
  PAYMENT_SUBMITTED: 'payment:submitted',
} as const;

export type SocketEvent = (typeof SocketEvent)[keyof typeof SocketEvent];

export const socketRoom = {
  marketDay: (marketDayId: string) => `md:${marketDayId}`,
  vendor: (vendorId: string) => `vendor:${vendorId}`,
  admin: (marketId: string) => `admin:${marketId}`,
  /** ทุก socket ของตลาด (ผู้ค้า + admin) — ใช้ส่ง `round:changed` */
  market: (marketId: string) => `market:${marketId}`,
} as const;

/** socket หนึ่ง join ห้องวันขาย (`md:*`) พร้อมกันได้ไม่เกินนี้ */
export const MAX_MARKET_DAY_ROOMS_PER_SOCKET = 3;

export const marketDayRoomSchema = z.object({ marketDayId: z.uuid() }).strict();
export type MarketDayRoomPayload = z.infer<typeof marketDayRoomSchema>;

/** ack ของ `md:join` / `md:leave` */
export type SocketAck = { ok: true } | { ok: false; code: ErrorCode };

export interface ServerTimePayload {
  /** ISO เวลา server */
  now: string;
}

/** สถานะล็อคล่าสุด (อ่านจาก DB ตอนส่ง) — `mine` เป็น true เฉพาะ socket ของเจ้าของการจอง */
export interface StallUpdatedPayload {
  marketDayId: string;
  stallId: string;
  state: StallDayStatus;
  mine: boolean;
  updatedAt: string;
}

/** ส่งเฉพาะห้อง `vendor:{id}` ของเจ้าของการจอง */
export interface BookingChangedPayload {
  bookingId: string;
  marketDayId: string;
  stallId: string;
  status: BookingStatus;
  holdExpiresAt: string | null;
  paymentDueAt: string | null;
}

/** รอบที่ผู้ค้าเห็นเปลี่ยน (เผยแพร่/แก้เวลา/ยกเลิก/วันขายเปลี่ยน) — client โหลด `/rounds/current` ใหม่ */
export interface RoundChangedPayload {
  roundId: string;
  openAt: string;
  closeAt: string;
  status: RoundStatus;
}

/** ส่งห้อง admin — ไม่มีข้อมูลส่วนตัว (admin โหลดรายการเอง) */
export interface VendorRegisteredPayload {
  vendorId: string;
}
