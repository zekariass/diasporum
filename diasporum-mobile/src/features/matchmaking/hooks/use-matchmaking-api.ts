import { useMemo } from 'react';
import { useSession } from '@/core/session/session-provider';
import { createMatchmakingApi } from '../services/matchmaking-api';

export function useMatchmakingApi() {
  const { apiClient } = useSession();
  return useMemo(() => createMatchmakingApi(apiClient), [apiClient]);
}
