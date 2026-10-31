import type { ApiResponse, MarketLayout } from '@market-booking/shared';
import { useQuery } from '@tanstack/react-query';
import { apiClient, unwrap } from '../lib/api-client';

export const marketApi = {
  layout: () => unwrap(apiClient.get<ApiResponse<MarketLayout>>('/market/layout')),
};

/** ผังตลาด (เปลี่ยนไม่บ่อย) — เฉพาะผู้ค้าที่อนุมัติแล้ว */
export function useMarketLayout() {
  return useQuery({
    queryKey: ['market', 'layout'],
    queryFn: marketApi.layout,
    staleTime: 300_000,
  });
}
