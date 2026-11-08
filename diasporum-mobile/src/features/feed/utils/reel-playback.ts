/** Synchronous ownership prevents effect ordering or late readiness from playing two reels. */
export function createReelPlayback() {
  let allowed: string | null = null;
  let current: { id: string; stop: () => void } | null = null;
  return {
    allow(id: string | null) {
      allowed = id;
      if (current && current.id !== id) {
        const previous = current;
        current = null;
        previous.stop();
      }
    },
    start(id: string, stop: () => void) {
      if (allowed !== id) {
        stop();
        return false;
      }
      if (current && current.stop !== stop) current.stop();
      current = { id, stop };
      return true;
    },
    stop(id: string) {
      if (current?.id === id) {
        const previous = current;
        current = null;
        previous.stop();
      }
    },
  };
}

export type ReelPlayback = ReturnType<typeof createReelPlayback>;
export interface ReelPlayerProps {
  id: string;
  uri: string;
  active: boolean;
  muted: boolean;
  paused: boolean;
  initialTime: number;
  playback: ReelPlayback;
  onTap: () => void;
  onError: (position: number) => void;
  onViewed: () => void;
}
