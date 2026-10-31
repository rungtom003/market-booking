import type {
  ApiResponse,
  Booking,
  CancelBookingInput,
  HoldBookingInput,
} from '@market-booking/shared';
import { useQuery } from '@tanstack/react-query';
import { apiClient, unwrap } from '../lib/api-client';

export const bookingApi = {
  hold: (input: HoldBookingInput) =>
    unwrap(apiClient.post<ApiResponse<Booking>>('/bookings/hold', input)),
  confirm: (id: string) => unwrap(apiClient.post<ApiResponse<Booking>>(`/bookings/${id}/confirm`)),
  cancel: (id: string, input: CancelBookingInput = {}) =>
    unwrap(apiClient.post<ApiResponse<Booking>>(`/bookings/${id}/cancel`, input)),
  mine: () => unwrap(apiClient.get<ApiResponse<Booking[]>>('/bookings/me')),
};

export const MY_BOOKINGS_KEY = ['bookings', 'me'] as const;

/** การจองของฉัน — socket (`booking:changed`) สั่งโหลดใหม่เมื่อสถานะเปลี่ยน */
export function useMyBookings() {
  return useQuery({ queryKey: MY_BOOKINGS_KEY, queryFn: bookingApi.mine });
}
