import type { ApiResponse, CheckinQr } from '@market-booking/shared';
import { useQuery } from '@tanstack/react-query';
import { apiClient, unwrap } from '../lib/api-client';

export const checkinApi = {
  qr: (bookingId: string) =>
    unwrap(apiClient.get<ApiResponse<CheckinQr>>(`/bookings/${bookingId}/checkin-qr`)),
};

export const checkinQrKey = (bookingId: string) => ['checkin-qr', bookingId] as const;

/** QR check-in — socket (`checkin:updated`) สั่งโหลดใหม่เมื่อเจ้าหน้าที่สแกนแล้ว */
export function useCheckinQr(bookingId: string) {
  return useQuery({ queryKey: checkinQrKey(bookingId), queryFn: () => checkinApi.qr(bookingId) });
}
