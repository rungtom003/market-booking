import type { ApiResponse, JoinWaitlistInput, WaitlistEntry } from '@market-booking/shared';
import { useQuery } from '@tanstack/react-query';
import { apiClient, unwrap } from '../lib/api-client';

export const waitlistApi = {
  mine: () => unwrap(apiClient.get<ApiResponse<WaitlistEntry[]>>('/waitlists')),
  join: (input: JoinWaitlistInput) =>
    unwrap(apiClient.post<ApiResponse<WaitlistEntry>>('/waitlists', input)),
  leave: (id: string) => unwrap(apiClient.delete<ApiResponse<WaitlistEntry>>(`/waitlists/${id}`)),
};

export const WAITLIST_KEY = ['waitlists'] as const;

/** คิวรอของฉัน — สถานะเปลี่ยนตามการจอง (socket `booking:changed` / `waitlist:offer` สั่งโหลดใหม่) */
export function useMyWaitlists() {
  return useQuery({ queryKey: WAITLIST_KEY, queryFn: waitlistApi.mine });
}

/** คิวที่ยังมีผลของล็อค/โซนนี้ในวันขายนี้ */
export function findOpenEntry(
  entries: readonly WaitlistEntry[] | undefined,
  marketDayId: string,
  target: { stallId: string } | { zoneId: string },
): WaitlistEntry | undefined {
  return entries?.find(
    (e) =>
      e.marketDay.id === marketDayId &&
      (e.status === 'WAITING' || e.status === 'NOTIFIED') &&
      ('stallId' in target
        ? e.stall?.id === target.stallId
        : e.stall === null && e.zone.id === target.zoneId),
  );
}
