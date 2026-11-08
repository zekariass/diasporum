import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { ThemedText } from "@/components/themed-text";
import type { ReelPlayerProps } from "../utils/reel-playback";

/** Expo 58 web discards play()'s promise and auto-plays replacements.
 * Use the browser element here so policy rejections never become unhandled promises.
 */
export function ReelPlayer({
  id,
  uri,
  active,
  paused,
  muted,
  initialTime,
  playback,
  onTap,
  onError,
  onViewed,
}: ReelPlayerProps) {
  const video = useRef<HTMLVideoElement>(null);
  const attempt = useRef(0);
  const [blocked, setBlocked] = useState(false);
  const [waiting, setWaiting] = useState(true);
  const [progress, setProgress] = useState(0);
  const stop = useCallback(() => {
    ++attempt.current;
    video.current?.pause();
  }, []);
  useLayoutEffect(() => {
    const element = video.current;
    return () => {
      // Retain the element for cleanup after React detaches its ref.
      element?.pause();
      element?.removeAttribute("src");
      element?.load();
    };
  }, []);
  const play = useCallback(() => {
    const element = video.current;
    if (!element || !active || !playback.start(id, stop)) return;
    const token = ++attempt.current;
    void element
      .play()
      .then(() => {
        if (token === attempt.current) setBlocked(false);
      })
      .catch((error: unknown) => {
        if (token !== attempt.current) return;
        if (error instanceof Error && error.name === "NotAllowedError") {
          setBlocked(true);
          setWaiting(false);
        } else if (!(error instanceof Error && error.name === "AbortError")) {
          onError(element.currentTime);
        }
      });
  }, [active, playback, id, stop, onError]);

  useEffect(() => {
    if (active && !paused) play();
    else {
      playback.stop(id);
      stop();
    }
    return () => {
      playback.stop(id);
      stop();
    };
  }, [active, paused, play, playback, id, stop]);

  useEffect(() => {
    if (!active || paused || blocked || !waiting) return;
    const timeout = setTimeout(
      () => onError(video.current?.currentTime ?? 0),
      20_000,
    );
    return () => clearTimeout(timeout);
  }, [active, paused, blocked, waiting, onError]);

  return (
    <View style={styles.root}>
      <video
        ref={video}
        src={uri}
        playsInline
        loop
        muted={muted}
        preload="auto"
        controls={false}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          position: "absolute",
        }}
        onLoadedMetadata={() => {
          if (video.current) video.current.currentTime = initialTime;
        }}
        onCanPlay={() => {
          setWaiting(false);
          if (active && !paused && !blocked) play();
        }}
        onWaiting={() => setWaiting(true)}
        onPlaying={() => {
          if (!active || paused || !playback.start(id, stop)) {
            stop();
            return;
          }
          setWaiting(false);
          setBlocked(false);
        }}
        onError={() => onError(video.current?.currentTime ?? 0)}
        onTimeUpdate={() => {
          const element = video.current;
          if (element && active && !element.paused) {
            setProgress(
              element.duration > 0 ? element.currentTime / element.duration : 0,
            );
            if (element.currentTime > 0) onViewed();
          }
        }}
      />
      <Pressable
        style={styles.tap}
        disabled={!active}
        accessibilityRole="button"
        accessibilityLabel={
          blocked ? "Play reel with sound" : paused ? "Play reel" : "Pause reel"
        }
        onPress={() => {
          // Call play within the actual user gesture, not a delayed React effect.
          if (blocked) {
            play();
            return;
          }
          if (paused) play();
          onTap();
        }}
      >
        {(paused || blocked) && (
          <Ionicons name="play" size={64} color="white" />
        )}
        {blocked && (
          <ThemedText style={styles.hint}>
            Tap to play{muted ? "" : " with sound"}
          </ThemedText>
        )}
      </Pressable>
      {active && waiting && !paused && !blocked && (
        <View style={styles.tap} pointerEvents="none">
          <ActivityIndicator
            size="large"
            color="white"
            accessibilityLabel="Loading video"
          />
        </View>
      )}
      <View style={styles.track} pointerEvents="none">
        <View
          style={[
            styles.fill,
            { width: `${Math.min(1, Math.max(0, progress)) * 100}%` },
          ]}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  tap: {
    position: "absolute",
    inset: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  hint: {
    color: "white",
    backgroundColor: "rgba(0,0,0,0.7)",
    padding: 12,
    borderRadius: 16,
  },
  track: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: "rgba(255,255,255,0.2)",
  },
  fill: { height: "100%", backgroundColor: "white" },
});
