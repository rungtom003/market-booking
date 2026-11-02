import { z } from 'zod';

/**
 * Waiting Room (Phase 11.1) — เปิดต่อรอบด้วย `waitingRoomCapacity` (จำนวนผู้ค้าในหน้าจองพร้อมกัน)
 * ผู้ค้าเข้าคิว → ระบบปล่อยเข้าเป็นชุดเมื่อมีที่ว่าง → จองได้ภายในเวลา `waiting_room_session_minutes`
 */
export const waitingRoomCapacitySchema = z
  .number({ error: 'กรุณากรอกตัวเลข' })
  .int('ต้องเป็นจำนวนเต็ม')
  .min(1, 'อย่างน้อย 1 คน')
  .max(5000, 'ไม่เกิน 5,000 คน')
  .nullable();

export const WaitingRoomState = {
  /** รอบนี้ไม่เปิด Waiting Room — จองได้เลย */
  NOT_REQUIRED: 'NOT_REQUIRED',
  /** ยังไม่เข้าคิว (หรือเวลาในหน้าจองหมดแล้ว) */
  NOT_JOINED: 'NOT_JOINED',
  WAITING: 'WAITING',
  /** อยู่ในหน้าจองได้ถึง `admittedUntil` */
  ADMITTED: 'ADMITTED',
} as const;
export type WaitingRoomState = (typeof WaitingRoomState)[keyof typeof WaitingRoomState];

/** `GET/POST /rounds/:id/waiting-room` */
export interface WaitingRoomStatus {
  roundId: string;
  state: WaitingRoomState;
  /** ลำดับในคิว (เริ่ม 1) — เฉพาะ WAITING */
  position: number | null;
  /** จำนวนคนในคิวทั้งหมด */
  waiting: number;
  admittedUntil: string | null;
  /** เข้าคิวก่อนรอบเปิด = ลำดับสุ่มเมื่อเปิด (คนที่มาก่อนเปิดได้ก่อนคนที่มาหลังเปิดเสมอ) */
  opensAt: string;
  serverTime: string;
}

/** `GET /admin/rounds/:id/waiting-room` */
export interface WaitingRoomStats {
  enabled: boolean;
  capacity: number | null;
  waiting: number;
  admitted: number;
}
