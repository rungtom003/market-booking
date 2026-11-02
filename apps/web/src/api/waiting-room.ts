import { useEffect } from 'react';
import type { ApiResponse, WaitingRoomStatus } from '@market-booking/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient, unwrap } from '../lib/api-client';

export const waitingRoomApi = {
  join: (roundId: string) =>
    unwrap(apiClient.post<ApiResponse<WaitingRoomStatus>>(`/rounds/${roundId}/waiting-room`)),
  status: (roundId: string) =>
    unwrap(apiClient.get<ApiResponse<WaitingRoomStatus>>(`/rounds/${roundId}/waiting-room`)),
};

export const waitingRoomKey = (roundId: string) => ['waiting-room', roundId] as const;
/** ถามสถานะทุก 5 วินาที — server นับว่า "ยังอยู่ในคิว" จากการถามนี้ (ไม่ถามเกิน 45 วินาที = ออกจากคิว) */
const POLL_MS = 5_000;

/**
 * Waiting Room ของรอบ: เข้าคิวอัตโนมัติเมื่อเปิดหน้า (`enabled`) แล้วถามสถานะเรื่อยๆ
 * ได้เข้าแล้ว socket (`waiting-room:admitted`) สั่งโหลดใหม่ทันที — ดู `useWaitingRoomAdmitted`
 */
export function useWaitingRoom(roundId: string, enabled: boolean) {
  const queryClient = useQueryClient();
  const join = useMutation({
    mutationFn: () => waitingRoomApi.join(roundId),
    onSuccess: (status) => queryClient.setQueryData(waitingRoomKey(roundId), status),
  });
  const { mutate } = join;
  useEffect(() => {
    if (enabled) mutate();
  }, [enabled, roundId, mutate]);

  const status = useQuery({
    queryKey: waitingRoomKey(roundId),
    queryFn: () => waitingRoomApi.status(roundId),
    enabled: enabled && join.isSuccess,
    refetchInterval: POLL_MS,
    refetchIntervalInBackground: true,
  });
  return { status: status.data ?? join.data ?? null, rejoin: () => join.mutate(), join };
}
