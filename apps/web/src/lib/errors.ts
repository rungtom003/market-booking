import { errorMessageTh } from '@market-booking/shared';
import type { ApiErrorResponse, ValidationIssue } from '@market-booking/shared';
import { isAxiosError } from 'axios';
import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';

export interface ApiError {
  code: string;
  details?: unknown;
}

/** แปลง error ทุกแบบ (API, network) เป็น `{ code, details }` */
export function toApiError(error: unknown): ApiError {
  if (isAxiosError<ApiErrorResponse>(error)) {
    const body = error.response?.data?.error;
    if (body?.code) return { code: body.code, details: body.details };
    if (!error.response) return { code: 'NETWORK_ERROR' };
  }
  return { code: 'INTERNAL_ERROR' };
}

export function errorCode(error: unknown): string {
  return toApiError(error).code;
}

/** ข้อความภาษาไทยสำหรับแสดงผู้ใช้ */
export function errorMessage(error: unknown): string {
  const { code, details } = toApiError(error);
  if (code === 'NETWORK_ERROR')
    return 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่';
  return errorMessageTh(code, details);
}

/**
 * ใส่ข้อผิดพลาดรายฟิลด์จาก API (VALIDATION_ERROR / UPLOAD_INVALID) ลงฟอร์ม
 * คืน true ถ้าใส่ได้อย่างน้อย 1 ฟิลด์ (ไม่ต้องแสดง error รวมซ้ำ)
 */
export function applyFieldErrors<T extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<T>,
  fields: readonly string[],
): boolean {
  const { code, details } = toApiError(error);
  let applied = false;
  if (code === 'VALIDATION_ERROR' && Array.isArray(details)) {
    for (const issue of details as ValidationIssue[]) {
      if (fields.includes(issue.path)) {
        setError(issue.path as Path<T>, { message: issue.message });
        applied = true;
      }
    }
  }
  const field = (details as { field?: string } | undefined)?.field;
  if (code === 'UPLOAD_INVALID' && field && fields.includes(field)) {
    setError(field as Path<T>, { message: errorMessageTh(code) });
    applied = true;
  }
  return applied;
}
