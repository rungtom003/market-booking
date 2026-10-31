import type {
  ApiResponse,
  OtpRequestResponse,
  OtpVerifyInput,
  VendorAuthResult,
} from '@market-booking/shared';
import { apiClient, unwrap } from '../lib/api-client';
import { session } from '../lib/session';

export const authApi = {
  requestOtp: (phone: string) =>
    unwrap(apiClient.post<ApiResponse<OtpRequestResponse>>('/auth/otp/request', { phone })),

  verifyOtp: (input: OtpVerifyInput) =>
    unwrap(apiClient.post<ApiResponse<VendorAuthResult>>('/auth/otp/verify', input)),

  loginWithLine: (idToken: string) =>
    unwrap(apiClient.post<ApiResponse<VendorAuthResult>>('/auth/line', { idToken })),

  async logout() {
    try {
      await apiClient.post('/auth/logout', { actorType: 'VENDOR' });
    } finally {
      session.signOut();
    }
  },
};
