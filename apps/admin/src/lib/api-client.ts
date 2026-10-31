import { API_PREFIX } from '@market-booking/shared';
import type { AccessTokenResponse, AdminProfile, ApiResponse } from '@market-booking/shared';
import axios from 'axios';
import type { AxiosError, InternalAxiosRequestConfig } from 'axios';
import { session } from './session';

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

/** ขอ access token ใหม่จาก refresh cookie — ครั้งเดียวแม้หลาย request ได้ 401 พร้อมกัน (กัน token reuse) */
function refreshToken(): Promise<string | null> {
  refreshing ??= axios
    .post<ApiResponse<AccessTokenResponse>>(
      `${API_PREFIX}/auth/refresh`,
      { actorType: 'ADMIN' },
      { withCredentials: true, timeout: 15_000 },
    )
    .then((res) => res.data.data.accessToken)
    .catch(() => null)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

/** ต่ออายุ access token ใน session (socket ใช้เมื่อ handshake ได้ UNAUTHORIZED) — ไม่ได้ = logout */
export async function renewAccessToken(): Promise<string | null> {
  const token = await refreshToken();
  if (token) session.setToken(token);
  else session.signOut();
  return token;
}

/** เปิดแอป: refresh cookie → token → โปรไฟล์ (เมนูตามสิทธิ์) */
export async function restoreSession(): Promise<void> {
  const token = await refreshToken();
  if (!token) return session.signOut();
  try {
    const res = await axios.get<ApiResponse<AdminProfile>>(`${API_PREFIX}/admin/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    session.signIn(token, res.data.data);
  } catch {
    session.signOut();
  }
}

type RetriableConfig = InternalAxiosRequestConfig & { _retried?: boolean };

apiClient.interceptors.response.use(undefined, async (error: AxiosError) => {
  const config = error.config as RetriableConfig | undefined;
  const isAuthCall = config?.url?.startsWith('/auth/');
  if (error.response?.status === 401 && config && !config._retried && !isAuthCall) {
    config._retried = true;
    const token = await refreshToken();
    if (token) {
      session.setToken(token);
      return apiClient(config);
    }
    session.signOut();
  }
  throw error;
});

export async function unwrap<T>(promise: Promise<{ data: ApiResponse<T> }>): Promise<T> {
  return (await promise).data.data;
}
