import { estimateClockOffset } from '@market-booking/shared';
import type {
  ApiResponse,
  CurrentRoundResponse,
  MarketDayStalls,
  MarketLayout,
} from '@market-booking/shared';
import { useQuery } from '@tanstack/react-query';
import { apiClient, unwrap } from '../lib/api-client';
import { setClockOffset } from '../lib/server-clock';

/** ข้อมูลที่มี `serverTime` + offset ที่วัดจาก request นั้น */
type WithClockOffset<T> = T & {
  /** เวลา server − เวลาเครื่อง (ms) วัดจาก request นี้ */
  clockOffsetMs: number;
};

export type CurrentRoundData = WithClockOffset<CurrentRoundResponse>;
export type MarketDayStallsData = WithClockOffset<MarketDayStalls>;

/** GET ที่ตอบ `serverTime` — คำนวณ offset แล้วเก็บเป็นค่าล่าสุดของทั้งแอปด้วย */
async function timed<T extends { serverTime: string }>(url: string): Promise<WithClockOffset<T>> {
  const sentAt = Date.now();
  const data = await unwrap(apiClient.get<ApiResponse<T>>(url));
  const clockOffsetMs = estimateClockOffset(sentAt, data.serverTime, Date.now());
  setClockOffset(clockOffsetMs);
  return { ...data, clockOffsetMs };
}

export const marketApi = {
  layout: () => unwrap(apiClient.get<ApiResponse<MarketLayout>>('/market/layout')),
  currentRound: () => timed<CurrentRoundResponse>('/rounds/current'),
  marketDayStalls: (marketDayId: string) =>
    timed<MarketDayStalls>(`/market-days/${marketDayId}/stalls`),
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

export const marketDayKey = (marketDayId: string) => ['market-day', marketDayId] as const;

/** ผังของวันขาย + สถานะการจอง — socket อัปเดต cache นี้ (`useMarketDaySocket`) */
export function useMarketDayStalls(marketDayId: string) {
  return useQuery({
    queryKey: marketDayKey(marketDayId),
    queryFn: () => marketApi.marketDayStalls(marketDayId),
  });
}
