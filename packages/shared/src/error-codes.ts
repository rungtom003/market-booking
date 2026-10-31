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
  /** ลบไม่ได้เพราะมีข้อมูลอื่นอ้างถึง (เช่น ล็อคที่มีประวัติการจอง) — `details` บอกจำนวนที่อ้างถึง */
  RESOURCE_IN_USE: 'RESOURCE_IN_USE',

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
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

/** รายละเอียดของ VALIDATION_ERROR — 1 รายการต่อ field ที่ผิด */
export interface ValidationIssue {
  /** เช่น `phone` หรือ `items.0.price` */
  path: string;
  message: string;
  code: string;
}
