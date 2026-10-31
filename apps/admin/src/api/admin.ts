import type {
  AdminLoginResponse,
  AdminUser,
  AdminUserListQuery,
  AdminVendorDetail,
  AdminVendorListItem,
  AdminVendorListQuery,
  ApiResponse,
  BulkApproveResult,
  CreateAdminUserInput,
  PaginatedResponse,
  Settings,
  SuspendVendorInput,
  UpdateAdminUserInput,
  UpdateSettingsInput,
  VendorStatusCounts,
} from '@market-booking/shared';
import { apiClient, unwrap } from '../lib/api-client';
import { session } from '../lib/session';

/** query string — ตัดค่าว่างออก */
function params(query: object): Record<string, string> {
  return Object.fromEntries(
    Object.entries(query)
      .filter(([, v]) => v !== undefined && v !== '' && v !== null)
      .map(([k, v]) => [k, String(v)]),
  );
}

export const adminApi = {
  async login(username: string, password: string) {
    const res = await unwrap(
      apiClient.post<ApiResponse<AdminLoginResponse>>('/auth/admin/login', { username, password }),
    );
    session.signIn(res.accessToken, res.admin);
  },
  async logout() {
    try {
      await apiClient.post('/auth/logout', { actorType: 'ADMIN' });
    } finally {
      session.signOut();
    }
  },

  vendors: {
    list: async (query: Partial<AdminVendorListQuery>) =>
      (
        await apiClient.get<PaginatedResponse<AdminVendorListItem>>('/admin/vendors', {
          params: params(query),
        })
      ).data,
    counts: () => unwrap(apiClient.get<ApiResponse<VendorStatusCounts>>('/admin/vendors/counts')),
    detail: (id: string) =>
      unwrap(apiClient.get<ApiResponse<AdminVendorDetail>>(`/admin/vendors/${id}`)),
    approve: (id: string) =>
      unwrap(apiClient.post<ApiResponse<AdminVendorDetail>>(`/admin/vendors/${id}/approve`)),
    reject: (id: string, reason: string) =>
      unwrap(
        apiClient.post<ApiResponse<AdminVendorDetail>>(`/admin/vendors/${id}/reject`, { reason }),
      ),
    suspend: (id: string, input: SuspendVendorInput) =>
      unwrap(apiClient.post<ApiResponse<AdminVendorDetail>>(`/admin/vendors/${id}/suspend`, input)),
    unsuspend: (id: string) =>
      unwrap(apiClient.post<ApiResponse<AdminVendorDetail>>(`/admin/vendors/${id}/unsuspend`)),
    bulkApprove: (input: { ids: string[] } | { allPending: true }) =>
      unwrap(apiClient.post<ApiResponse<BulkApproveResult>>('/admin/vendors/bulk-approve', input)),
  },

  settings: {
    get: () => unwrap(apiClient.get<ApiResponse<Settings>>('/admin/settings')),
    update: (input: UpdateSettingsInput) =>
      unwrap(apiClient.put<ApiResponse<Settings>>('/admin/settings', input)),
  },

  users: {
    list: async (query: Partial<AdminUserListQuery>) =>
      (await apiClient.get<PaginatedResponse<AdminUser>>('/admin/users', { params: params(query) }))
        .data,
    create: (input: CreateAdminUserInput) =>
      unwrap(apiClient.post<ApiResponse<AdminUser>>('/admin/users', input)),
    update: (id: string, input: UpdateAdminUserInput) =>
      unwrap(apiClient.patch<ApiResponse<AdminUser>>(`/admin/users/${id}`, input)),
  },
};
