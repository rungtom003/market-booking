import { API_PREFIX, ActorType } from '@market-booking/shared';

/** Access token 15 นาที / Refresh 7 วัน (Overview §4) */
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

/** ล็อคชั่วคราวเมื่อ login ผิด 5 ครั้งใน 15 นาที — ล็อค 15 นาทีนับจากครั้งที่ 5 */
export const MAX_LOGIN_FAILURES = 5;
export const LOGIN_FAILURE_WINDOW_SECONDS = 15 * 60;

/** login ทั่วไปต่อ IP (นอกเหนือจากการล็อคต่อ username) */
export const LOGIN_RATE_LIMIT = { limit: 10, ttl: 60_000 };

/**
 * cookie แยกตามประเภทผู้ใช้ — เปิดแอป admin กับ vendor ในเบราว์เซอร์เดียวกันได้โดยไม่ทับกัน
 * path จำกัดไว้ที่ /api/v1/auth ให้ browser ส่ง cookie เฉพาะตอน refresh/logout
 */
export const REFRESH_COOKIE = {
  [ActorType.ADMIN]: 'mb_admin_rt',
  [ActorType.VENDOR]: 'mb_vendor_rt',
} as const;
export const REFRESH_COOKIE_PATH = `${API_PREFIX}/auth`;

export const JWT_ISSUER = 'market-booking';
