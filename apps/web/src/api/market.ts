import { estimateClockOffset } from '@market-booking/shared';
import type { ApiResponse, CurrentRoundResponse, MarketLayout } from '@market-booking/shared';
import { useQuery } from '@tanstack/react-query';
import { apiClient, unwrap } from '../lib/api-client';

export interface CurrentRoundData extends CurrentRoundResponse {
  /** เวลา server − เวลาเครื่อง (ms) วัดจาก request นี้ */
  clockOffsetMs: number;
}

export const marketApi = {
  layout: () => unwrap(apiClient.get<ApiResponse<MarketLayout>>('/market/layout')),
  currentRound: async (): Promise<CurrentRoundData> => {
    const sentAt = Date.now();
    const data = await unwrap(apiClient.get<ApiResponse<CurrentRoundResponse>>('/rounds/current'));
    return { ...data, clockOffsetMs: estimateClockOffset(sentAt, data.serverTime, Date.now()) };
  },
};

/** ผังตลาด (เปลี่ยนไม่บ่อย) — เฉพาะผู้ค้าที่อนุมัติแล้ว */
export function useMarketLayout() {
  return useQuery({
    queryKey: ['market', 'layout'],
    queryFn: marketApi.layout,
    staleTime: 300_000,
  });
}

/** รอบที่เปิดจอง/กำลังจะเปิด — โหลดใหม่ทุก 5 นาที (วัด offset เวลาใหม่ด้วย) */
export function useCurrentRound() {
  return useQuery({
    queryKey: ['rounds', 'current'],
    queryFn: marketApi.currentRound,
    staleTime: 60_000,
    refetchInterval: 300_000,
  });
}
