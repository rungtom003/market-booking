import type {
  ApiResponse,
  UpdateVendorProfileInput,
  UploadRequestInput,
  UploadTicket,
  VendorFormOptions,
  VendorProfile,
  VendorRegisterInput,
  VendorRegisterResponse,
} from '@market-booking/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient, unwrap } from '../lib/api-client';

export const vendorKeys = {
  me: ['vendor', 'me'] as const,
  options: ['vendor', 'me', 'options'] as const,
};

export const vendorApi = {
  registrationOptions: (registrationToken: string) =>
    unwrap(
      apiClient.post<ApiResponse<VendorFormOptions>>('/vendors/register/options', {
        registrationToken,
      }),
    ),

  registrationUpload: (registrationToken: string, input: UploadRequestInput) =>
    unwrap(
      apiClient.post<ApiResponse<UploadTicket>>('/vendors/register/uploads', {
        ...input,
        registrationToken,
      }),
    ),

  register: (input: VendorRegisterInput) =>
    unwrap(apiClient.post<ApiResponse<VendorRegisterResponse>>('/vendors/register', input)),

  me: () => unwrap(apiClient.get<ApiResponse<VendorProfile>>('/vendors/me')),

  profileOptions: () =>
    unwrap(apiClient.get<ApiResponse<VendorFormOptions>>('/vendors/me/options')),

  profileUpload: (input: UploadRequestInput) =>
    unwrap(apiClient.post<ApiResponse<UploadTicket>>('/vendors/me/images', input)),

  updateMe: (input: UpdateVendorProfileInput) =>
    unwrap(apiClient.patch<ApiResponse<VendorProfile>>('/vendors/me', input)),
};

/** PUT ไฟล์ตรงไป MinIO ด้วย presigned URL (ไม่ผ่าน API) */
export async function uploadToStorage(ticket: UploadTicket, file: Blob): Promise<void> {
  const res = await fetch(ticket.url, {
    method: ticket.method,
    headers: ticket.headers,
    body: file,
  });
  if (!res.ok) throw new Error(`Upload failed with HTTP ${res.status}`);
}

export function useMyProfile() {
  return useQuery({ queryKey: vendorKeys.me, queryFn: vendorApi.me });
}

export function useProfileOptions() {
  return useQuery({
    queryKey: vendorKeys.options,
    queryFn: vendorApi.profileOptions,
    staleTime: 300_000,
  });
}

export function useUpdateProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: vendorApi.updateMe,
    onSuccess: (profile) => queryClient.setQueryData(vendorKeys.me, profile),
  });
}
