import { API_PREFIX } from '@market-booking/shared';
import type { AccessTokenResponse, ApiResponse } from '@market-booking/shared';
import type { AxiosError } from 'axios';
import axios, { type InternalAxiosRequestConfig } from 'axios';
import { session } from './session';

// withCredentials เพื่อส่ง refresh token cookie (httpOnly) — path ของ cookie จำกัดไว้ที่ /api/v1/auth
export const apiClient = axios.create({
  baseURL: API_PREFIX,
  withCredentials: true,
  timeout: 15_000,
});

apiClient.interceptors.request.use((config) => {
  const token = session.accessToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

let refreshing: Promise<string | null> | null = null;

/**
 * ขอ access token ใหม่จาก refresh cookie — ยิงครั้งเดียวแม้หลาย request ได้ 401 พร้อมกัน
 * (ถ้ายิงซ้ำ token เดิมจะถูกมองว่า "ใช้ซ้ำ" และ server ตัด session ทิ้ง — Phase 1.3)
 */
export function refreshAccessToken(): Promise<string | null> {
  refreshing ??= axios
    .post<ApiResponse<AccessTokenResponse>>(
      `${API_PREFIX}/auth/refresh`,
      { actorType: 'VENDOR' },
      { withCredentials: true, timeout: 15_000 },
    )
    .then((res) => {
      session.signIn(res.data.data.accessToken);
      return res.data.data.accessToken;
    })
    .catch(() => {
      session.signOut();
      return null;
    })
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

type RetriableConfig = InternalAxiosRequestConfig & { _retried?: boolean };

// access token หมดอายุ (15 นาที) → refresh แล้วยิง request เดิมซ้ำ 1 ครั้ง
apiClient.interceptors.response.use(undefined, async (error: AxiosError) => {
  const config = error.config as RetriableConfig | undefined;
  const isAuthCall = config?.url?.startsWith('/auth/');
  if (error.response?.status === 401 && config && !config._retried && !isAuthCall) {
    config._retried = true;
    const token = await refreshAccessToken();
    if (token) return apiClient(config);
  }
  throw error;
});

/** ดึง `data` ออกจาก `{ data }` ของ API */
export async function unwrap<T>(promise: Promise<{ data: ApiResponse<T> }>): Promise<T> {
  return (await promise).data.data;
}
