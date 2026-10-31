import type { ErrorCode } from './error-codes.js';

type Details = Record<string, unknown> | undefined;

const seconds = (d: Details) => {
  const s = Number(d?.retryAfterSeconds);
  if (!Number.isFinite(s) || s <= 0) return '';
  return s >= 120 ? ` อีกประมาณ ${Math.ceil(s / 60)} นาที` : ` อีก ${Math.ceil(s)} วินาที`;
};

/**
 * ข้อความภาษาไทยที่แสดงผู้ใช้ตาม error code (Overview §11) — ใช้ทั้งแอปผู้ค้าและ admin
 * `message` จาก API เป็นภาษาอังกฤษสำหรับ developer จึงไม่แสดงตรงๆ
 * Record ครบทุก code — เพิ่ม code ใหม่แล้วลืมใส่ข้อความ typecheck จะไม่ผ่าน
 */
export const ERROR_MESSAGES_TH: Record<ErrorCode, string | ((details: Details) => string)> = {
  VALIDATION_ERROR: 'ข้อมูลไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง',
  BAD_REQUEST: 'คำขอไม่ถูกต้อง กรุณาลองใหม่',
  UNAUTHORIZED: 'กรุณาเข้าสู่ระบบอีกครั้ง',
  FORBIDDEN: 'คุณไม่มีสิทธิ์ทำรายการนี้',
  NOT_FOUND: 'ไม่พบข้อมูลที่ต้องการ',
  CONFLICT: 'ข้อมูลถูกเปลี่ยนแปลงหรือมีอยู่แล้ว กรุณาโหลดใหม่',
  RATE_LIMITED: (d) => `ทำรายการถี่เกินไป กรุณารอ${seconds(d) || 'สักครู่'}แล้วลองใหม่`,
  INTERNAL_ERROR: 'ระบบขัดข้อง กรุณาลองใหม่อีกครั้ง',
  SERVICE_UNAVAILABLE: 'บริการไม่พร้อมใช้งานชั่วคราว กรุณาลองใหม่ภายหลัง',

  INVALID_CREDENTIALS: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง',
  ACCOUNT_LOCKED: (d) =>
    `เข้าสู่ระบบผิดหลายครั้ง บัญชีถูกล็อคชั่วคราว กรุณารอ${seconds(d) || 'สักครู่'}`,
  USERNAME_TAKEN: 'ชื่อผู้ใช้นี้ถูกใช้แล้ว',
  OTP_EXPIRED: 'รหัส OTP หมดอายุหรือถูกใช้ไปแล้ว กรุณาขอรหัสใหม่',
  LINE_ALREADY_LINKED: 'บัญชี LINE นี้ผูกกับผู้ค้ารายอื่นแล้ว',
  PHONE_ALREADY_REGISTERED: 'เบอร์นี้สมัครสมาชิกไว้แล้ว กรุณาเข้าสู่ระบบด้วยรหัส OTP',
  STALL_CODE_TAKEN: (d) => {
    const codes = Array.isArray(d?.codes) ? (d.codes as string[]) : [];
    if (codes.length === 0) return 'รหัสล็อคนี้มีอยู่แล้ว';
    const shown = codes.slice(0, 5).join(', ');
    return `รหัสล็อคซ้ำกับที่มีอยู่แล้ว: ${shown}${codes.length > 5 ? ` และอีก ${codes.length - 5} รายการ` : ''}`;
  },
  RESOURCE_IN_USE: 'ลบไม่ได้เพราะมีข้อมูลที่ใช้งานอยู่',
  UPLOAD_INVALID: 'ไฟล์รูปไม่ถูกต้อง (รองรับ JPG, PNG, WebP ไม่เกิน 5 MB) กรุณาอัปโหลดใหม่',

  ROUND_NOT_OPEN: 'ยังไม่อยู่ในช่วงเวลาเปิดจอง',
  STALL_TAKEN: 'ล็อคนี้มีผู้จองแล้ว กรุณาเลือกล็อคอื่น',
  STALL_UNAVAILABLE: 'ล็อคนี้ไม่เปิดให้จอง',
  QUOTA_EXCEEDED: 'คุณจองครบจำนวนที่กำหนดสำหรับวันนี้แล้ว',
  CATEGORY_NOT_ALLOWED: 'ประเภทสินค้าของคุณไม่ตรงกับโซนนี้',
  VENDOR_NOT_APPROVED: 'บัญชีของคุณยังไม่ได้รับการอนุมัติ',
  VENDOR_SUSPENDED: 'บัญชีของคุณถูกระงับชั่วคราว',
  HOLD_EXPIRED: 'หมดเวลายืนยันการจอง กรุณาเลือกใหม่',
  INVALID_STATE_TRANSITION: 'รายการนี้ถูกเปลี่ยนสถานะไปแล้ว กรุณาโหลดใหม่',
  CANCEL_WINDOW_PASSED: 'เลยกำหนดเวลายกเลิกการจองแล้ว',
  OTP_INVALID: (d) => {
    const left = Number(d?.attemptsLeft);
    if (!Number.isFinite(left)) return 'รหัส OTP ไม่ถูกต้อง';
    return left > 0
      ? `รหัส OTP ไม่ถูกต้อง (กรอกได้อีก ${left} ครั้ง)`
      : 'รหัส OTP ไม่ถูกต้องเกินจำนวนครั้ง กรุณาขอรหัสใหม่';
  },
};

export function errorMessageTh(code: string, details?: unknown): string {
  const entry = ERROR_MESSAGES_TH[code as ErrorCode];
  if (!entry) return ERROR_MESSAGES_TH.INTERNAL_ERROR as string;
  return typeof entry === 'function' ? entry(details as Details) : entry;
}
