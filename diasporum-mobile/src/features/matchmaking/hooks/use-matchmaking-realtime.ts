import { useEffect } from 'react';
import { useMessagingRealtime } from '@/features/messaging/hooks/use-realtime';

/** Realtime is only an invalidation signal; REST remains the durable source. */
export function useMatchmakingRealtime(onInvalidate: () => void) {
  const realtime = useMessagingRealtime();

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(onInvalidate, 250);
    };
    const subscriptions = [
      realtime.on('MATCHMAKING_MATCHED', schedule),
      realtime.on('MATCHMAKING_UNMATCHED', schedule),
      realtime.onConnection((connected, recovered) => {
        if (connected && recovered) schedule();
      }),
    ];
    return () => {
      if (timer) clearTimeout(timer);
      subscriptions.forEach(unsubscribe => unsubscribe());
    };
  }, [onInvalidate, realtime]);
}
