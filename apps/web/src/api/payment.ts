import type {
  ApiResponse,
  BookingPaymentInfo,
  SlipUploadRequestInput,
  UploadTicket,
} from '@market-booking/shared';
import { useQuery } from '@tanstack/react-query';
import { apiClient, unwrap } from '../lib/api-client';

export const paymentApi = {
  info: (bookingId: string) =>
    unwrap(apiClient.get<ApiResponse<BookingPaymentInfo>>(`/bookings/${bookingId}/payment`)),
  slipUpload: (bookingId: string, input: SlipUploadRequestInput) =>
    unwrap(
      apiClient.post<ApiResponse<UploadTicket>>(
        `/bookings/${bookingId}/payments/slip-upload`,
        input,
      ),
    ),
  submit: (bookingId: string, slipImageKey: string) =>
    unwrap(
      apiClient.post<ApiResponse<BookingPaymentInfo>>(`/bookings/${bookingId}/payments`, {
        slipImageKey,
      }),
    ),
};

export const paymentKey = (bookingId: string) => ['payment', bookingId] as const;

/** ข้อมูลชำระเงินของการจอง — socket (`booking:changed`) สั่งโหลดใหม่เมื่อเจ้าหน้าที่ตรวจแล้ว */
export function useBookingPayment(bookingId: string) {
  return useQuery({ queryKey: paymentKey(bookingId), queryFn: () => paymentApi.info(bookingId) });
}
