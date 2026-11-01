import { ErrorCode } from '@market-booking/shared';
import { AppException } from '../../common/exceptions/app.exception';

/**
 * ผู้ให้บริการ (SMS/LINE) ส่งไม่สำเร็จ — เป็น SERVICE_UNAVAILABLE สำหรับ flow ที่รอผล (OTP)
 * และบอก queue `notification` ว่าควรส่งใหม่ไหม:
 *   retryable  = เครือข่าย/5xx/429/เครดิตหมด → ลองใหม่ภายหลัง
 *   ไม่ retry  = ข้อมูลผิด (เบอร์/ผู้รับ/ข้อความ/การตั้งค่า) → ส่งซ้ำก็ไม่ผ่าน
 * ข้อความ error ห้ามมีเนื้อหาที่ส่ง (อาจมี OTP) — ใส่แค่สถานะ/รหัสจากผู้ให้บริการ
 */
export class DeliveryError extends AppException {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(ErrorCode.SERVICE_UNAVAILABLE, message);
  }
}

/** error อื่นที่ไม่รู้จัก (เช่น bug, DB หลุด) ให้ลองใหม่; AppException อื่น = ตั้งค่าไม่ครบ → ไม่ลองใหม่ */
export function isRetryable(error: unknown): boolean {
  if (error instanceof DeliveryError) return error.retryable;
  return !(error instanceof AppException);
}

/** HTTP status ของผู้ให้บริการ → ลองใหม่ได้ไหม (429 และ 5xx = ชั่วคราว) */
export function retryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}
