/** Error code ของระบบ (Overview §11) — frontend แปลงเป็นข้อความภาษาไทยจาก code นี้ */
export const ErrorCode = {
  // ทั่วไป
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  BAD_REQUEST: 'BAD_REQUEST',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  /** บริการภายนอก (SMS, LINE) ใช้ไม่ได้หรือยังไม่ได้ตั้งค่า */
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',

  // Auth
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
  USERNAME_TAKEN: 'USERNAME_TAKEN',
  OTP_EXPIRED: 'OTP_EXPIRED',
  LINE_ALREADY_LINKED: 'LINE_ALREADY_LINKED',
  /** เบอร์นี้มีบัญชีแล้ว — ให้ยืนยัน OTP เพื่อ login แทนการสมัครใหม่ */
  PHONE_ALREADY_REGISTERED: 'PHONE_ALREADY_REGISTERED',
  /** ไฟล์ที่อ้างถึงไม่มี / ไม่ใช่ของผู้ใช้นี้ / ชนิดหรือขนาดไม่ถูกต้อง */
  UPLOAD_INVALID: 'UPLOAD_INVALID',

  // ตั้งค่าตลาด
  /** รหัสล็อคซ้ำในตลาด — `details.codes` */
  STALL_CODE_TAKEN: 'STALL_CODE_TAKEN',
  LAYOUT_OUTDATED: 'LAYOUT_OUTDATED',
  WAITLIST_NOT_NEEDED: 'WAITLIST_NOT_NEEDED',
  WAITLIST_ALREADY_JOINED: 'WAITLIST_ALREADY_JOINED',
  WAITLIST_LIMIT_REACHED: 'WAITLIST_LIMIT_REACHED',
  /** ลบไม่ได้เพราะมีข้อมูลอื่นอ้างถึง (เช่น ล็อคที่มีประวัติการจอง) — `details` บอกจำนวนที่อ้างถึง */
  RESOURCE_IN_USE: 'RESOURCE_IN_USE',

  // รอบการจอง
  /** วันขายซ้ำกับวันที่มีอยู่แล้ว (รอบนี้หรือรอบอื่นที่ยังไม่ยกเลิก) — `details.dates` (YYYY-MM-DD) */
  MARKET_DATE_TAKEN: 'MARKET_DATE_TAKEN',
  /** แก้เวลาเปิดจองหลังรอบเปิดจองแล้วไม่ได้ (Overview §8.3) */
  ROUND_ALREADY_OPENED: 'ROUND_ALREADY_OPENED',

  // ชำระเงิน
  /** เลยกำหนดชำระแล้ว (การจองหมดอายุ) — `details.paymentDueAt` */
  PAYMENT_DUE_PASSED: 'PAYMENT_DUE_PASSED',

  // ธุรกิจ
  ROUND_NOT_OPEN: 'ROUND_NOT_OPEN',
  STALL_TAKEN: 'STALL_TAKEN',
  STALL_UNAVAILABLE: 'STALL_UNAVAILABLE',
  QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',
  CATEGORY_NOT_ALLOWED: 'CATEGORY_NOT_ALLOWED',
  VENDOR_NOT_APPROVED: 'VENDOR_NOT_APPROVED',
  VENDOR_SUSPENDED: 'VENDOR_SUSPENDED',
  HOLD_EXPIRED: 'HOLD_EXPIRED',
  INVALID_STATE_TRANSITION: 'INVALID_STATE_TRANSITION',
  CANCEL_WINDOW_PASSED: 'CANCEL_WINDOW_PASSED',
  OTP_INVALID: 'OTP_INVALID',

  // Check-in (Phase 10)
  /** ไม่พบ QR ในตลาดนี้ หรือการจองไม่ได้ยืนยันแล้ว (ยกเลิก) — `details.status` ถ้าพบการจอง */
  CHECKIN_INVALID: 'CHECKIN_INVALID',
  /** QR ของวันขายอื่น — `details.marketDate` (YYYY-MM-DD) */
  CHECKIN_WRONG_DAY: 'CHECKIN_WRONG_DAY',
  /** ยังไม่ถึงเวลาเปิด check-in — `details.openAt` */
  CHECKIN_NOT_OPEN: 'CHECKIN_NOT_OPEN',
  /** ปิด check-in แล้ว — `details.closeAt` */
  CHECKIN_CLOSED: 'CHECKIN_CLOSED',

  // Waiting Room (Phase 11.1)
  /** รอบนี้ต้องเข้าคิวก่อนจอง และยังไม่ได้เข้า/หมดเวลาในหน้าจองแล้ว — `details.roundId` */
  WAITING_ROOM_REQUIRED: 'WAITING_ROOM_REQUIRED',

  // PDPA (Phase 11.3)
  /** ลบบัญชีไม่ได้เพราะยังมีการจองที่ยังไม่ถึงวันขาย — `details.count` */
  ACCOUNT_HAS_ACTIVE_BOOKINGS: 'ACCOUNT_HAS_ACTIVE_BOOKINGS',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

/** รายละเอียดของ VALIDATION_ERROR — 1 รายการต่อ field ที่ผิด */
export interface ValidationIssue {
  /** เช่น `phone` หรือ `items.0.price` */
  path: string;
  message: string;
  code: string;
}
