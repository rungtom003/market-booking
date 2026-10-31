/** Prefix ของ REST API ทั้งระบบ (Overview §11) */
export const API_PREFIX = '/api/v1';

/** Response มาตรฐาน `{ data, meta? }` */
export interface ApiResponse<T, M = unknown> {
  data: T;
  meta?: M;
}

/** Error มาตรฐาน `{ error: { code, message, details? } }` */
export interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export interface HealthStatus {
  status: 'ok';
  uptime: number;
  timestamp: string;
}
