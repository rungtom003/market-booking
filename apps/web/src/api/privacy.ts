import type { ApiResponse, DeleteMyAccountInput, VendorDataExport } from '@market-booking/shared';
import { apiClient, unwrap } from '../lib/api-client';

export const privacyApi = {
  export: () => unwrap(apiClient.get<ApiResponse<VendorDataExport>>('/vendors/me/export')),
  deleteAccount: async (input: DeleteMyAccountInput) => {
    await apiClient.delete('/vendors/me', { data: input });
  },
};
