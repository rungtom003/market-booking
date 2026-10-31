import { errorMessageTh } from '@market-booking/shared';
import type { ApiErrorResponse } from '@market-booking/shared';
import { isAxiosError } from 'axios';

/** ข้อความภาษาไทยของ error จาก API (ใช้ชุดเดียวกับแอปผู้ค้า) */
export function errorMessage(error: unknown): string {
  if (isAxiosError<ApiErrorResponse>(error)) {
    const body = error.response?.data?.error;
    if (body?.code) {
      // VALIDATION_ERROR: แสดงข้อความของฟิลด์แรกด้วย ให้รู้ว่าผิดตรงไหน
      const first = Array.isArray(body.details) ? (body.details[0] as { message?: string }) : null;
      const base = errorMessageTh(body.code, body.details);
      return first?.message ? `${base}: ${first.message}` : base;
    }
    if (!error.response) return 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ต';
  }
  return errorMessageTh('INTERNAL_ERROR');
}

/** code ของ error จาก API (ไม่ใช่ error ของ API = '') */
export function errorCode(error: unknown): string {
  return isAxiosError<ApiErrorResponse>(error) ? (error.response?.data?.error?.code ?? '') : '';
}
