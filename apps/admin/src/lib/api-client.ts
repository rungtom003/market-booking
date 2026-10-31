import { API_PREFIX } from '@market-booking/shared';
import axios from 'axios';

// withCredentials เพื่อส่ง refresh token cookie (httpOnly) — interceptor refresh อยู่ Phase 2.3
export const apiClient = axios.create({
  baseURL: API_PREFIX,
  withCredentials: true,
  timeout: 15_000,
});
