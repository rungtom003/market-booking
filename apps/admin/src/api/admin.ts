import type {
  AdminAnnouncement,
  CreateAnnouncementInput,
  UpdateAnnouncementInput,
  AddMarketDaysInput,
  AdminBooking,
  AdminBookingListQuery,
  AdminCreateBookingInput,
  AdminMarketDayOption,
  AdminMapLayout,
  AdminMarketDayStalls,
  AdminPayment,
  AdminPaymentListQuery,
  Booking,
  AdminLoginResponse,
  AdminUser,
  AdminUserListQuery,
  AdminVendorDetail,
  AdminWaitlistEntry,
  AdminVendorListItem,
  AdminStallListQuery,
  AdminVendorListQuery,
  ApiResponse,
  AuditLogEntry,
  AuditLogQuery,
  BulkApproveResult,
  BulkCreateStallsInput,
  BulkCreateStallsResult,
  CreateAdminUserInput,
  CreateProductCategoryInput,
  CreateRoundInput,
  CreateStallInput,
  CreateZoneInput,
  Dashboard,
  OccupancyReport,
  OccupancyReportQuery,
  PaginatedResponse,
  ProductCategory,
  RecordCashPaymentInput,
  RevenueReport,
  RevenueReportQuery,
  Round,
  SaveMapLayoutInput,
  RoundDetail,
  SetStallDayOverrideInput,
  Settings,
  Stall,
  StallDayOverride,
  SuspendVendorInput,
  UpdateAdminUserInput,
  UpdateMarketDayInput,
  UpdateProductCategoryInput,
  UpdateRoundInput,
  UpdateSettingsInput,
  UpdateStallInput,
  UpdateZoneInput,
  UploadTicket,
  VendorReport,
  VendorReportQuery,
  VendorStatusCounts,
  Zone,
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

  categories: {
    list: () => unwrap(apiClient.get<ApiResponse<ProductCategory[]>>('/admin/product-categories')),
    create: (input: CreateProductCategoryInput) =>
      unwrap(apiClient.post<ApiResponse<ProductCategory>>('/admin/product-categories', input)),
    update: (id: string, input: UpdateProductCategoryInput) =>
      unwrap(
        apiClient.patch<ApiResponse<ProductCategory>>(`/admin/product-categories/${id}`, input),
      ),
    remove: (id: string) => apiClient.delete(`/admin/product-categories/${id}`),
  },

  zones: {
    list: () => unwrap(apiClient.get<ApiResponse<Zone[]>>('/admin/zones')),
    create: (input: CreateZoneInput) =>
      unwrap(apiClient.post<ApiResponse<Zone>>('/admin/zones', input)),
    update: (id: string, input: UpdateZoneInput) =>
      unwrap(apiClient.patch<ApiResponse<Zone>>(`/admin/zones/${id}`, input)),
    remove: (id: string) => apiClient.delete(`/admin/zones/${id}`),
  },

  stalls: {
    list: (query: Partial<AdminStallListQuery> = {}) =>
      unwrap(apiClient.get<ApiResponse<Stall[]>>('/admin/stalls', { params: params(query) })),
    create: (input: CreateStallInput) =>
      unwrap(apiClient.post<ApiResponse<Stall>>('/admin/stalls', input)),
    bulkCreate: (input: BulkCreateStallsInput) =>
      unwrap(apiClient.post<ApiResponse<BulkCreateStallsResult>>('/admin/stalls/bulk', input)),
    update: (id: string, input: UpdateStallInput) =>
      unwrap(apiClient.patch<ApiResponse<Stall>>(`/admin/stalls/${id}`, input)),
    remove: (id: string) => apiClient.delete(`/admin/stalls/${id}`),
    /** Map Editor (9.1) */
    layout: () => unwrap(apiClient.get<ApiResponse<AdminMapLayout>>('/admin/stalls/layout')),
    saveLayout: (input: SaveMapLayoutInput) =>
      unwrap(apiClient.put<ApiResponse<AdminMapLayout>>('/admin/stalls/layout', input)),
    backgroundUpload: (input: {
      contentType: 'image/jpeg' | 'image/png' | 'image/webp';
      size: number;
    }) =>
      unwrap(
        apiClient.post<ApiResponse<UploadTicket>>('/admin/stalls/layout/background-upload', input),
      ),
  },

  rounds: {
    list: () => unwrap(apiClient.get<ApiResponse<Round[]>>('/admin/rounds')),
    get: (id: string) => unwrap(apiClient.get<ApiResponse<RoundDetail>>(`/admin/rounds/${id}`)),
    create: (input: CreateRoundInput) =>
      unwrap(apiClient.post<ApiResponse<RoundDetail>>('/admin/rounds', input)),
    update: (id: string, input: UpdateRoundInput) =>
      unwrap(apiClient.patch<ApiResponse<RoundDetail>>(`/admin/rounds/${id}`, input)),
    remove: (id: string) => apiClient.delete(`/admin/rounds/${id}`),
    publish: (id: string) =>
      unwrap(apiClient.post<ApiResponse<RoundDetail>>(`/admin/rounds/${id}/publish`)),
    cancel: (id: string) =>
      unwrap(apiClient.post<ApiResponse<RoundDetail>>(`/admin/rounds/${id}/cancel`)),
    addDays: (id: string, input: AddMarketDaysInput) =>
      unwrap(apiClient.post<ApiResponse<RoundDetail>>(`/admin/rounds/${id}/market-days`, input)),
    updateDay: (id: string, dayId: string, input: UpdateMarketDayInput) =>
      unwrap(
        apiClient.patch<ApiResponse<RoundDetail>>(
          `/admin/rounds/${id}/market-days/${dayId}`,
          input,
        ),
      ),
    removeDay: (id: string, dayId: string) =>
      apiClient.delete(`/admin/rounds/${id}/market-days/${dayId}`),
  },

  marketDays: {
    overrides: (id: string) =>
      unwrap(apiClient.get<ApiResponse<StallDayOverride[]>>(`/admin/market-days/${id}/overrides`)),
    setOverride: (id: string, stallId: string, input: SetStallDayOverrideInput) =>
      unwrap(
        apiClient.put<ApiResponse<StallDayOverride | null>>(
          `/admin/market-days/${id}/overrides/${stallId}`,
          input,
        ),
      ),
  },

  bookings: {
    list: async (query: Partial<AdminBookingListQuery>) =>
      (
        await apiClient.get<PaginatedResponse<AdminBooking>>('/admin/bookings', {
          params: params(query),
        })
      ).data,
    create: (input: Partial<AdminCreateBookingInput>) =>
      unwrap(apiClient.post<ApiResponse<AdminBooking>>('/admin/bookings', input)),
    cancel: (id: string, reason: string) =>
      unwrap(apiClient.post<ApiResponse<Booking>>(`/admin/bookings/${id}/cancel`, { reason })),
    days: () => unwrap(apiClient.get<ApiResponse<AdminMarketDayOption[]>>('/admin/market-days')),
    dayStalls: (marketDayId: string) =>
      unwrap(
        apiClient.get<ApiResponse<AdminMarketDayStalls>>(
          `/admin/market-days/${marketDayId}/stalls`,
        ),
      ),
    /** ดาวน์โหลด xlsx — คืน blob + ชื่อไฟล์จาก Content-Disposition */
    exportDay: async (marketDayId: string) => {
      const res = await apiClient.get<Blob>(`/admin/market-days/${marketDayId}/bookings.xlsx`, {
        responseType: 'blob',
      });
      const name = /filename="([^"]+)"/.exec(String(res.headers['content-disposition']))?.[1];
      return { blob: res.data, filename: name ?? 'bookings.xlsx' };
    },
  },

  reports: {
    dashboard: () => unwrap(apiClient.get<ApiResponse<Dashboard>>('/admin/reports/dashboard')),
    revenue: (q: Omit<RevenueReportQuery, 'format'>) =>
      unwrap(
        apiClient.get<ApiResponse<RevenueReport>>('/admin/reports/revenue', { params: params(q) }),
      ),
    occupancy: (q: Omit<OccupancyReportQuery, 'format'>) =>
      unwrap(
        apiClient.get<ApiResponse<OccupancyReport>>('/admin/reports/occupancy', {
          params: params(q),
        }),
      ),
    vendors: (q: Omit<VendorReportQuery, 'format'>) =>
      unwrap(
        apiClient.get<ApiResponse<VendorReport>>('/admin/reports/vendors', { params: params(q) }),
      ),
    /** ดาวน์โหลด xlsx/csv ของรายงาน — คืน blob + ชื่อไฟล์จาก Content-Disposition */
    download: async (
      report: 'revenue' | 'occupancy' | 'vendors',
      q: object,
      format: 'xlsx' | 'csv',
    ) => {
      const res = await apiClient.get<Blob>(`/admin/reports/${report}`, {
        params: params({ ...q, format }),
        responseType: 'blob',
      });
      const name = /filename="([^"]+)"/.exec(String(res.headers['content-disposition']))?.[1];
      return { blob: res.data, filename: name ?? `${report}.${format}` };
    },
  },

  auditLogs: {
    list: async (q: Partial<AuditLogQuery>) =>
      (
        await apiClient.get<PaginatedResponse<AuditLogEntry>>('/admin/audit-logs', {
          params: params(q),
        })
      ).data,
    actions: () => unwrap(apiClient.get<ApiResponse<string[]>>('/admin/audit-logs/actions')),
  },

  waitlists: {
    list: (marketDayId: string) =>
      unwrap(
        apiClient.get<ApiResponse<AdminWaitlistEntry[]>>(
          `/admin/market-days/${marketDayId}/waitlists`,
        ),
      ),
    remove: (id: string) =>
      unwrap(apiClient.delete<ApiResponse<AdminWaitlistEntry>>(`/admin/waitlists/${id}`)),
  },

  announcements: {
    list: () => unwrap(apiClient.get<ApiResponse<AdminAnnouncement[]>>('/admin/announcements')),
    create: (input: CreateAnnouncementInput) =>
      unwrap(apiClient.post<ApiResponse<AdminAnnouncement>>('/admin/announcements', input)),
    update: (id: string, input: UpdateAnnouncementInput) =>
      unwrap(apiClient.patch<ApiResponse<AdminAnnouncement>>(`/admin/announcements/${id}`, input)),
    remove: (id: string) => apiClient.delete(`/admin/announcements/${id}`),
  },

  payments: {
    list: async (query: Partial<AdminPaymentListQuery>) =>
      (
        await apiClient.get<PaginatedResponse<AdminPayment>>('/admin/payments', {
          params: params(query),
        })
      ).data,
    approve: (id: string) =>
      unwrap(apiClient.post<ApiResponse<AdminPayment>>(`/admin/payments/${id}/approve`)),
    reject: (id: string, reason: string) =>
      unwrap(apiClient.post<ApiResponse<AdminPayment>>(`/admin/payments/${id}/reject`, { reason })),
    cash: (input: RecordCashPaymentInput) =>
      unwrap(apiClient.post<ApiResponse<AdminPayment>>('/admin/payments/cash', input)),
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
