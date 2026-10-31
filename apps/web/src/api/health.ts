import type { HealthStatus } from '@market-booking/shared';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../lib/api-client';

export function useHealth() {
  return useQuery({
    queryKey: ['health'],
    queryFn: async () => (await apiClient.get<HealthStatus>('/health')).data,
  });
}
