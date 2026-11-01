import type { Announcement, ApiResponse } from '@market-booking/shared';
import { useQuery } from '@tanstack/react-query';
import { apiClient, unwrap } from '../lib/api-client';

export const announcementApi = {
  active: () => unwrap(apiClient.get<ApiResponse<Announcement[]>>('/announcements')),
};

/** ประกาศที่กำลังแสดง — ไม่มี socket; โหลดใหม่ทุก 5 นาทีและตอนกลับมาที่แท็บ */
export function useAnnouncements() {
  return useQuery({
    queryKey: ['announcements'],
    queryFn: announcementApi.active,
    refetchInterval: 5 * 60_000,
  });
}
