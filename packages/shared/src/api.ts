import type { ErrorCode } from './error-codes.js';
import type { PaginationMeta } from './pagination.js';

/** Prefix ของ REST API ทั้งระบบ (Overview §11) */
export const API_PREFIX = '/api/v1';

/** header ที่ API ส่งกลับทุก response — ใช้อ้างอิง log เวลาแจ้งปัญหา */
export const REQUEST_ID_HEADER = 'x-request-id';

/** Response มาตรฐาน `{ data, meta? }` */
export interface ApiResponse<T, M = unknown> {
  data: T;
  meta?: M;
}

export type PaginatedResponse<T> = ApiResponse<T[], PaginationMeta>;

/** Error มาตรฐาน `{ error: { code, message, details? } }` */
export interface ApiErrorResponse {
  error: {
    code: ErrorCode;
    message: string;
    details?: unknown;
  };
}

export interface HealthStatus {
  status: 'ok';
  uptime: number;
  timestamp: string;
}
