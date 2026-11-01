/**
 * Realtime lifecycle hook — acquires the shared Ably connection for the
 * signed-in user while the screen is mounted and releases it on unmount
 * (refcounted; the last release disconnects, so sign-out tears down the
 * socket). Acquisition never rejects — realtime absence leaves REST intact.
 */

import { useEffect } from 'react';

import { useSession } from '@/core/session/session-provider';
import { messagingRealtime } from '../services/realtime-service';

export function useMessagingRealtime() {
  const { apiClient, session } = useSession();
  const userId = session?.me.id;

  useEffect(() => {
    if (!userId) return;
    void messagingRealtime.acquire(apiClient, userId);
    return () => messagingRealtime.release();
  }, [apiClient, userId]);

  return messagingRealtime;
}
