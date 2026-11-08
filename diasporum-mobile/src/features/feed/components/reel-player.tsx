import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useVideoPlayer, VideoView } from "expo-video";
import type { ReelPlayerProps } from "../utils/reel-playback";

/** Mounted only for the selected reel and its next neighbor. No persistent private-media cache. */
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
  const player = useVideoPlayer({ uri, useCaching: false }, (p) => {
    p.loop = true;
    p.muted = muted;
    p.audioMixingMode = "doNotMix";
    p.staysActiveInBackground = false;
    p.timeUpdateEventInterval = 0.25;
    p.currentTime = initialTime;
  });
  const [status, setStatus] = useState(player.status);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const stop = useCallback(() => player.pause(), [player]);

  useEffect(() => {
    const stateSub = player.addListener("statusChange", ({ status: next }) => {
      setStatus(next);
      if (next === "error") onError(player.currentTime);
    });
    const playSub = player.addListener("playingChange", ({ isPlaying }) => {
      setPlaying(isPlaying);
      if (isPlaying && (!active || paused || !playback.start(id, stop))) stop();
    });
    const timeSub = player.addListener("timeUpdate", ({ currentTime }) => {
      if (active && player.playing) {
        setProgress(player.duration > 0 ? currentTime / player.duration : 0);
        if (currentTime > 0) onViewed();
      }
    });
    // Reconcile readiness that may have changed before the subscription was attached.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStatus(player.status);
    if (player.status === "error") onError(player.currentTime);
    return () => {
      stateSub.remove();
      playSub.remove();
      timeSub.remove();
    };
  }, [player, active, paused, playback, id, stop, onError, onViewed]);

  useEffect(() => {
    // expo-video exposes mutable native player properties.
    // eslint-disable-next-line react-hooks/immutability
    player.muted = muted;
    if (
      active &&
      !paused &&
      status === "readyToPlay" &&
      playback.start(id, stop)
    )
      player.play();
    else {
      playback.stop(id);
      stop();
    }
    return () => {
      playback.stop(id);
      stop();
    };
  }, [player, active, paused, muted, status, playback, id, stop]);

  useEffect(() => {
    if (!active || paused || (status !== "loading" && status !== "idle"))
      return;
    const timeout = setTimeout(() => onError(player.currentTime), 20_000);
    return () => clearTimeout(timeout);
  }, [active, paused, status, onError, player]);

  return (
    <View style={styles.root}>
      <VideoView
        player={player}
        style={styles.root}
        contentFit="cover"
        nativeControls={false}
        surfaceType="textureView"
      />
      <Pressable
        style={styles.tap}
        onPress={onTap}
        disabled={!active}
        accessibilityRole="button"
        accessibilityLabel={paused || !playing ? "Play reel" : "Pause reel"}
      >
        {paused && <Ionicons name="play" size={64} color="white" />}
      </Pressable>
      {active && !paused && (status === "loading" || status === "idle") && (
        <View pointerEvents="none" style={styles.tap}>
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
